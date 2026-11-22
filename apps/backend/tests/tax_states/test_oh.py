"""Ohio, 2026: Employer Withholding Taxes, Optional Computer Formula (Rev. 07/26, effective August 1, 2026).

TW = annual wages - $650 x exemptions; WD = ((TW - over) x rate + base) / PP:
  up to $26,050: 1.600%;  $26,050-$100,000: 2.990% + $416.80;  over $100,000: 3.400% + $2,627.91.
The guide has no worked examples; each case below is worked by hand from the formula and
checked against the same period's Percentage Method table (effective August 1, 2026).

Pay dated up to July 31, 2026 uses the Optional Computer Formula effective October 1, 2025
(Rev. 09/25; the Department's Feb. 19, 2026 bulletin says to keep using it): the same $650
and bands, at 1.775%;  2.990% + $462.39;  3.640% + $2,673.50.
"""

from __future__ import annotations

from app.domain.tax.state import state_taxes
from app.domain.tax.states._common import StateInput
from app.domain.tax.types import DEFAULT_STATE_W4, DEFAULT_W4

from .helpers import rules_for, withhold


def _sit_on(pay_date: str, wages_cents: int, periods: int, exemptions: int = 0) -> int:
    inp = StateInput(
        year=2026,
        wages_cents=wages_cents,
        periods_per_year=periods,
        w4=DEFAULT_W4,
        cert={**DEFAULT_STATE_W4, "allowances": exemptions},
        pay_date=pay_date,
    )
    return next(line["cents"] for line in state_taxes(rules_for("OH", 2026), "OH", inp) if line["code"] == "sit")


def test_no_it4_withholds_with_zero_exemptions() -> None:
    # $500 a week, no IT 4 (zero exemptions): TW = 500 x 52 = 26,000 (first band).
    # 26,000 x 1.6% = 416.00; / 52 = $8.00. Weekly table: 500.00 x 1.600% = $8.00.
    assert withhold("OH", 2026, wages_cents=50_000, periods=52) == {"sit": 800, "local": "typed"}


def test_biweekly_two_exemptions_middle_band() -> None:
    # $2,000 every two weeks, 2 exemptions: TW = 52,000 - 1,300 = 50,700.
    # (50,700 - 26,050) x 2.99% = 737.035; + 416.80 = 1,153.835; / 26 = 44.378 -> $44.38.
    # Biweekly table: 2,000 - 2 x 25 = 1,950; 16.03 + (1,950 - 1,001.92) x 2.99% = $44.38.
    assert withhold("OH", 2026, wages_cents=200_000, periods=26, cert={"allowances": 2})["sit"] == 4438


def test_monthly_top_band() -> None:
    # $10,000 a month, 1 exemption: TW = 120,000 - 650 = 119,350.
    # (119,350 - 100,000) x 3.4% = 657.90; + 2,627.91 = 3,285.81; / 12 = 273.8175 -> $273.82.
    assert withhold("OH", 2026, wages_cents=1_000_000, periods=12, cert={"allowances": 1})["sit"] == 27382


def test_exemptions_above_wages_withhold_nothing() -> None:
    # $100 a week, 9 exemptions: TW = 5,200 - 5,850 < 0.
    assert withhold("OH", 2026, wages_cents=10_000, periods=52, cert={"allowances": 9})["sit"] == 0


def test_pay_dated_before_august_uses_the_october_2025_formula() -> None:
    # Biweekly $2,000, 2 exemptions, paid March 15: TW = 50,700;
    # (50,700 - 26,050) x 2.99% = 737.035; + 462.39 = 1,199.425; / 26 = 46.1317 -> $46.13.
    assert _sit_on("2026-03-15", 200_000, 26, exemptions=2) == 4613
    # Still the earlier formula on July 31; the August 2026 one from August 1 ($44.38, above).
    assert _sit_on("2026-07-31", 200_000, 26, exemptions=2) == 4613
    assert _sit_on("2026-08-01", 200_000, 26, exemptions=2) == 4438


def test_october_2025_formula_first_and_top_bands() -> None:
    # Weekly $500, no IT 4: 26,000 x 1.775% = 461.50; / 52 = 8.875 -> $8.88.
    assert _sit_on("2026-01-09", 50_000, 52) == 888
    # Monthly $10,000, 1 exemption: TW = 119,350; 19,350 x 3.64% = 704.34; + 2,673.50 = 3,377.84;
    # / 12 = 281.4867 -> $281.49.
    assert _sit_on("2026-06-30", 1_000_000, 12, exemptions=1) == 28149
