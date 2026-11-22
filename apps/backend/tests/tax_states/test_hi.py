"""Hawaii, 2026: both lines are typed by the employer for now.

Income tax: Booklet A (2026) could not be read from the Department of Taxation's site (it blocks
automated access), so its figures are not encoded. TDI: the employee share depends on the employer's
plan (half its cost, at most 0.5% of weekly wages up to the DLIR weekly wage base), so it is typed.
"""

from __future__ import annotations

from .helpers import withhold


def test_income_and_tdi_are_typed() -> None:
    assert withhold("HI", 2026, wages_cents=100_000, periods=52) == {"sit": "typed", "sdi": "typed"}
