"""Georgia, 2026: Employer's Withholding Tax Guide (revised September 2026), percentage method.

Withholding = 4.99% x (wages - standard deduction for the G-4 letter - $5,000 a year per
dependent or Georgia adjustments allowance, all per pay period). Rate 4.99% from May 11, 2026.

Pay dated up to May 10, 2026 uses the guide revised December 2025: 5.19%, standard
deductions $12,000 / $24,000 (letter C), $4,000 per allowance (G-4 Rev. 08/15/24).
"""

from __future__ import annotations

from typing import Any

from app.domain.tax.state import state_taxes
from app.domain.tax.states._common import StateInput
from app.domain.tax.types import DEFAULT_STATE_W4, DEFAULT_W4

from .helpers import rules_for, withhold


def withhold_on(pay_date: str, *, wages_cents: int, periods: int, cert: dict[str, Any]) -> dict[str, Any]:
    inp = StateInput(
        year=2026,
        wages_cents=wages_cents,
        periods_per_year=periods,
        w4=dict(DEFAULT_W4),  # type: ignore[arg-type]
        cert={**DEFAULT_STATE_W4, **cert},  # type: ignore[typeddict-item]
        pay_date=pay_date,
    )
    return {line["code"]: line["cents"] for line in state_taxes(rules_for("GA", 2026), "GA", inp)}


def test_guide_example_1_married_one_spouse_working_one_child() -> None:
    # Guide p. 51, Example #1: semi-monthly $2,000, letter C, one dependent.
    # 2,000 - 1,250.00 - 208.33 = 541.67 x 4.99% = $27.03
    assert withhold("GA", 2026, wages_cents=200_000, periods=24, cert={"status": "C", "dependents": 1}) == {"sit": 2703}


def test_guide_example_2_head_of_household_two_children_owes_nothing() -> None:
    # Guide p. 52, Example #2: bi-weekly $935, head of household, two dependents: $0.
    assert withhold("GA", 2026, wages_cents=93_500, periods=26, cert={"status": "D", "dependents": 2}) == {"sit": 0}


def test_no_g4_withholds_as_single_with_zero_allowances() -> None:
    # $1,000 a week: (52,000 - 15,000) x 4.99% = 1,846.30 / 52 = $35.51
    assert withhold("GA", 2026, wages_cents=100_000, periods=52) == {"sit": 3551}


def test_married_both_working_with_an_adjustments_allowance() -> None:
    # $4,000 a month, letter B, one line-5 allowance:
    # (48,000 - 15,000 - 5,000) x 4.99% = 1,397.20 / 12 = $116.43
    cert = {"status": "B", "additionalAllowances": 1}
    assert withhold("GA", 2026, wages_cents=400_000, periods=12, cert=cert) == {"sit": 11643}


def test_december_2025_guide_example_before_may_11() -> None:
    # Guide revised December 2025, p. 46 example: semi-monthly $1,470.83, letter C, one child.
    # 1,470.83 - 1,000.00 - 166.67 = 304.16 x 5.19% = $15.79
    cert = {"status": "C", "dependents": 1}
    assert withhold_on("2026-05-10", wages_cents=147_083, periods=24, cert=cert) == {"sit": 1579}
    # From May 11 the same pay uses the new figures: (35,299.92 - 30,000 - 5,000) x 4.99% / 24 = $0.62
    assert withhold_on("2026-05-11", wages_cents=147_083, periods=24, cert=cert) == {"sit": 62}
