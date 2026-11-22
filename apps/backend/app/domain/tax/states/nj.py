"""New Jersey withholding: the percentage method (Tables for Percentage Method of Withholding, Rates A-E).

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/NJ.json).

1. Rate table: the letter the worker entered on NJ-W4 line 3 (``options.rateTable``);
   otherwise the one for their line 2 filing status (Rate A for single or married
   filing separately, Rate B for the others).
2. Taxable wages = wages - NJ-W4 line 4 allowances x the period's allowance value.
3. On the period's table for that rate: the row whose "over" the taxable wages
   exceed; withhold the row's amount + its percent of the excess over that figure.

A pay frequency without its own table is worked out on the annual table: taxable
wages x pay periods, the annual table, divided back by pay periods.
"""

from __future__ import annotations

from collections.abc import Sequence
from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, count, option, pct, per_period, status_of


def _row_tax(taxable: Fraction, rows: Sequence[Sequence[Any]]) -> Fraction:
    """The row's amount + its percent of the excess over its "over" figure, on the last row ``taxable`` exceeds."""
    if taxable <= 0:
        return Fraction(0)
    chosen = rows[0]
    for row in rows:
        if taxable > row[0]:
            chosen = row
    over, rate, base = chosen
    return Fraction(base) + (taxable - over) * pct(rate)


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    periods = str(inp.periods_per_year)
    key = periods if periods in params["tables"] else "1"
    chosen = option(inp, "rateTable")
    rate = chosen if chosen in params["tables"][key] else params["rateForStatus"][status]

    wages = Fraction(max(0, inp.wages_cents))
    if key == periods:
        taxable = wages - count(inp, "allowances") * params["allowanceCents"][key]
        annual_tax = _row_tax(taxable, params["tables"][key][rate]) * inp.periods_per_year
    else:
        taxable = wages * inp.periods_per_year - count(inp, "allowances") * params["allowanceCents"]["1"]
        annual_tax = _row_tax(taxable, params["tables"]["1"][rate])
    return Withheld(per_period(annual_tax, inp, params.get("round", "cent")))
