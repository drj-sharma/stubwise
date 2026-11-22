"""North Dakota, 2026: Income Tax Withholding Rates & Instructions for wages paid in 2026,
Section 2 percentage method (Forms W-4 for 2020 and after).

Annual wages, tax from the annual table for the federal W-4 Step 1(c) status,
divided by pay periods and rounded to the dollar.

The booklet's own example (weekly $1,800, single: annual withholding $734.00)
does not match its 2026 single table (1.95% over $57,625 gives $701.51), and
the 2026 wage-bracket tables agree with the table, so these cases are worked
by hand from the table and checked against the wage-bracket rows.
"""

from __future__ import annotations

from .helpers import withhold


def test_weekly_by_federal_status_matches_wage_bracket_rows() -> None:
    # $1,812.50 weekly (mid-point of the $1,800-$1,825 row) x 52 = $94,250.
    # Single: (94,250 - 57,625) x 1.95% = 714.19 / 52 = 13.73 -> $14 (table: 14)
    assert withhold("ND", 2026, wages_cents=181_250, periods=52, w4={"filingStatus": "single"}) == {"sit": 1400}
    # Head of household: (94,250 - 78,475) x 1.95% = 307.61 / 52 = 5.92 -> $6 (table: 6)
    assert withhold("ND", 2026, wages_cents=181_250, periods=52, w4={"filingStatus": "head"}) == {"sit": 600}
    # Married filing jointly: (94,250 - 57,500) x 1.95% = 716.63 / 52 = 13.78 -> $14 (table: 14)
    assert withhold("ND", 2026, wages_cents=181_250, periods=52, w4={"filingStatus": "married"}) == {"sit": 1400}


def test_no_w4_is_single() -> None:
    # $1,800 weekly: (93,600 - 57,625) x 1.95% = 701.51 / 52 = 13.49 -> $13
    assert withhold("ND", 2026, wages_cents=180_000, periods=52) == {"sit": 1300}


def test_top_bracket() -> None:
    # $6,000 weekly single: 312,000 -> 3,916.09 + (312,000 - 258,450) x 2.5% = 5,254.84 / 52 = 101.05 -> $101
    assert withhold("ND", 2026, wages_cents=600_000, periods=52) == {"sit": 10100}
