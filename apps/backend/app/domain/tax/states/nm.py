"""NM state income tax withholding: FYI-104, tables for the percentage method of withholding.

New Mexico has no withholding certificate of its own; the status comes from the federal W-4.
``params.tables`` holds the publication's table for each payroll period, keyed by pay periods
per year ("52", "26", "24", "12", ...), then by status. Each row is
``[over_cents, base_cents, "rate percent"]``: on wages over ``over``, withhold ``base`` plus
the rate on the excess over ``over``; wages not over the first row's ``over`` have none.

A pay frequency without its own table uses the annual table ("1") on annualized wages,
divided back by the pay periods.
"""

from __future__ import annotations

from collections.abc import Sequence
from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, pct, round_half_up, status_of


def _from_table(wages: Fraction, rows: Sequence[Sequence[Any]]) -> Fraction:
    tax = Fraction(0)
    for over, base, rate in rows:
        if wages > over:
            tax = base + (wages - over) * pct(rate)
    return tax


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    wages = Fraction(max(0, inp.wages_cents))
    tables = params["tables"]
    if str(inp.periods_per_year) in tables:
        tax = _from_table(wages, tables[str(inp.periods_per_year)][status])
    else:
        tax = _from_table(inp.annual_wages, tables["1"][status]) / inp.periods_per_year
    return Withheld(round_half_up(max(Fraction(0), tax)))
