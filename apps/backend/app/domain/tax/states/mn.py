"""MN state income tax withholding: the Computer Formula in the Minnesota Income Tax
Withholding Instruction Booklet.

1. annual wages = wages x pay periods
2. less ``allowanceCents`` for each W-4MN allowance; zero or less withholds nothing
3. tax from the chart for the W-4MN marital status: rows ``[over_cents, rate percent,
   base_cents]``, the base being the chart's printed "Add" amount
4. divided by pay periods

"Married, but withhold at higher Single rate" has its own status whose chart is the
single one. With no W-4MN on file: single with zero allowances.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, by_status, count, pct, per_period, status_of


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    status = status_of(params, inp)
    taxable = inp.annual_wages - count(inp, "allowances") * Fraction(params["allowanceCents"])
    rows = by_status(params["brackets"], status)
    if taxable <= rows[0][0]:
        return Withheld(0)
    over, rate, base = next(row for row in reversed(rows) if taxable > row[0])
    annual = (taxable - over) * pct(rate) + base
    return Withheld(per_period(annual, inp, params.get("round", "cent")))
