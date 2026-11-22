"""Alabama, 2026: Withholding Tax Tables and Instructions for Employers (revised January 2026),
"Formula For Computing Alabama Withholding Tax" and its Schedule of Standard Deduction Amounts.
"""

from __future__ import annotations

from fractions import Fraction

import pytest

from app.domain.tax.states.al import _standard_deduction

from .helpers import rules_for, withhold


def test_booklet_example_m_with_2_dependents() -> None:
    # Booklet example: "M-2", $850 weekly, federal withholding $35.19 a week.
    # 44,200 - (5,000 + 1,829.88 + 3,000 + 2,000) = 32,370.12
    # 1,000 x 2% + 5,000 x 4% + 26,370.12 x 5% = 1,538.51; / 52 = $29.59 (the booklet rounds
    # federal to $1,830 and gets $1,538.50; both give $29.59)
    cert = {"status": "M", "dependents": 2}
    assert withhold("AL", 2026, wages_cents=85_000, periods=52, cert=cert, federal_tax_cents=3_519) == {"sit": 2959}


def test_no_a4_is_zero_exemptions() -> None:
    # No A-4: zero exemptions. $1,500 bi-weekly, federal $120:
    # GI 39,000 (over $35,500: deduction $2,500); 39,000 - (2,500 + 3,120 + 0) = 33,380
    # 500 x 2% + 2,500 x 4% + 30,380 x 5% = 1,629.00; / 26 = $62.65
    assert withhold("AL", 2026, wages_cents=150_000, periods=26, federal_tax_cents=12_000) == {"sit": 6265}


def test_single_in_the_phase_out_with_a_dependent() -> None:
    # "S", 1 dependent, $2,500 monthly, federal $150:
    # GI 30,000: deduction 3,000 - 9 x 25 = 2,775 (schedule row $30,000-$30,499)
    # 30,000 - (2,775 + 1,800 + 1,500 + 1,000) = 22,925
    # 10 + 100 + 19,925 x 5% = 1,106.25; / 12 = $92.19
    cert = {"status": "S", "dependents": 1}
    assert withhold("AL", 2026, wages_cents=250_000, periods=12, cert=cert, federal_tax_cents=15_000) == {"sit": 9219}


def test_head_of_family_over_100000_dependents_300() -> None:
    # "H", 3 dependents, $2,000 weekly, federal $300:
    # GI 104,000: deduction 2,500; dependents 3 x 300; 104,000 - (2,500 + 15,600 + 3,000 + 900) = 82,000
    # 10 + 100 + 79,000 x 5% = 4,060; / 52 = $78.08
    cert = {"status": "H", "dependents": 3}
    assert withhold("AL", 2026, wages_cents=200_000, periods=52, cert=cert, federal_tax_cents=30_000) == {"sit": 7808}


@pytest.mark.parametrize(
    ("status", "gross_dollars", "deduction_dollars"),
    [
        # Rows of the booklet's Schedule of Standard Deduction Amounts.
        ("M", 25_999, 8_500),
        ("M", 26_000, 8_325),
        ("M", 30_000, 6_925),
        ("M", 35_499, 5_175),
        ("M", 35_500, 5_000),
        ("MS", 12_999, 4_250),
        ("MS", 13_000, 4_162),
        ("MS", 17_749, 2_578),
        ("MS", 17_750, 2_500),
        ("H", 26_499, 5_065),
        ("H", 35_499, 2_635),
        ("H", 40_000, 2_500),
        ("S", 26_500, 2_950),
        ("S", 35_000, 2_525),
        ("0", 35_500, 2_500),
    ],
)
def test_standard_deduction_schedule(status: str, gross_dollars: int, deduction_dollars: int) -> None:
    params = rules_for("AL", 2026)[0]["params"]
    rule = params["standardDeduction"][status]
    assert _standard_deduction(rule, Fraction(gross_dollars * 100)) == deduction_dollars * 100


def test_birmingham_occupational_tax() -> None:
    # 1% of gross wages earned in Birmingham, alongside the state tax.
    lines = withhold(
        "AL",
        2026,
        wages_cents=85_000,
        periods=52,
        cert={"status": "M", "dependents": 2, "localities": ["BHM"]},
        federal_tax_cents=3_519,
    )
    assert lines == {"sit": 2959, "local:BHM": 850}


def test_extra_withholding_and_exempt() -> None:
    assert withhold(
        "AL", 2026, wages_cents=150_000, periods=26, cert={"extraWithholdingCents": 500}, federal_tax_cents=12_000
    ) == {"sit": 6765}
    assert withhold("AL", 2026, wages_cents=150_000, periods=26, cert={"exempt": True}) == {"sit": 0}
