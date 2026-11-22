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
PAY_PERIODS_PER_YEAR: dict[str, int] = dict(TAX_DATA["payPeriodsPerYear"])
# State tax rules are not read from here: they live in the tax_rules table (app/tax_rules).
