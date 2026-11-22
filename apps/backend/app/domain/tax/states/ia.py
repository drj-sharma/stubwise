"""IA state income tax withholding: the common annualized method (see _common.annualized).

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/IA.json).
"""

from __future__ import annotations

from typing import Any

from ._common import StateInput, Withheld, annualized


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    return annualized(params, inp)
