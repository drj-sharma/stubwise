"""North Carolina, 2026: NC-30 (Web 11-25), 2026 Income Tax Withholding Tables and Instructions
for Employers, annualized wages method.

Withholding = (wages x pay periods - standard deduction - allowances x $2,500) x 4.09% / pay
periods, rounded to the nearest whole dollar. Standard deduction: $12,750 (single, married,
surviving spouse), $19,125 (head of household). No Form NC-4: single with no allowances.
"""

from __future__ import annotations

from .helpers import withhold


def test_nc_30_annualized_example() -> None:
    # NC-30 page 19: $450 weekly, single, two allowances -> $231.09 / 52 = $4.44 -> $4.00.
    assert withhold("NC", 2026, wages_cents=45_000, periods=52, cert={"status": "single", "allowances": 2}) == {
        "sit": 400
    }


def test_head_of_household_standard_deduction() -> None:
    # $1,000 weekly, head of household: ($52,000 - $19,125) x 4.09% / 52 = $25.86 -> $26.
    assert withhold("NC", 2026, wages_cents=100_000, periods=52, cert={"status": "head"}) == {"sit": 2600}


def test_no_nc_4_is_single_with_no_allowances() -> None:
    # NC-30 Section 10: without an NC-4, withhold as single with no allowances, whatever the
    # federal W-4 says. ($52,000 - $12,750) x 4.09% / 52 = $30.87 -> $31.
    assert withhold("NC", 2026, wages_cents=100_000, periods=52, w4={"filingStatus": "head"}) == {"sit": 3100}


def test_married_uses_the_single_figures() -> None:
    assert withhold("NC", 2026, wages_cents=100_000, periods=52, cert={"status": "married"}) == {"sit": 3100}


def test_no_worker_contribution_or_local_tax() -> None:
    # NC unemployment tax is employer-paid (G.S. 96-9.2) and NC has no local income tax.
    assert set(withhold("NC", 2026, wages_cents=100_000, periods=52)) == {"sit"}
