"""Nebraska, 2026: Circular EN (Rev. 11-2025), percentage method.

Wages less W-4N allowances x the allowance value for the period, then the
period's percentage table for the status. The Circular has no worked example,
so these are worked by hand and checked against its wage-bracket tables
(which use the mid-point of each row).
"""

from __future__ import annotations

from .helpers import withhold


def test_no_w4n_is_single_with_no_allowances() -> None:
    # $155 weekly (mid-point of the $150-$160 row), Table 1a:
    # 1.42 + (155 - 129) x 3.22% = $2.26 (wage-bracket table, 0 allowances: 2.26)
    assert withhold("NE", 2026, wages_cents=15_500, periods=52) == {"sit": 226}
    # A married federal W-4 does not change it.
    assert withhold("NE", 2026, wages_cents=15_500, periods=52, w4={"filingStatus": "married"}) == {"sit": 226}


def test_married_biweekly_two_allowances() -> None:
    # $1,910 biweekly - 2 x $93.85 = 1,722.30; Table 2b: 28.20 + (1,722.30 - 1,246) x 4.21% = $48.25
    # (wage-bracket table, married biweekly $1,900-$1,920, 2 allowances: 48.25)
    assert withhold("NE", 2026, wages_cents=191_000, periods=26, cert={"status": "married", "allowances": 2}) == {
        "sit": 4825
    }


def test_single_monthly_top_bracket() -> None:
    # $7,000 monthly - $203.33 = 6,796.67; Table 4a: 243.53 + (6,796.67 - 6,281) x 4.6% = $267.25
    assert withhold("NE", 2026, wages_cents=700_000, periods=12, cert={"status": "single", "allowances": 1}) == {
        "sit": 26725
    }
