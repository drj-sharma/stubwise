"""Worker-paid state contributions and local taxes worked out by shared formulas.

``capped_rate`` (disability, family leave, paid leave, worker unemployment,
long-term care, transit): a percent of wages, stopping at an annual wage base
or an annual or weekly maximum. ``local_rate``: a percent of wages for the
county or city the worker chose on their profile.

The figures come from the rule's ``params``:

capped_rate
    ``code``, ``label``, ``ratePercent``; optional ``wageBaseCents`` (no more
    is charged on wages above it in a calendar year), ``maxAnnualCents`` (the
    most charged in a year), ``maxPerWeekCents`` (the most per week, as New
    York's disability insurance), ``optional`` (true when the worker can be
    excluded: then it is only charged when ``cert.options[code]`` is not false).

local_rate
    ``label`` (with "{name}" for the place), ``localities`` (code -> ``name``,
    ``ratePercent``, optional ``code`` for the line's tax code, default
    ``local``), ``choose`` (what the place is called: "County", "City").
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ..money import Cents
from .states._common import StateInput, pct, round_half_up


def capped_rate(params: dict[str, Any], inp: StateInput) -> tuple[str, str, Cents] | None:
    code, label = params["code"], params["label"]
    if params.get("optional") and (inp.cert.get("options") or {}).get(code) is False:
        return None
    wages = Fraction(max(0, inp.wages_cents))
    prior = Fraction(max(0, inp.prior_ytd_wages_cents))
    rate = pct(params["ratePercent"])
    if "wageBaseCents" in params and params["wageBaseCents"] is not None:
        wages = max(Fraction(0), min(wages, Fraction(params["wageBaseCents"]) - prior))
    amount = wages * rate
    if params.get("maxAnnualCents") is not None:
        already = min(Fraction(params["maxAnnualCents"]), prior * rate)
        amount = min(amount, Fraction(params["maxAnnualCents"]) - already)
    if params.get("maxPerWeekCents") is not None:
        weeks = Fraction(52, inp.periods_per_year)
        amount = min(amount, Fraction(params["maxPerWeekCents"]) * weeks)
    return (code, label, round_half_up(max(Fraction(0), amount)))


def local_rate(params: dict[str, Any], inp: StateInput) -> list[tuple[str, str, Cents]]:
    chosen = inp.cert.get("localities") or []
    lines = []
    for key in chosen:
        place = params.get("localities", {}).get(key)
        if not place:
            continue
        label = params.get("label", "{name} tax").replace("{name}", place["name"])
        amount = round_half_up(Fraction(max(0, inp.wages_cents)) * pct(place["ratePercent"]))
        lines.append((f"local:{key}"[:20], label, amount))
    return lines
