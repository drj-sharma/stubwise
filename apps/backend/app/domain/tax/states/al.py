"""AL state income tax withholding: "Formula For Computing Alabama Withholding Tax".

1. gross income (GI) = wages x pay periods
2. deduct
   A. the standard deduction for the A-4 status: ``fullCents`` up to ``phaseOutOverCents``
      of GI, then ``reduceCents`` less for each ``stepCents`` of GI (or part of it) above
      that, never below ``minCents``
   B. the federal income tax withheld this period x pay periods (``subtractFederalTax``)
   C. the personal exemption for the status
   D. dependents x the amount for GI (``dependentCents``: ``[over_cents, amount]`` rows,
      the last row whose ``over_cents`` GI is above)
3. tax on what is left from ``brackets`` (by status)
4. divided by pay periods

With no A-4 on file the worker claims zero exemptions (status "0", no dependents).

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/AL.json).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, bracket_tax, by_status, count, per_period, status_of


def _standard_deduction(rule: Mapping[str, int], gross: Fraction) -> Fraction:
    over = rule["phaseOutOverCents"]
    if gross <= over:
        return Fraction(rule["fullCents"])
    steps = -((over - gross) // rule["stepCents"])  # each step "or part thereof" above the threshold
    return Fraction(max(rule["minCents"], rule["fullCents"] - steps * rule["reduceCents"]))


def _per_dependent(rows: Sequence[Sequence[int]], gross: Fraction) -> int:
    amount = rows[0][1]
    for over, value in rows:
        if gross > over:
            amount = value
    return amount


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    gross = inp.annual_wages
    deductions = _standard_deduction(by_status(params["standardDeduction"], status), gross)
    if params.get("subtractFederalTax"):
        deductions += max(0, inp.federal_tax_cents) * inp.periods_per_year
    deductions += by_status(params["personalExemptionCents"], status)
    deductions += count(inp, "dependents") * _per_dependent(params["dependentCents"], gross)
    tax = bracket_tax(gross - deductions, by_status(params["brackets"], status))
    return Withheld(per_period(tax, inp, params.get("round", "cent")))
