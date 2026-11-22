"""District of Columbia, 2026: no current withholding formula or tables are published (the
D-4 is under review), so the income tax is typed by the employer. DC Paid Family Leave is
employer-paid: no worker line.
"""

from __future__ import annotations

from .helpers import withhold


def test_income_tax_is_typed() -> None:
    assert withhold("DC", 2026, wages_cents=100_000, periods=52) == {"sit": "typed"}
