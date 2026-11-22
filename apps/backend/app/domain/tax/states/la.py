"""LA state income tax withholding: the common annualized method (see _common.annualized).

R-1306 (1/26) formula: W = (S - standard deduction / N) x 3.09%, which is the same as
(annual wages - standard deduction) x 3.09% / N. The L-4 Block A choice (0, 1 or 2) is the
status; with no L-4 on file nothing is deducted (status "0").

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/LA.json).
"""

from __future__ import annotations

from typing import Any

from ._common import StateInput, Withheld, annualized


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    return annualized(params, inp)
