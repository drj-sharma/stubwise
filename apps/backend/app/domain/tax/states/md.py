"""MD state income tax withholding: the Maryland Employer Withholding Guide percentage method.

Maryland withholds its state tax and the county (or Baltimore City) tax as one
figure, worked out on the same taxable wages:

1. no withholding when the period's gross wages are below ``minimumWagesCents``
   for the pay frequency (keyed by pay periods per year; annual figure ``"1"``
   is used, annualized, for any other frequency)
2. annual taxable wages = wages x pay periods, less ``standardDeductionCents``,
   less ``exemptionCents`` per MW507 exemption. With no MW507 on file (no
   status, no exemptions and no county given) the guide says to withhold as if
   ``noCertificate.allowances`` exemptions were claimed.
3. state tax from ``brackets`` (by status: the joint rate for ``M``, the single
   rate otherwise)
4. local tax on the same taxable wages: the chosen county's ``ratePercent``,
   or its graduated ``brackets`` (by status); a nonresident's special rate is
   one of the choices. With no county chosen, ``defaultLocalRatePercent``.
5. state + local, divided by pay periods, rounded as ``round`` says

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/MD.json).
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, bracket_tax, by_status, count, pct, per_period, status_of


def _no_certificate(inp: StateInput) -> bool:
    return not inp.cert.get("status") and count(inp, "allowances") == 0 and not inp.cert.get("localities")


def _local_tax(params: dict[str, Any], inp: StateInput, status: str, taxable: Fraction) -> Fraction:
    rates = params["localRates"]
    chosen = next((code for code in inp.cert.get("localities") or [] if code in rates), None)
    if chosen is None:
        return taxable * pct(params["defaultLocalRatePercent"])
    place = rates[chosen]
    if "brackets" in place:
        return bracket_tax(taxable, by_status(place["brackets"], status))
    return taxable * pct(place["ratePercent"])


def _below_minimum(params: dict[str, Any], inp: StateInput) -> bool:
    minimums = params.get("minimumWagesCents") or {}
    key = str(inp.periods_per_year)
    if key in minimums:
        return inp.wages_cents < minimums[key]
    if "1" in minimums:
        return inp.annual_wages < minimums["1"]
    return False


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    if _below_minimum(params, inp):
        return Withheld(0)
    status = status_of(params, inp)
    exemptions = params["noCertificate"]["allowances"] if _no_certificate(inp) else count(inp, "allowances")
    taxable = inp.annual_wages - params["standardDeductionCents"] - exemptions * params["exemptionCents"]
    taxable = max(Fraction(0), taxable)
    tax = bracket_tax(taxable, by_status(params["brackets"], status)) + _local_tax(params, inp, status, taxable)
    return Withheld(per_period(tax, inp, params.get("round", "cent")))
