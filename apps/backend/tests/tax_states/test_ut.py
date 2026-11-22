"""Utah, 2026: Publication 14 (Rev. 4/26), Examples of Utah Withholding Calculations 1-5.

Schedules effective for pay periods beginning on or after June 1, 2026: 4.45% of wages, less a
base allowance that phases out at 1.3% of wages over a threshold. The status is the federal
W-4's (head of household uses single); no W-4 means single.
"""

from __future__ import annotations

from typing import Any

from app.domain.tax.state import state_taxes
from app.domain.tax.states._common import StateInput
from app.domain.tax.types import DEFAULT_STATE_W4, DEFAULT_W4

from .helpers import rules_for, withhold


def test_example_1_weekly_single_with_no_w4() -> None:
    # $400: 18 - (9 - 3) = $12
    assert withhold("UT", 2026, wages_cents=40_000, periods=52) == {"sit": 1200}


def test_example_2_biweekly_single() -> None:
    # $2,600: 116 - max(0, 19 - 29) = $116
    assert withhold("UT", 2026, wages_cents=260_000, periods=26, w4={"filingStatus": "single"}) == {"sit": 11600}


def test_example_3_semimonthly_married() -> None:
    # $1,200: 53 - (40 - 5) = $18
    assert withhold("UT", 2026, wages_cents=120_000, periods=24, w4={"filingStatus": "married"}) == {"sit": 1800}


def test_example_4_monthly_married() -> None:
    # $7,800: 347 - max(0, 81 - 81) = $347
    assert withhold("UT", 2026, wages_cents=780_000, periods=12, w4={"filingStatus": "married"}) == {"sit": 34700}


def test_example_5_quarterly_single() -> None:
    # $9,000: 401 - (121 - 87) = $367
    assert withhold("UT", 2026, wages_cents=900_000, periods=4) == {"sit": 36700}


def test_head_of_household_uses_single() -> None:
    assert withhold("UT", 2026, wages_cents=40_000, periods=52, w4={"filingStatus": "head"}) == {"sit": 1200}


def _on(pay_date: str, *, wages_cents: int, periods: int, w4: dict[str, Any] | None = None) -> int:
    inp = StateInput(
        year=2026,
        wages_cents=wages_cents,
        periods_per_year=periods,
        w4={**DEFAULT_W4, **(w4 or {})},  # type: ignore[typeddict-item]
        cert=dict(DEFAULT_STATE_W4),
        pay_date=pay_date,
    )
    return state_taxes(rules_for("UT", 2026), "UT", inp)[0]["cents"]


def test_earlier_2026_figures_rev_4_25() -> None:
    # Publication 14 Rev. 4/25 (4.5%), Examples 1, 4 and 5, for pay dates through May 31, 2026.
    # Utah switches schedules for pay periods *beginning* on or after June 1, 2026; the engine
    # keys on the pay date, so a period that starts in May but is paid in June gets Rev. 4/26.
    # Example 1, weekly single $400: 18 - (9 - 3) = $12
    assert _on("2026-03-15", wages_cents=40_000, periods=52) == 1200
    # Example 4, monthly married $7,800: 351 - max(0, 75 - 82) = $351 (Rev. 4/26 gives $347)
    assert _on("2026-03-15", wages_cents=780_000, periods=12, w4={"filingStatus": "married"}) == 35100
    assert _on("2026-06-15", wages_cents=780_000, periods=12, w4={"filingStatus": "married"}) == 34700
    # Example 5, quarterly single $9,000: 405 - (113 - 87) = $379
    assert _on("2026-05-31", wages_cents=900_000, periods=4) == 37900
