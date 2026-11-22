"""Alaska, 2026: no income tax; the worker pays 0.50% unemployment insurance on the first $54,200
(Alaska DOLWD, "2026 Unemployment Insurance Tax Rates").
"""

from __future__ import annotations

from .helpers import withhold


def test_no_income_tax_and_worker_ui() -> None:
    # $1,000 a week x 0.5% = $5.00.
    assert withhold("AK", 2026, wages_cents=100_000, periods=52) == {"ui": 500}


def test_ui_stops_at_wage_base() -> None:
    # $54,000 paid before: only $200 of this $1,000 is under $54,200 -> $1.00.
    assert withhold("AK", 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=5_400_000) == {"ui": 100}
    assert withhold("AK", 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=5_420_000) == {"ui": 0}
