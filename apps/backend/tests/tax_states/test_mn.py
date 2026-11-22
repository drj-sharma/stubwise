"""Minnesota, 2026: Minnesota Income Tax Withholding Instruction Booklet and Tax Tables (2026),
Computer Formula (page 34): allowance $5,300; chart by marital status. No W-4MN on file:
single with zero allowances. The booklet has no worked example, so the cases are worked by
hand from the formula. Paid Leave (DEED): the worker's share is up to 0.44% of wages up to
the Social Security limit rounded to the nearest thousand ($185,000).
"""

from __future__ import annotations

from .helpers import withhold


def test_no_w4mn_single_zero_allowances() -> None:
    # $1,000 a week: 52,000; (52,000 - 38,010) x 6.80% = 951.32; + 1,782.09 = 2,733.41; / 52 = 52.5656 -> $52.57.
    # Paid Leave: 0.44% x 1,000 = $4.40.
    assert withhold("MN", 2026, wages_cents=100_000, periods=52) == {"sit": 5257, "pfml": 440}


def test_married_two_allowances_biweekly() -> None:
    # $3,000 every two weeks, married, 2 allowances: 78,000 - 10,600 = 67,400;
    # (67,400 - 63,400) x 6.80% = 272.00; + 2,605.45 = 2,877.45; / 26 = 110.6712 -> $110.67.
    lines = withhold("MN", 2026, wages_cents=300_000, periods=26, cert={"status": "married", "allowances": 2})
    assert lines["sit"] == 11067


def test_first_band_and_below_threshold() -> None:
    # $150 a week, single: 7,800 - 4,700 = 3,100 x 5.35% = 165.85; / 52 = 3.1894 -> $3.19.
    assert withhold("MN", 2026, wages_cents=15_000, periods=52)["sit"] == 319
    # $100 a week, 1 allowance: 5,200 - 5,300 < 0: nothing.
    assert withhold("MN", 2026, wages_cents=10_000, periods=52, cert={"allowances": 1})["sit"] == 0


def test_married_at_single_rate_uses_single_chart() -> None:
    single = withhold("MN", 2026, wages_cents=100_000, periods=52, cert={"status": "single", "allowances": 1})
    higher = withhold("MN", 2026, wages_cents=100_000, periods=52, cert={"status": "marriedSingle", "allowances": 1})
    assert single["sit"] == higher["sit"]


def test_paid_leave_stops_at_wage_base_and_can_be_paid_by_employer() -> None:
    # $184,500 paid earlier: only $500 of this $1,000 is under the $185,000 base: 0.44% x 500 = $2.20.
    lines = withhold("MN", 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=18_450_000)
    assert lines["pfml"] == 220
    # Employer covers the worker's share: no deduction.
    assert "pfml" not in withhold("MN", 2026, wages_cents=100_000, periods=52, cert={"options": {"pfml": False}})
