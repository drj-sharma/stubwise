"""Massachusetts income tax withholding: Circular M percentage method (2026, Rev. 12/25).

Per pay period, following the circular's steps:

1. less the Social Security and Medicare withheld this period, until
   ``ficaCapCents`` ($2,000) has been subtracted in the year. Earlier in the
   year is estimated as ``ficaRatePercent`` of the wages paid so far, which is
   exact below the Social Security wage base.
2. less the exemption factor for the pay period: ``one`` for one exemption,
   ``per`` x exemptions + ``plus`` for more than one (none for zero).
3. times pay periods in the year.
4. ``ratePercent`` up to ``surtaxThresholdCents``, ``surtaxPercent`` above it.
5. divided by pay periods.
6. less the head-of-household tax value, when claimed.
7. less the blindness tax value, when claimed.

Nothing is withheld from a worker claiming one or more exemptions whose pay is
below ``minWagesCents`` for the period. The period figures are keyed by pay
periods per year (52, 26, 24, 12, 1) in ``byPeriods``; every figure is in the
income row's params.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, count, option, pct, round_half_up


def _period_figures(params: dict[str, Any], periods: int) -> dict[str, Any]:
    table = params["byPeriods"]
    if str(periods) in table:
        return table[str(periods)]
    # A pay frequency the circular has no table for: the annual figures spread over the year.
    annual = table["1"]
    return {key: Fraction(value) / periods for key, value in annual.items()}


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    figures = _period_figures(params, inp.periods_per_year)
    exemptions = count(inp, "allowances")
    wages = Fraction(max(0, inp.wages_cents))
    if exemptions >= 1 and wages < Fraction(figures["minWagesCents"]):
        return Withheld(0)

    # Step 1: FICA withheld, up to the yearly cap.
    already = min(
        Fraction(params["ficaCapCents"]), Fraction(max(0, inp.prior_ytd_wages_cents)) * pct(params["ficaRatePercent"])
    )
    fica = min(Fraction(max(0, inp.fica_cents)), Fraction(params["ficaCapCents"]) - already)
    # Step 2: exemption factor for the period.
    if exemptions == 0:
        factor = Fraction(0)
    elif exemptions == 1:
        factor = Fraction(figures["one"])
    else:
        factor = Fraction(figures["per"]) * exemptions + Fraction(figures["plus"])
    # Steps 3 to 5.
    annual = max(Fraction(0), wages - fica - factor) * inp.periods_per_year
    threshold = Fraction(params["surtaxThresholdCents"])
    tax = min(annual, threshold) * pct(params["ratePercent"]) + max(Fraction(0), annual - threshold) * pct(
        params["surtaxPercent"]
    )
    per_period = tax / inp.periods_per_year
    # Steps 6 and 7.
    if option(inp, "headOfHousehold") is True:
        per_period -= Fraction(figures["hoh"])
    if option(inp, "blind") is True:
        per_period -= Fraction(figures["blind"])
    return Withheld(round_half_up(max(Fraction(0), per_period)))
