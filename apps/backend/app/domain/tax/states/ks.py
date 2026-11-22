"""KS state income tax withholding: the KW-100 percentage formula.

1. withholding allowance amount for the payroll period
   (``allowanceCents[periods]``): the first allowances claimed on Form K-4 are
   personal exemptions (``personalAllowances[status]`` of them: one for the
   Single rate, two for Joint, worth ``single`` or ``married`` in the table),
   each further allowance is worth ``additional``;
2. wages less that amount;
3. tax from the payroll period's table for the status (``tables[periods]``):
   each row is ``[over_cents, base_cents, rate]``, the tax being the base plus
   the rate on the part over ``over_cents`` (none below the first row).

A payroll period without its own table uses the annual table on annualized
wages, divided back by the number of periods. A worker with no K-4 is withheld
on at the Single rate with no allowances. Every figure is in this state's
income row of the tax_rules table (seeded from app/tax_rules/data/<year>/KS.json).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, by_status, count, pct, round_half_up, status_of


def _table_tax(amount: Fraction, rows: Sequence[Sequence[Any]]) -> Fraction:
    tax = Fraction(0)
    for over, base, rate in rows:
        if amount > over:
            tax = base + (amount - over) * pct(rate)
    return tax


def _allowance_amount(params: Mapping[str, Any], values: Mapping[str, int], status: str, claimed: int) -> int:
    personal = int(by_status(params["personalAllowances"], status))
    if claimed <= 0:
        return 0
    if claimed >= personal:
        return values[status] + (claimed - personal) * values["additional"]
    # Fewer than the status's personal allowances: each is one Single personal allowance.
    return claimed * values["single"]


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    key = str(inp.periods_per_year)
    if key in params["tables"]:
        wages, divisor = Fraction(max(0, inp.wages_cents)), 1
    else:
        key, wages, divisor = "1", inp.annual_wages, inp.periods_per_year
    taxable = wages - _allowance_amount(params, params["allowanceCents"][key], status, count(inp, "allowances"))
    tax = max(Fraction(0), _table_tax(taxable, by_status(params["tables"][key], status)))
    if params.get("round", "cent") == "dollar":
        # KW-100 allows rounding the period amount to the whole dollar.
        return Withheld(round_half_up(tax / divisor / 100) * 100)
    return Withheld(round_half_up(tax / divisor))
