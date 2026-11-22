"""Seeds the tax_rules table and serves its rows to the calculations.

The JSON files under data/ are the seed: one file per state (and DC) per year,
each a list of rules. On startup every rule is written to the database unless
the row there already has the same or a higher ``revision``, so a figure
corrected in the database is kept until the seed catches up.

The calculations read the database, through a cache that is reloaded when any
row changes (checked at most every ``CHECK_SECONDS``), so a correction made in
the database takes effect without a restart.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Iterable
from pathlib import Path
from typing import Any, TypedDict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import TaxRule, utcnow

log = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent / "data"
CHECK_SECONDS = 30.0

TAXES = ("income", "sdi", "fli", "pfml", "ui", "ltc", "transit", "local")
METHODS = ("none", "manual", "state", "capped_rate", "local_rate")


class Rule(TypedDict):
    year: int
    jurisdiction: str
    tax: str
    method: str
    params: dict[str, Any]
    source: str
    revision: int


def seed_files(data_dir: Path = DATA_DIR) -> list[Rule]:
    """Every rule in the seed files, checked for shape."""
    rules: list[Rule] = []
    for path in sorted(data_dir.glob("*/*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        year, jurisdiction = int(path.parent.name), path.stem.upper()
        if doc.get("year") != year or doc.get("jurisdiction") != jurisdiction:
            raise ValueError(f"{path}: year and jurisdiction must match the file's place ({year}, {jurisdiction})")
        taxes = set()
        for entry in doc["rules"]:
            tax, method = entry["tax"], entry["method"]
            if tax not in TAXES or method not in METHODS:
                raise ValueError(f"{path}: unknown tax {tax!r} or method {method!r}")
            if tax in taxes:
                raise ValueError(f"{path}: {tax} is listed twice")
            taxes.add(tax)
            rules.append(
                {
                    "year": year,
                    "jurisdiction": jurisdiction,
                    "tax": tax,
                    "method": method,
                    "params": entry.get("params", {}),
                    "source": entry.get("source", ""),
                    "revision": int(entry.get("revision", 1)),
                }
            )
        if "income" not in taxes:
            raise ValueError(f"{path}: every jurisdiction needs an income rule (method none, manual or state)")
    return rules


def seed(db: Session, rules: Iterable[Rule] | None = None) -> int:
    """Writes seed rules whose revision is newer than the database's. Returns how many rows changed."""
    rules = list(rules if rules is not None else seed_files())
    existing = {(row.year, row.jurisdiction, row.tax): row for row in db.scalars(select(TaxRule))}
    changed = 0
    for rule in rules:
        row = existing.get((rule["year"], rule["jurisdiction"], rule["tax"]))
        if row is None:
            db.add(TaxRule(**rule, updated_at=utcnow()))
            changed += 1
        elif row.revision < rule["revision"]:
            row.method, row.params, row.source, row.revision = (
                rule["method"],
                rule["params"],
                rule["source"],
                rule["revision"],
            )
            row.updated_at = utcnow()
            changed += 1
    db.commit()
    if changed:
        log.info("tax rules seeded: %d rows written", changed)
    return changed


class RuleCache:
    """The tax_rules table in memory, keyed by year and jurisdiction."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rules: dict[tuple[int, str], list[Rule]] = {}
        self._stamp: tuple[Any, int] | None = None
        self._checked = 0.0

    def _load(self, db: Session) -> None:
        stamp = db.execute(select(func.max(TaxRule.updated_at), func.count(TaxRule.id))).one()
        stamp_key = (stamp[0], stamp[1])
        if stamp_key == self._stamp:
            return
        rules: dict[tuple[int, str], list[Rule]] = {}
        for row in db.scalars(select(TaxRule).order_by(TaxRule.jurisdiction, TaxRule.tax)):
            rules.setdefault((row.year, row.jurisdiction), []).append(
                {
                    "year": row.year,
                    "jurisdiction": row.jurisdiction,
                    "tax": row.tax,
                    "method": row.method,
                    "params": row.params or {},
                    "source": row.source,
                    "revision": row.revision,
                }
            )
        self._rules, self._stamp = rules, stamp_key

    def refresh(self, db: Session, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._checked < CHECK_SECONDS:
            return
        with self._lock:
            self._load(db)
            self._checked = now

    def for_state(self, db: Session, year: int, jurisdiction: str) -> list[Rule]:
        """Every rule for one state and year; empty when that year has not been added."""
        self.refresh(db)
        return self._rules.get((year, jurisdiction), [])

    def years(self, db: Session) -> list[int]:
        self.refresh(db)
        return sorted({year for year, _ in self._rules})

    def all_for_year(self, db: Session, year: int) -> dict[str, list[Rule]]:
        self.refresh(db)
        return {jurisdiction: rules for (y, jurisdiction), rules in self._rules.items() if y == year}


RULES = RuleCache()
