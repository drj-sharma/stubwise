"""OH state income tax withholding: the Ohio Optional Computer Formula.

    TW = (pay per period x PP) - (exemption amount x IT 4 exemptions)
    WD = ((TW - over) x rate + base) / PP

The guide gives each band's base as a published, rounded figure ("+ 2627.91"),
so each row of ``params.brackets`` is ``[over_cents, rate percent, base_cents]``
and the base is used as printed rather than rebuilt from the lower bands.
With no IT 4 on file the employer withholds as if zero exemptions were claimed.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, count, pct, per_period


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    taxable = inp.annual_wages - count(inp, "allowances") * Fraction(params["exemptionCents"])
    if taxable <= 0:
        return Withheld(0)
    over, rate, base = next(row for row in reversed(params["brackets"]) if taxable > row[0])
    annual = (taxable - over) * pct(rate) + base
    return Withheld(per_period(annual, inp, params.get("round", "cent")))
