"""NE state income tax withholding: Circular EN percentage method.

1. wages for the period, less the allowances claimed on Form W-4N x the value
   of one allowance for the payroll period (``allowanceCents[periods]``);
2. tax from the payroll period's table for the status (``tables[periods]``):
   each row is ``[over_cents, base_cents, rate]``, the tax being the base plus
   the rate on the part over ``over_cents`` (none below the first row).

A payroll period without its own table uses the annual table on annualized
wages, divided back by the number of periods. A worker with no Form W-4N is
withheld on as single with no allowances (``defaultStatus``; no allowances
are on file). Every figure is in this state's income row of the tax_rules
table (seeded from app/tax_rules/data/<year>/NE.json).
"""

from __future__ import annotations

from collections.abc import Sequence
from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, by_status, count, pct, round_half_up, status_of


def _table_tax(amount: Fraction, rows: Sequence[Sequence[Any]]) -> Fraction:
    tax = Fraction(0)
    for over, base, rate in rows:
        if amount > over:
            tax = base + (amount - over) * pct(rate)
    return tax


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    key = str(inp.periods_per_year)
    if key in params["tables"]:
        wages, divisor = Fraction(max(0, inp.wages_cents)), 1
    else:
        key, wages, divisor = "1", inp.annual_wages, inp.periods_per_year
    taxable = wages - count(inp, "allowances") * params["allowanceCents"][key]
    tax = _table_tax(taxable, by_status(params["tables"][key], status))
    return Withheld(round_half_up(max(Fraction(0), tax) / divisor))
