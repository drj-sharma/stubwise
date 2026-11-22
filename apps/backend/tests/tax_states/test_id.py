"""Idaho, 2026: Table for Percentage Computation Method of Withholding (EPB00744, 07-23-2026)
and the Computing Withholding page's examples.

5.3% of wages over $16,100 a year (A, C) or $32,200 (B), rounded to the whole dollar. Since the
Idaho Child Tax Credit sunset, each ID W-4 allowance is worth $0. No ID W-4 on file means
Single with zero allowances, whatever the federal W-4 says.
"""

from __future__ import annotations

from typing import Any

from app.domain.tax.state import state_taxes
from app.domain.tax.states._common import StateInput
from app.domain.tax.types import DEFAULT_STATE_W4, DEFAULT_W4

from .helpers import rules_for, withhold


def test_percentage_computation_example() -> None:
    # Unmarried, $1,212 biweekly, four allowances x $0: 5.3% x ($1,212 - $619) = $31.43 -> $31
    assert withhold("ID", 2026, wages_cents=121_200, periods=26, cert={"status": "A", "allowances": 4}) == {"sit": 3100}


def test_annualized_wage_example() -> None:
    # Married, $1,000 weekly, four allowances x $0: ($52,000 - $32,200) x 5.3% = $1,049.40 / 52 = $20.18 -> $20
    # (the page's example still shows $32,000; the 2026 annual table's $32,200 gives the same $20)
    assert withhold("ID", 2026, wages_cents=100_000, periods=52, cert={"status": "B", "allowances": 4}) == {"sit": 2000}


def test_no_id_w4_is_single_even_when_the_federal_w4_is_married() -> None:
    # ($52,000 - $16,100) x 5.3% = $1,902.70 / 52 = $36.59 -> $37
    assert withhold("ID", 2026, wages_cents=100_000, periods=52, w4={"filingStatus": "married"}) == {"sit": 3700}


def test_married_withholding_at_single_rate() -> None:
    assert withhold("ID", 2026, wages_cents=100_000, periods=52, cert={"status": "C"}) == {"sit": 3700}


def _on(pay_date: str, *, wages_cents: int, periods: int, cert: dict[str, Any]) -> int:
    inp = StateInput(
        year=2026,
        wages_cents=wages_cents,
        periods_per_year=periods,
        w4=DEFAULT_W4,
        cert={**DEFAULT_STATE_W4, **cert},  # type: ignore[typeddict-item]
        pay_date=pay_date,
    )
    return state_taxes(rules_for("ID", 2026), "ID", inp)[0]["cents"]


def test_earlier_2026_figures_with_the_child_tax_credit_allowance() -> None:
    # Before the July 2026 tables (EPB00744 04-28-2025 and the Computing Withholding page then):
    # $3,868 a year per ID W-4 allowance, 5.3% over $15,000 (A, C) or $30,000 (B).
    # Percentage computation example: unmarried, $1,212 biweekly, four allowances:
    # annualized, (31,512 - 15,472 - 15,000) x 5.3% = $55.12 / 26 = $2.12 -> $2
    assert _on("2026-03-15", wages_cents=121_200, periods=26, cert={"status": "A", "allowances": 4}) == 200
    # Annualized wage example: married, $1,000 weekly, four allowances:
    # (52,000 - 15,472 - 30,000) x 5.3% = $345.98 / 52 = $6.65 -> $7
    assert _on("2026-03-15", wages_cents=100_000, periods=52, cert={"status": "B", "allowances": 4}) == 700
    # From July 31, 2026 the allowance is $0 and the thresholds are $16,100 / $32,200.
    assert _on("2026-07-31", wages_cents=100_000, periods=52, cert={"status": "B", "allowances": 4}) == 2000
