"""WI state income tax withholding: Publication W-166, Alternate Method of Withholding.

1. annual gross = wages x pay periods
2. less the deduction for the WT-4 status: the full ``deduction.amountCents`` below
   ``deduction.fullBelowCents``, then reduced by ``deduction.phaseOutPercent`` of
   annual gross above that, never below zero
3. less ``exemptionCents`` for each WT-4 exemption: the annual net wage
4. tax from ``brackets``, rows ``[over_cents, rate percent, base_cents]`` with the
   base as the guide prints it ("$451.70 + 4.65% of excess over $12,760")
5. divided by pay periods

"Married, but withhold at higher Single rate" has its own status whose figures are
the single ones. With no WT-4 on file the worker claims zero exemptions.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, by_status, count, pct, per_period, status_of


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    gross = inp.annual_wages
    rule = by_status(params["deduction"], status)
    deduction = Fraction(rule["amountCents"])
    if gross >= rule["fullBelowCents"]:
        deduction -= (gross - rule["fullBelowCents"]) * pct(rule["phaseOutPercent"])
    net = gross - max(Fraction(0), deduction) - count(inp, "allowances") * Fraction(params["exemptionCents"])
    if net <= 0:
        return Withheld(0)
    over, rate, base = next(row for row in reversed(by_status(params["brackets"], status)) if net > row[0])
    annual = (net - over) * pct(rate) + base
    return Withheld(per_period(annual, inp, params.get("round", "cent")))
