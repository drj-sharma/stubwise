"""New York State, New York City and Yonkers withholding: the exact calculation method.

Publications NYS-50-T-NYS, NYS-50-T-NYC and NYS-50-T-Y, Method II (exact calculation)
and Method III (top income tax rates). The figures, and the guide they come from, are
in this state's income row of the tax_rules table (seeded from
app/tax_rules/data/<year>/NY.json).

New York State (Method II):

1. net wages = wages - (deduction allowance for the period and status
   + IT-2104 line 1 allowances x exemption allowance for the period)
2. find the row of the period's table whose "at least" the net wages reach;
   withhold column 5 + (net wages - column 3) x column 4. The tables already carry
   New York's recapture of the lower brackets for high earners.
3. Method III: when net wages x pay periods reach the first ``topRates`` figure,
   withhold net wages x that row's rate instead.

New York City residents: the same steps with the city's own deduction allowance,
the IT-2104 line 2 allowances and the city's tables (it has no Method III).

Yonkers residents: 16.75% of the New York State figure (before any extra amount).
Yonkers nonresidents (Method VIII): annualized wages, less the exclusion for that
band, x 0.50%, divided by pay periods; nothing when annualized wages are under $4,000.

A pay frequency without its own table is worked out on the annual table: the
period's net wages x pay periods, the annual table, divided back by pay periods
(the conversion the publications describe).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, by_status, count, option, pct, round_half_up, status_of


def _row_tax(net: Fraction, rows: Sequence[Sequence[Any]]) -> Fraction:
    """Column 5 + (net - column 3) x column 4, on the last row whose "at least" ``net`` reaches."""
    if net <= 0:
        return Fraction(0)
    chosen = rows[0]
    for row in rows:
        if net >= row[0]:
            chosen = row
    at_least, rate, add = chosen
    return Fraction(add) + (net - at_least) * pct(rate)


def _exact(spec: Mapping[str, Any], status: str, allowances: int, inp: StateInput) -> Fraction:
    """One Method II (and, for the state, Method III) calculation, in cents for the period."""
    periods = inp.periods_per_year
    key = str(periods) if str(periods) in spec["tables"] else "1"
    scale = 1 if key == str(periods) else periods  # annual table: work on the annualized amount
    wages = Fraction(max(0, inp.wages_cents)) * scale
    allowance = by_status(spec["deductionCents"][key], status) + allowances * spec["exemptionCents"][key]
    net = max(Fraction(0), wages - allowance)
    annual_net = net * (periods if scale == 1 else 1)
    top_rates = by_status(spec["topRates"], status) if "topRates" in spec else []
    top = [row for row in top_rates if annual_net >= row[0]]
    tax = net * pct(top[-1][1]) if top else _row_tax(net, by_status(spec["tables"][key], status))
    return tax / scale


def _yonkers_nonresident(spec: Mapping[str, Any], inp: StateInput) -> Fraction:
    annual = Fraction(max(0, inp.wages_cents) * inp.periods_per_year)
    rows = [row for row in spec["exclusions"] if annual > row[0]]
    if not rows:
        return Fraction(0)
    return (annual - rows[-1][1]) * pct(spec["ratePercent"]) / inp.periods_per_year


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    state_tax = _exact(params, status, count(inp, "allowances"), inp)
    lines: list[tuple[str, str, int]] = []

    if option(inp, "nycResident") is True and "nyc" in params:
        spec = params["nyc"]
        cents = round_half_up(_exact(spec, status, count(inp, "nycAllowances"), inp))
        lines.append(("local:NYC", spec["label"], cents + max(0, count(inp, "nycExtraCents"))))

    yonkers = option(inp, "yonkers")
    if yonkers == "resident" and "yonkersResident" in params:
        spec = params["yonkersResident"]
        cents = round_half_up(state_tax * pct(spec["ratePercent"]))
        lines.append(("local:YONKERS-R", spec["label"], cents + max(0, count(inp, "yonkersExtraCents"))))
    elif yonkers == "nonresident" and "yonkersNonresident" in params:
        spec = params["yonkersNonresident"]
        cents = round_half_up(_yonkers_nonresident(spec, inp))
        lines.append(("local:YONKERS-N", spec["label"], cents + max(0, count(inp, "yonkersExtraCents"))))

    return Withheld(round_half_up(state_tax), lines)
