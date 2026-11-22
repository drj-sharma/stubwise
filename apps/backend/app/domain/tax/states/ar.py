"""AR state income tax withholding: the DFA "Withholding Tax Formula Method".

1. annual gross pay = period pay x pay periods
2. net taxable income = annual gross pay - ``standardDeductionCents``; below
   ``midrange.belowCents`` it is looked up at the middle of its $100 range (``stepCents``):
   $23,054 becomes $23,050; from there up it is the whole-dollar figure
3. annual gross tax = income x rate - adjustment, from the ``brackets`` row
   (``[from_cents, rate_percent, minus_cents]``, the last row whose ``from_cents`` the income
   reaches), rounded to the dollar (``grossTaxRound``)
4. less the personal tax credit per AR4EC exemption (``creditPerField``), not below zero
5. divided by pay periods

With no AR4EC on file there are no exemptions (the default). The DFA's low-income tax
tables (AR4EC line 5) are published only as wage tables, so they are not applied here.

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/AR.json).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, count, pct, per_period, round_half_up


def _lookup_income(net: Fraction, midrange: Mapping[str, int]) -> Fraction:
    step = midrange["stepCents"]
    if net < midrange["belowCents"]:
        return Fraction((net // step) * step + step // 2)
    return Fraction((net // 100) * 100)


def _gross_tax(income: Fraction, rows: Sequence[Sequence[Any]]) -> Fraction:
    rate, minus = Fraction(0), 0
    for start, row_rate, row_minus in rows:
        if income >= start:
            rate, minus = pct(row_rate), row_minus
    return max(Fraction(0), income * rate - minus)


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    net = inp.annual_wages - params["standardDeductionCents"]
    if net <= 0:
        return Withheld(0)
    tax = _gross_tax(_lookup_income(net, params["midrange"]), params["brackets"])
    if params.get("grossTaxRound") == "dollar":
        tax = Fraction(round_half_up(tax / 100) * 100)
    for field_name, amount in (params.get("creditPerField") or {}).items():
        tax -= count(inp, field_name) * amount
    return Withheld(per_period(max(Fraction(0), tax), inp, params.get("round", "cent")))
