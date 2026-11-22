"""Missouri, 2026.

Income tax is typed by the employer (the 2026 DOR withholding formula could not be read
from dor.mo.gov to encode it). The Kansas City and St. Louis earnings taxes are 1% of
wages for residents and for nonresidents working in the city (both renewed by voters in
April 2026).
"""

from __future__ import annotations

from .helpers import withhold


def test_income_tax_is_typed() -> None:
    assert withhold("MO", 2026, wages_cents=100_000, periods=52) == {"sit": "typed"}


def test_kansas_city_earnings_tax() -> None:
    # $1,000 weekly x 1% = $10.00
    lines = withhold("MO", 2026, wages_cents=100_000, periods=52, cert={"localities": ["KCMO"]})
    assert lines == {"sit": "typed", "local:KCMO": 1000}


def test_st_louis_earnings_tax() -> None:
    # $2,345.67 bi-weekly x 1% = $23.4567 -> $23.46
    lines = withhold("MO", 2026, wages_cents=234_567, periods=26, cert={"localities": ["STL"]})
    assert lines == {"sit": "typed", "local:STL": 2346}
