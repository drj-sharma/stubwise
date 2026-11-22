"""CA state income tax withholding: EDD Method B, Exact Calculation Method, on annual figures.

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/CA.json). EDD lets the
employer work on the annual payroll period and divide back to the pay period
(Method B, notes to Examples E and F), so every table here is the annual one:

1. Annual wages at or below the low income exemption: nothing is withheld.
2. Less the estimated deduction for each estimated deduction allowance.
3. Less the standard deduction.
4. Tax from the rate table for the status: the amount for the row plus the
   row's rate on the part over the row's start.
5. Less the exemption allowance credit for each regular allowance.
6. Divided by pay periods.

A married worker (one income) with fewer than ``marriedHigherAmountsFromAllowances``
regular allowances gets the single low income exemption and standard deduction
(key ``M``); with that many or more, the higher ones (key ``M2+``). The rate table
is the married one either way. With no DE 4 on file the worker is single with zero
allowances (``defaultStatus``), whatever the federal W-4 says.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, by_status, count, pct, per_period


def _figure_key(params: dict[str, Any], status: str, allowances: int) -> str:
    if status == "M" and allowances >= int(params["marriedHigherAmountsFromAllowances"]):
        return "M2+"
    return status


def _table_tax(taxable: Fraction, rows: list[list[Any]]) -> Fraction:
    """Rate table lookup: ``rows`` are ``[over_cents, rate_percent, plus_cents]``, ascending."""
    if taxable <= 0:
        return Fraction(0)
    over, rate, plus = next(row for row in reversed(rows) if taxable > row[0])
    return Fraction(plus) + (taxable - over) * pct(rate)


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    given = inp.cert.get("status")
    status: str = given if given in params["statuses"] else params["defaultStatus"]
    allowances = count(inp, "allowances")
    key = _figure_key(params, status, allowances)
    wages = inp.annual_wages
    if wages <= by_status(params["lowIncomeExemptionCents"], key):
        return Withheld(0)
    taxable = wages - count(inp, "additionalAllowances") * Fraction(params["estimatedDeductionCents"])
    taxable -= by_status(params["standardDeductionCents"], key)
    tax = _table_tax(max(Fraction(0), taxable), by_status(params["taxRates"], status))
    tax -= allowances * Fraction(params["allowanceCreditCents"])
    return Withheld(per_period(max(Fraction(0), tax), inp, params.get("round", "cent")))
