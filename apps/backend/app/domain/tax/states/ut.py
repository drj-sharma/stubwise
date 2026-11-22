"""UT state income tax withholding: Publication 14, Utah withholding schedules.

Utah has no withholding certificate of its own; the status comes from the federal W-4.
``params.schedules`` holds the schedule for each payroll period, keyed by pay periods per year,
then by status: ``baseAllowanceCents`` and ``phaseOutOverCents``. For one pay period:

1. Utah taxable wages
2. line 1 x ``ratePercent``
3. the base allowance
4. line 1 less ``phaseOutOverCents`` (not less than 0)
5. line 4 x ``phaseOutRatePercent``
6. line 3 less line 5 (not less than 0)
7. line 2 less line 6 (not less than 0): the withholding

With ``round: "dollar-each-line"`` lines 2 and 5 are rounded to the whole dollar, as the
publication's examples are; with ``cent`` only the result is rounded. A pay frequency without
its own schedule uses the annual one ("1") on annualized wages, divided back by the pay periods.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, pct, round_half_up, status_of


def _dollars(value: Fraction) -> Fraction:
    return Fraction(round_half_up(value / 100) * 100)


def _schedule(params: dict[str, Any], schedule: dict[str, Any], wages: Fraction) -> Fraction:
    by_dollar = params.get("round") == "dollar-each-line"
    tax = wages * pct(params["ratePercent"])  # line 2
    phase_out = max(Fraction(0), wages - schedule["phaseOutOverCents"]) * pct(params["phaseOutRatePercent"])  # 5
    if by_dollar:
        tax, phase_out = _dollars(tax), _dollars(phase_out)
    allowance = max(Fraction(0), schedule["baseAllowanceCents"] - phase_out)  # line 6
    return max(Fraction(0), tax - allowance)  # line 7


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    schedules = params["schedules"]
    if str(inp.periods_per_year) in schedules:
        tax = _schedule(params, schedules[str(inp.periods_per_year)][status], Fraction(max(0, inp.wages_cents)))
    else:
        tax = _schedule(params, schedules["1"][status], inp.annual_wages) / inp.periods_per_year
    return Withheld(round_half_up(tax))
