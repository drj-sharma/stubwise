"""Loads the tax figures generated from the TypeScript data files.

``data/tax-data.json`` is a byte-for-byte copy of
packages/domain/parity/tax-data.json (see scripts/sync_tax_data.py). No tax
figure is typed into Python anywhere.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

TAX_DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "tax-data.json"
TAX_DATA: dict[str, Any] = json.loads(TAX_DATA_PATH.read_text(encoding="utf-8"))

# JSON object keys are strings; years are looked up as numbers.
FEDERAL_DATA: dict[int, dict[str, Any]] = {int(year): data for year, data in TAX_DATA["federal"].items()}
STATE_RULES: dict[int, dict[str, dict[str, Any]]] = {int(year): rules for year, rules in TAX_DATA["states"].items()}
NO_WAGE_INCOME_TAX_STATES: tuple[str, ...] = tuple(TAX_DATA["noWageIncomeTaxStates"])
PAY_PERIODS_PER_YEAR: dict[str, int] = dict(TAX_DATA["payPeriodsPerYear"])

KNOWN_STATE_RULE_KINDS = frozenset({"flat"})
_ROUNDING = frozenset({"cent", "dollar"})


def _check_state_rules() -> None:
    """Refuses to start with a state rule this code cannot apply.

    A rule kind added to the TypeScript before it is ported here must stop the
    server, not quietly withhold nothing for that state.
    """
    for year, rules in STATE_RULES.items():
        for state, rule in rules.items():
            kind = rule.get("kind")
            if kind not in KNOWN_STATE_RULE_KINDS:
                raise RuntimeError(
                    f"tax-data.json: {state} {year} has state rule kind {kind!r}, which app/domain/tax/state.py "
                    "does not implement. Port it from packages/domain/src/tax/state.ts first."
                )
            if rule.get("round") not in _ROUNDING or not isinstance(rule.get("rateBasisPoints"), int):
                raise RuntimeError(f"tax-data.json: {state} {year} flat rule needs rateBasisPoints and round")


_check_state_rules()
