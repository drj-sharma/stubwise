"""MS state income tax withholding: the Computer Payroll Accounting flowchart.

1. annual pay = period pay x pay periods
2. taxable income = annual pay - (exemption claimed + standard deduction for the marital status)
3. tax from ``brackets`` (nothing on the first $10,000, the rate above it)
4. divided by pay periods, rounded to whole dollars

The exemption is the dollar total the worker wrote on Form 89-350, Line 6, kept in the
certificate's ``options[params["exemptionOption"]]`` (cents). With no 89-350 on file the
worker is single with no exemption (the defaults).

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/MS.json).
"""

from __future__ import annotations

from typing import Any

from ._common import StateInput, Withheld, bracket_tax, by_status, count, per_period, status_of


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    exemption = max(0, count(inp, params["exemptionOption"]))
    taxable = inp.annual_wages - exemption - by_status(params["standardDeductionCents"], status)
    tax = bracket_tax(taxable, params["brackets"])
    return Withheld(per_period(tax, inp, params.get("round", "cent")))
