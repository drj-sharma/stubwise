"""OK state income tax withholding: the Packet OW-2 percentage formula method.

1. net wages = period wages - OK-W-4 allowances x the allowance amount for the pay
   frequency (``allowanceCents``, keyed by pay periods per year)
2. tax = the base amount plus the rate on the excess over the row's threshold, from the
   pay frequency's Single or Married table (``tables[periods][tableFor[status]]``,
   rows ``[over_cents, base_cents, rate_percent]``)
3. rounded to the nearest dollar

"Married, but withhold at higher Single rate" uses the Single table. With no OK-W-4 on file
the worker is single with no allowances (OAC 710:90-1-7).

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/OK.json).
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, count, pct, round_half_up, status_of


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    periods = str(inp.periods_per_year)
    status = status_of(params, inp)
    rows = params["tables"][periods][params["tableFor"][status]]
    net = Fraction(max(0, inp.wages_cents)) - count(inp, "allowances") * params["allowanceCents"][periods]
    tax = Fraction(0)
    for over, base, rate in rows:
        if net > over:
            tax = base + (net - over) * pct(rate)
    if params.get("round") == "dollar":
        return Withheld(round_half_up(tax / 100) * 100)
    return Withheld(round_half_up(tax))
