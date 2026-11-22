"""OR state income tax withholding: Oregon Withholding Tax Formulas (150-206-436), annual wages formula.

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/OR.json).

1. Which formula: the ``married`` one for a married worker or a single worker with
   ``marriedTableFromAllowances`` or more allowances, else the ``single`` one.
   "Married, but withhold at the higher single rate" counts as single.
2. BASE = annual wages - federal tax withheld (annualized, at most the cap for the
   worker's wages: ``federalTaxCapCents``, single or married phase-out, by status)
   - the standard deduction for the formula.
3. Annual wages below ``highWagesFromCents``: ``lowWageFormula``; otherwise
   ``highWageFormula``, and above ``noAllowancesAboveCents`` (by status) the
   allowances count as 0.
4. WH = plus + rate x (BASE - over) for the formula row BASE falls in
   (rows are ``[at_least_cents, plus_cents, rate_percent, over_cents]``), less the
   allowance credit for each allowance, divided by pay periods.

With no OR-W-4 on file (no status given), Oregon law (HB 2119, 2019) has the employer
withhold a flat ``noCertificateRatePercent`` of wages.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, count, pct, per_period, round_half_up


def _row(rows: list[list[Any]], amount: Fraction) -> list[Any]:
    """The last row whose first figure is at or below ``amount`` (rows ascending)."""
    return next(row for row in reversed(rows) if amount >= row[0])


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = inp.cert.get("status")
    if status not in params["statuses"]:
        return Withheld(round_half_up(Fraction(max(0, inp.wages_cents)) * pct(params["noCertificateRatePercent"])))
    filer = "married" if status in params["marriedStatuses"] else "single"
    allowances = count(inp, "allowances")
    formula = "married" if filer == "married" or allowances >= int(params["marriedTableFromAllowances"]) else "single"

    wages = inp.annual_wages
    federal_cap = _row(params["federalTaxCapCents"][filer], wages)[1]
    federal = min(Fraction(max(0, inp.federal_tax_cents) * inp.periods_per_year), Fraction(federal_cap))
    base = max(Fraction(0), wages - federal - params["standardDeductionCents"][formula])

    if wages < params["highWagesFromCents"]:
        rows = params["lowWageFormula"][formula]
    else:
        rows = params["highWageFormula"][formula]
        if wages > params["noAllowancesAboveCents"][filer]:
            allowances = 0
    _, plus, rate, over = _row(rows, base)
    tax = plus + (base - over) * pct(rate) - allowances * Fraction(params["allowanceCreditCents"])
    return Withheld(per_period(max(Fraction(0), tax), inp, params.get("round", "cent")))
