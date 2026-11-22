"""New Jersey, 2026: Tables for Percentage Method of Withholding (Rates A-E) and
NJ-WT (September 2025), "Examples of Percentage Method Calculations" (page 25); worker
UI/WF/SWF, disability and family leave contributions for 2026 (NJ Department of Labor
rate information).

The publication's examples 1 and 2 for Rate A and example 1 for Rate B match the
current tables to the cent. Its Rate A example 3 and Rate B examples 2 and 3 still use
older row figures ($15.28, $384/$5.76, $961/$17.30 where the tables now print $15.29,
$385/$5.77, $962/$17.31), so those three are worked from the current table instead,
with the steps in a comment.
"""

from __future__ import annotations

from .helpers import withhold

NJ = "NJ"


def sit(**kwargs: object) -> int:
    return withhold(NJ, 2026, **kwargs)["sit"]  # type: ignore[arg-type]


def test_rate_a_examples() -> None:
    single_one = {"status": "1", "allowances": 1}
    # $300 - $19.20 = $280.80 x 1.5% = $4.21
    assert sit(wages_cents=30_000, periods=52, cert=single_one) == 421
    # $700 - $19.20 = $680.80: $11.54 + 3.9% x $7.80 = $11.84
    assert sit(wages_cents=70_000, periods=52, cert=single_one) == 1184
    # $1,200 - $19.20 = $1,180.80: $15.29 + 6.1% x ($1,180.80 - $769) = $40.4098 -> $40.41
    assert sit(wages_cents=120_000, periods=52, cert=single_one) == 4041


def test_rate_b_examples() -> None:
    joint_three = {"status": "2", "allowances": 3}
    # $375 - $57.60 = $317.40 x 1.5% = $4.76
    assert sit(wages_cents=37_500, periods=52, cert=joint_three) == 476
    # $950 - $57.60 = $892.40: $5.77 + 2.0% x ($892.40 - $385) = $15.918 -> $15.92
    assert sit(wages_cents=95_000, periods=52, cert=joint_three) == 1592
    # $1,400 - $57.60 = $1,342.40: $17.31 + 2.7% x ($1,342.40 - $962) = $27.5808 -> $27.58
    assert sit(wages_cents=140_000, periods=52, cert=joint_three) == 2758


def test_no_certificate_uses_rate_a_with_no_allowances() -> None:
    # Weekly $1,000: $15.29 + 6.1% x ($1,000 - $769) = $29.381 -> $29.38
    assert withhold(NJ, 2026, wages_cents=100_000, periods=52) == {"sit": 2938, "ui": 425, "sdi": 190, "fli": 230}


def test_rate_from_the_wage_chart_and_other_frequencies() -> None:
    # Line 3 "E", weekly $1,000: $11.54 + 5.8% x ($1,000 - $673) = $30.506 -> $30.51
    assert sit(wages_cents=100_000, periods=52, cert={"status": "2", "options": {"rateTable": "E"}}) == 3051
    # Head of household (Rate B), biweekly $3,000, 2 allowances: $3,000 - $76.80 = $2,923.20;
    # $55.00 + 3.9% x ($2,923.20 - $2,692) = $64.0168 -> $64.02
    assert sit(wages_cents=300_000, periods=26, cert={"status": "4", "allowances": 2}) == 6402


def test_contributions_below_and_across_their_wage_bases() -> None:
    lines = withhold(NJ, 2026, wages_cents=100_000, periods=52)
    assert (lines["ui"], lines["sdi"], lines["fli"]) == (425, 190, 230)  # 0.425%, 0.19%, 0.23% of $1,000
    # $44,500 paid already: only $300 is left under the $44,800 UI base (0.425% = $1.275 -> $1.28).
    assert withhold(NJ, 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=4_450_000)["ui"] == 128
    # $171,000 paid already: $100 left under the $171,100 disability and family leave base; UI is done.
    lines = withhold(NJ, 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=17_100_000)
    assert (lines["ui"], lines["sdi"], lines["fli"]) == (0, 19, 23)
