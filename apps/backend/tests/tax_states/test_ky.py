"""Kentucky, 2026: 2026 Kentucky Withholding Tax Formula, 42A003 (TCF)(10-2025).

Withholding = (wages x pay periods - $3,360 standard deduction) x 3.5% / pay periods.

Local occupational taxes: Louisville Metro Revenue Commission Form W-1 (2026): 1.45%
(Metro 1.25% + Transit 0.2%) on wages for work in Louisville Metro, plus the 0.75% School
Boards tax for residents (2.2%); Lexington-Fayette Urban County Government occupational
license fee 2.25%.
"""

from __future__ import annotations

from .helpers import withhold


def test_formula_monthly_example() -> None:
    # 42A003 example 1: $3,270 monthly -> ($39,240 - $3,360) x 3.5% / 12 = $104.65.
    assert withhold("KY", 2026, wages_cents=327_000, periods=12) == {"sit": 10465}


def test_formula_biweekly_example() -> None:
    # 42A003 example 2: $1,500 biweekly -> $1,247.40 / 26 = $47.977. The guide prints "$47";
    # its own arithmetic rounds to $47.98, which is what the formula withholds to the cent.
    assert withhold("KY", 2026, wages_cents=150_000, periods=26) == {"sit": 4798}


def test_wages_below_standard_deduction() -> None:
    # $100 a month: $1,200 a year is under the $3,360 standard deduction.
    assert withhold("KY", 2026, wages_cents=10_000, periods=12) == {"sit": 0}


def test_louisville_metro_resident_and_nonresident() -> None:
    sit = withhold("KY", 2026, wages_cents=100_000, periods=52)["sit"]
    assert withhold("KY", 2026, wages_cents=100_000, periods=52, cert={"localities": ["LOU-R"]}) == {
        "sit": sit,
        "local:LOU-R": 2200,
    }
    assert withhold("KY", 2026, wages_cents=100_000, periods=52, cert={"localities": ["LOU-N"]}) == {
        "sit": sit,
        "local:LOU-N": 1450,
    }


def test_lexington_fayette() -> None:
    # 2.25% of $1,234.57 = $27.777825 -> $27.78
    lines = withhold("KY", 2026, wages_cents=123_457, periods=26, cert={"localities": ["LEX"]})
    assert lines["local:LEX"] == 2778


def test_no_locality_chosen_gives_income_tax_only() -> None:
    assert set(withhold("KY", 2026, wages_cents=100_000, periods=52)) == {"sit"}
