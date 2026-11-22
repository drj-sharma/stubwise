"""SC state income tax withholding: the SC withholding tax formula (WH-1603F).

1. annual wages = wages x pay periods
2. less ``allowanceCents`` per SC W-4 allowance and, only when at least one
   allowance is claimed, a standard deduction of ``standardDeductionPercent``
   of annual wages up to ``standardDeductionMaxCents``
3. tax on what is left from ``brackets``
4. divided by pay periods, rounded as ``round`` says

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/SC.json).
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, bracket_tax, count, pct, per_period


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    annual = inp.annual_wages
    allowances = count(inp, "allowances")
    taxable = annual - allowances * params["allowanceCents"]
    if allowances > 0:
        deduction = min(annual * pct(params["standardDeductionPercent"]), Fraction(params["standardDeductionMaxCents"]))
        taxable -= deduction
    tax = bracket_tax(max(Fraction(0), taxable), params["brackets"])
    return Withheld(per_period(tax, inp, params.get("round", "cent")))
