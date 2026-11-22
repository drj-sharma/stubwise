"""Massachusetts, 2026: Circular M percentage method (Rev. 12/25) and PFML.

Circular M has no worked example, so each case below is worked by hand from
its seven steps (page 12), with the 2026 figures: 5% up to $1,107,750 a year
and 9% above, the $2,000 yearly cap on the FICA subtraction, and the
exemption factor table. PFML for employers with fewer than 25 covered
individuals: the worker's share is 0.46% of wages up to the Social Security
wage base ($184,500).
"""

from __future__ import annotations

from .helpers import withhold


def test_weekly_one_exemption() -> None:
    # $1,000 - $76.50 FICA - $85 = $838.50; x 52 = $43,602; 5% = $2,180.10; / 52 = $41.925 -> $41.93
    lines = withhold("MA", 2026, wages_cents=100_000, periods=52, cert={"allowances": 1}, fica_cents=7650)
    assert lines["sit"] == 4193
    assert lines["pfml"] == 460  # 0.46% of $1,000


def test_biweekly_two_exemptions_head_of_household() -> None:
    # Exemptions: $38 x 2 + $131 = $207. $2,000 - $153 - $207 = $1,640; x 26 = $42,640; 5% = $2,132; / 26 = $82.00
    # less the biweekly head-of-household value $4.62 = $77.38
    cert = {"allowances": 2, "options": {"headOfHousehold": True}}
    assert withhold("MA", 2026, wages_cents=200_000, periods=26, cert=cert, fica_cents=15300)["sit"] == 7738


def test_no_certificate_and_the_fica_cap() -> None:
    # $30,000 paid already: 7.65% of it is $2,295, past the $2,000 cap, so no FICA is subtracted.
    # $1,000 x 52 = $52,000; 5% = $2,600; / 52 = $50.00
    lines = withhold("MA", 2026, wages_cents=100_000, periods=52, fica_cents=7650, prior_ytd_wages_cents=3_000_000)
    assert lines["sit"] == 5000
    # $26,000 paid: $1,989 subtracted so far, so only $11.00 of this period's $76.50 more.
    # $1,000 - $11 = $989; x 52 = $51,428; 5% = $2,571.40; / 52 = $49.45
    lines = withhold("MA", 2026, wages_cents=100_000, periods=52, fica_cents=7650, prior_ytd_wages_cents=2_600_000)
    assert lines["sit"] == 4945


def test_low_pay_with_an_exemption_is_not_withheld() -> None:
    assert withhold("MA", 2026, wages_cents=15_000, periods=52, cert={"allowances": 1}, fica_cents=1148)["sit"] == 0
    # With no exemptions the floor does not apply: $150 - $11.48 = $138.52; x 52 x 5% / 52 = $6.93
    assert withhold("MA", 2026, wages_cents=15_000, periods=52, fica_cents=1148)["sit"] == 693


def test_surtax_on_very_high_pay() -> None:
    # $100,000 a month, FICA cap already reached: $1,200,000 a year.
    # 5% of $1,107,750 = $55,387.50; 9% of $92,250 = $8,302.50; total $63,690 / 12 = $5,307.50
    lines = withhold("MA", 2026, wages_cents=10_000_000, periods=12, prior_ytd_wages_cents=3_000_000, fica_cents=0)
    assert lines["sit"] == 530_750


def test_blind_and_pfml_wage_base() -> None:
    # Monthly $5,000, 1 exemption, blind: $5,000 - $382.50 - $367 = $4,250.50; x 12 x 5% / 12 = $212.525
    # less blindness value $9.17 = $203.355 -> $203.36
    cert = {"allowances": 1, "options": {"blind": True}}
    assert withhold("MA", 2026, wages_cents=500_000, periods=12, cert=cert, fica_cents=38250)["sit"] == 20336
    # PFML stops at the $184,500 wage base: $184,000 paid, so only $500 of this $5,000 counts.
    lines = withhold("MA", 2026, wages_cents=500_000, periods=12, prior_ytd_wages_cents=18_400_000)
    assert lines["pfml"] == 230  # 0.46% of $500
    # An employer may pay the worker's share: then no PFML line.
    assert "pfml" not in withhold("MA", 2026, wages_cents=500_000, periods=12, cert={"options": {"pfml": False}})
