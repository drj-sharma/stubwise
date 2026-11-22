"""South Carolina, 2026: WH-1603F Formula for Computing SC Withholding Tax (Rev. 11/4/25).

Annual wages less $5,000 per allowance and, with one or more allowances, 10% of wages up
to $7,500; then 0% to $3,640, 3% to $18,230, 6% above; divided by pay periods.
"""

from __future__ import annotations

from .helpers import withhold


def test_wh1603f_example_weekly_750_three_allowances() -> None:
    # WH-1603F example: 39,000 - 15,000 - 3,900 = 20,100 taxable; 20,100 x 6% - 656.10
    # = 549.90 a year; / 52 = $10.58 a week.
    assert withhold("SC", 2026, wages_cents=75_000, periods=52, cert={"allowances": 3}) == {"sit": 1058}


def test_no_allowances_gets_no_standard_deduction() -> None:
    # No SC W-4 (zero allowances): 39,000 taxable; 39,000 x 6% - 656.10 = 1,683.90 / 52 = $32.38
    assert withhold("SC", 2026, wages_cents=75_000, periods=52) == {"sit": 3238}


def test_standard_deduction_stops_at_7500() -> None:
    # $10,000 a month, 1 allowance: 120,000 - 5,000 - 7,500 (10% would be 12,000) = 107,500;
    # 107,500 x 6% - 656.10 = 5,793.90 / 12 = 482.825 -> $482.83
    assert withhold("SC", 2026, wages_cents=1_000_000, periods=12, cert={"allowances": 1}) == {"sit": 48283}
