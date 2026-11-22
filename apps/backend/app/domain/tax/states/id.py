"""ID state income tax withholding: the common annualized method (see _common.annualized).

Idaho's annualized wage method: annual wages, less the ID W-4 allowances, taxed at the flat rate
above the annual table's threshold for the withholding status, divided by pay periods and
rounded to the whole dollar. The figures, and the guide they come from, are in this state's
income row of the tax_rules table (seeded from app/tax_rules/data/<year>/ID.json).
"""

from __future__ import annotations

from typing import Any

from ._common import StateInput, Withheld, annualized


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    return annualized(params, inp)
