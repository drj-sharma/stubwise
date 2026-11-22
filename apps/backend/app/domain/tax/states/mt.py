"""MT state income tax withholding: the Montana Withholding Tax Formula, W = A + B x (G - C).

``params.tables`` holds the guide's table for each payroll period, keyed by pay periods per
year, then by table name; ``params.tableFor`` maps each MW-4 status to its table (line 2,
married with both spouses working, uses the single table). Each row is
``[at_least_cents, A_cents, "B percent"]`` with C equal to ``at_least``: wages G of at least
that amount use the row. Wages below the first row have nothing withheld. The result is
rounded to the dollar as ``round`` says.

MW-4 line 4 (``options.specifiedCents``): the employee directs the employer to withhold
only that amount, instead of the formula.

A pay frequency without its own table uses the annual table ("1") on annualized wages,
divided back by the pay periods.
"""

from __future__ import annotations

from collections.abc import Sequence
from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, option, pct, per_period, status_of


def _from_table(wages: Fraction, rows: Sequence[Sequence[Any]]) -> Fraction:
    tax = Fraction(0)
    for at_least, base, rate in rows:
        if wages >= at_least:
            tax = base + (wages - at_least) * pct(rate)
    return tax


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    specified = option(inp, "specifiedCents")
    if specified not in (None, "") and int(specified) > 0:
        return Withheld(int(specified))
    table = params["tableFor"][status_of(params, inp)]
    tables = params["tables"]
    if str(inp.periods_per_year) in tables:
        tax = _from_table(Fraction(max(0, inp.wages_cents)), tables[str(inp.periods_per_year)][table])
    else:
        tax = _from_table(inp.annual_wages, tables["1"][table]) / inp.periods_per_year
    # per_period divides by pay periods; pass the annual equivalent so it rounds once.
    return Withheld(per_period(tax * inp.periods_per_year, inp, params.get("round", "dollar")))
