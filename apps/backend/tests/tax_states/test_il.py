"""Illinois, 2026: Booklet IL-700-T, automated payroll method.

Withholding = 4.95% x (wages - (Line 1 allowances x $2,925 + Line 2 allowances x $1,000) / pay periods).
"""

from __future__ import annotations

from .helpers import withhold


def test_biweekly_with_one_line_1_allowance() -> None:
    # $2,000 every two weeks, 1 basic allowance: (52,000 - 2,925) x 4.95% / 26 = $93.43
    assert withhold("IL", 2026, wages_cents=200_000, periods=26, cert={"allowances": 1}) == {"sit": 9343}


def test_no_certificate_withholds_on_all_wages() -> None:
    # $1,000 a week, no IL-W-4: 4.95% of $1,000.
    assert withhold("IL", 2026, wages_cents=100_000, periods=52) == {"sit": 4950}


def test_extra_withholding_and_exempt() -> None:
    assert withhold("IL", 2026, wages_cents=100_000, periods=52, cert={"extraWithholdingCents": 500}) == {"sit": 5450}
    assert withhold("IL", 2026, wages_cents=100_000, periods=52, cert={"exempt": True}) == {"sit": 0}


def test_il_700_t_automated_payroll_example() -> None:
    # IL-700-T (R-12/25), page 3: Alice, $800 weekly, 2 Line 1 and 2 Line 2 allowances -> $32.13.
    assert withhold("IL", 2026, wages_cents=80_000, periods=52, cert={"allowances": 2, "additionalAllowances": 2}) == {
        "sit": 3213
    }


def test_no_worker_contribution_or_local_tax() -> None:
    # Illinois UI is employer-paid only and Illinois has no local income tax: income tax is the only line.
    lines = withhold("IL", 2026, wages_cents=100_000, periods=52, cert={"localities": ["PHL-R"]})
    assert set(lines) == {"sit"}
