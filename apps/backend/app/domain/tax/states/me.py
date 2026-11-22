"""ME state income tax withholding: the Maine percentage method.

1. annualized wages = wages x pay periods;
2. less allowances claimed on Form W-4ME x ``exemptionCents``;
3. less the withholding standard deduction (``standardDeduction`` by status):
   the full ``amountCents`` up to ``phaseOutStartCents`` of annualized wages,
   none from ``phaseOutEndCents``, and in between the amount x
   (end - annualized wages) / (end - start), that ratio rounded to
   ``phaseOutRatioDecimals`` places;
4. tax on what is left from ``brackets`` (by status): rows of
   ``[at_least_cents, base_cents, rate]``, the base plus the rate on the part
   over the row's start;
5. plus ``surcharge.ratePercent`` of annualized income over
   ``surcharge.overCents`` (by status);
6. divided by pay periods, rounded to the dollar (``round``).

"Married, but withholding at higher single rate" uses the single figures (the
``*`` entries). A worker with no Form W-4ME is withheld on as single with no
allowances. Every figure is in this state's income row of the tax_rules table
(seeded from app/tax_rules/data/<year>/ME.json); figures that changed during the
year arrive already chosen for the pay date (``params.earlier``; an earlier
``surcharge`` of null means none).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, by_status, count, pct, per_period, round_half_up, status_of


def _standard_deduction(rule: Mapping[str, Any], annual: Fraction, decimals: int) -> Fraction:
    start, end = Fraction(rule["phaseOutStartCents"]), Fraction(rule["phaseOutEndCents"])
    if annual <= start:
        return Fraction(rule["amountCents"])
    if annual >= end:
        return Fraction(0)
    scale = 10**decimals
    ratio = Fraction(round_half_up((end - annual) / (end - start) * scale), scale)
    return rule["amountCents"] * ratio


def _schedule_tax(income: Fraction, rows: Sequence[Sequence[Any]]) -> Fraction:
    tax = Fraction(0)
    for at_least, base, rate in rows:
        if income >= at_least:
            tax = base + (income - at_least) * pct(rate)
    return tax


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    annual = inp.annual_wages
    deduction = _standard_deduction(
        by_status(params["standardDeduction"], status), annual, int(params.get("phaseOutRatioDecimals", 4))
    )
    income = annual - count(inp, "allowances") * params["exemptionCents"] - deduction
    if income <= 0:
        return Withheld(0)
    tax = _schedule_tax(income, by_status(params["brackets"], status))
    surcharge = params.get("surcharge")
    if surcharge:
        over = income - by_status(surcharge["overCents"], status)
        if over > 0:
            tax += over * pct(surcharge["ratePercent"])
    return Withheld(per_period(tax, inp, params.get("round", "dollar")))
