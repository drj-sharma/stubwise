"""Colorado, 2026: DR 1098 (10/21/25) worksheet, DR 0004 (10/29/25), FAMLI worker share.

Income: (wages x periods - allowance) x 4.40% / periods, the allowance being DR 0004 line 2
or, without one, $11,000 for a married-filing-jointly W-4 and $5,500 otherwise. DR 1098 has
no worked example; these are worked by hand. FAMLI: 0.44% (half of the 0.88% premium) on
wages up to the $184,500 Social Security wage base. The city occupational privilege taxes
are typed by the employer.
"""

from __future__ import annotations

from .helpers import withhold


def test_no_certificate_uses_the_single_allowance() -> None:
    # $1,000 a week: (52,000 - 5,500) x 4.4% = 2,046 / 52 = $39.3461 -> $39.35
    # FAMLI: $1,000 x 0.44% = $4.40
    assert withhold("CO", 2026, wages_cents=100_000, periods=52) == {"sit": 3935, "local": "typed", "pfml": 440}


def test_federal_w4_statuses() -> None:
    # Married filing jointly, $3,000 every two weeks: (78,000 - 11,000) x 4.4% = 2,948 / 26 = $113.3846
    lines = withhold("CO", 2026, wages_cents=300_000, periods=26, w4={"filingStatus": "married"})
    assert lines == {"sit": 11338, "local": "typed", "pfml": 1320}
    # Head of household, $5,000 a month: (60,000 - 5,500) x 4.4% = 2,398 / 12 = $199.8333
    lines = withhold("CO", 2026, wages_cents=500_000, periods=12, w4={"filingStatus": "head"})
    assert lines == {"sit": 19983, "local": "typed", "pfml": 2200}


def test_dr_0004_line_2_replaces_the_w4_allowance() -> None:
    # Line 2 = $14,000 (Table 1, single, one job): (52,000 - 14,000) x 4.4% = 1,672 / 52 = $32.1538
    cert = {"options": {"annualAllowanceCents": 1_400_000}}
    assert withhold("CO", 2026, wages_cents=100_000, periods=52, cert=cert)["sit"] == 3215
    # Line 2 = 0 is used as zero: 52,000 x 4.4% / 52 = $44.00
    cert = {"options": {"annualAllowanceCents": 0}}
    assert (
        withhold("CO", 2026, wages_cents=100_000, periods=52, w4={"filingStatus": "married"}, cert=cert)["sit"] == 4400
    )


def test_exempt_federal_w4_without_dr_0004() -> None:
    lines = withhold("CO", 2026, wages_cents=100_000, periods=52, w4={"exempt": True})
    assert lines == {"sit": 0, "local": "typed", "pfml": 440}


def test_famli_stops_at_the_wage_base() -> None:
    # Below the base: $100,000 paid earlier, all $1,000 is charged
    assert withhold("CO", 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=10_000_000)["pfml"] == 440
    # Across the base: $184,000 paid earlier, only $500 of this $1,000 is charged: $2.20
    assert withhold("CO", 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=18_400_000)["pfml"] == 220
    # Past the base: nothing
    assert withhold("CO", 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=18_450_000)["pfml"] == 0


def test_famli_can_be_left_off() -> None:
    lines = withhold("CO", 2026, wages_cents=100_000, periods=52, cert={"options": {"pfml": False}})
    assert lines == {"sit": 3935, "local": "typed"}
