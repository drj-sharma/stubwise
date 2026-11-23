"""Earnings and deductions reports: totals over a range of pay dates, per worker and overall.

Worked out here from the saved stubs, never in the app. A stub belongs to a
report when its pay date is in the range (both ends included), which is how
payroll is reported for tax purposes.
"""

from __future__ import annotations

import csv
import io
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.calc_stub import line_key
from ..domain.money import Cents
from ..models import Stub, Worker
from . import records


def _stubs(db: Session, user_id: str, start: str, end: str) -> list[Stub]:
    return list(
        db.scalars(
            select(Stub)
            .where(Stub.user_id == user_id, Stub.pay_date >= start, Stub.pay_date <= end)
            .order_by(Stub.pay_date, Stub.created_at, Stub.id)
        )
    )


def _workers(db: Session, user_id: str) -> dict[str, Worker]:
    return {worker.id: worker for worker in records.list_workers(db, user_id)}


class _Lines:
    """Line totals grouped by kind and label (ignoring case and spacing), in the order first seen."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}

    def add(
        self,
        key: str,
        label: str,
        amount: Cents,
        minutes: int | None,
        tax_code: str | None,
        quantity_milli: int | None = None,
        unit: str | None = None,
    ) -> None:
        row = self.rows.setdefault(
            key,
            {
                "key": key,
                "label": label,
                "amountCents": 0,
                "minutes": 0,
                "taxCode": tax_code,
                "quantityMilli": 0,
                "unit": None,
            },
        )
        row["amountCents"] += amount
        row["minutes"] += minutes or 0
        if quantity_milli is not None:
            row["quantityMilli"] += quantity_milli
            row["unit"] = row["unit"] or unit

    def list(self) -> list[dict[str, Any]]:
        return list(self.rows.values())


def _worker_entry(worker: Worker | None, worker_id: str) -> dict[str, Any]:
    return {
        "workerId": worker_id,
        "name": worker.name if worker else "Deleted worker",
        "type": worker.type if worker else "employee",
        "stubCount": 0,
    }


def earnings(db: Session, user_id: str, start: str, end: str) -> dict[str, Any]:
    """Pay by worker and by kind of pay (Regular, Overtime, Bonus, Miles...), with hours or units."""
    workers = _workers(db, user_id)
    per_worker: dict[str, tuple[dict[str, Any], _Lines]] = {}
    overall = _Lines()
    stub_count = 0
    for stub in _stubs(db, user_id, start, end):
        stub_count += 1
        entry, lines = per_worker.setdefault(
            stub.worker_id, (_worker_entry(workers.get(stub.worker_id), stub.worker_id), _Lines())
        )
        entry["stubCount"] += 1
        for line in stub.lines:
            if line.kind != "earning":
                continue
            key = line_key(line.kind, line.label)
            lines.add(key, line.label, line.amount_cents, line.minutes, None, line.quantity_milli, line.unit)
            overall.add(key, line.label, line.amount_cents, line.minutes, None, line.quantity_milli, line.unit)

    def summary(lines: _Lines) -> dict[str, Any]:
        rows = [{k: v for k, v in row.items() if k != "taxCode"} for row in lines.list()]
        for row in rows:
            if row["unit"] is None:  # not a per-unit kind of pay
                row["quantityMilli"] = None
        return {
            "lines": rows,
            "grossCents": sum(row["amountCents"] for row in rows),
            "minutes": sum(row["minutes"] for row in rows),
        }

    return {
        "from": start,
        "to": end,
        "stubCount": stub_count,
        "workers": [{**entry, **summary(lines)} for entry, lines in per_worker.values()],
        "totals": summary(overall),
    }


def deductions(db: Session, user_id: str, start: str, end: str) -> dict[str, Any]:
    """Taxes and other deductions by worker and by line, with gross and net for context."""
    workers = _workers(db, user_id)
    per_worker: dict[str, tuple[dict[str, Any], _Lines, list[Cents]]] = {}
    overall = _Lines()
    overall_gross = [0]
    stub_count = 0
    for stub in _stubs(db, user_id, start, end):
        stub_count += 1
        entry, lines, gross = per_worker.setdefault(
            stub.worker_id, (_worker_entry(workers.get(stub.worker_id), stub.worker_id), _Lines(), [0])
        )
        entry["stubCount"] += 1
        for line in stub.lines:
            if line.kind == "earning":
                gross[0] += line.amount_cents
                overall_gross[0] += line.amount_cents
                continue
            # Tax lines are grouped by tax code (the label can change with the state); others by label.
            key = f"tax:{line.tax_code}" if line.tax_code else line_key(line.kind, line.label)
            lines.add(key, line.label, line.amount_cents, None, line.tax_code)
            overall.add(key, line.label, line.amount_cents, None, line.tax_code)

    def summary(lines: _Lines, gross: Cents) -> dict[str, Any]:
        rows = [{k: v for k, v in row.items() if k not in ("minutes", "quantityMilli", "unit")} for row in lines.list()]
        taxes = [row for row in rows if row["taxCode"]]
        other = [row for row in rows if not row["taxCode"]]
        taxes_cents = sum(row["amountCents"] for row in taxes)
        other_cents = sum(row["amountCents"] for row in other)
        return {
            "taxes": taxes,
            "other": other,
            "taxesCents": taxes_cents,
            "otherCents": other_cents,
            "deductionsCents": taxes_cents + other_cents,
            "grossCents": gross,
            "netCents": gross - taxes_cents - other_cents,
        }

    return {
        "from": start,
        "to": end,
        "stubCount": stub_count,
        "workers": [{**entry, **summary(lines, gross[0])} for entry, lines, gross in per_worker.values()],
        "totals": summary(overall, overall_gross[0]),
    }


def _money(cents: Cents) -> str:
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}{cents // 100}.{cents % 100:02d}"


def _hours(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d}" if minutes else ""


def _quantity(milli: int | None) -> str:
    """12500 -> "12.5": units are kept in thousandths, shown with the zeros trimmed."""
    if milli is None:
        return ""
    whole, part = divmod(milli, 1000)
    return f"{whole}.{part:03d}".rstrip("0").rstrip(".")


def earnings_csv(report: dict[str, Any]) -> str:
    """One row per worker and kind of pay, then the totals: for a spreadsheet or an accountant."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Earnings report", f"{report['from']} to {report['to']}"])
    writer.writerow(["Worker", "Pay", "Hours", "Quantity", "Unit", "Amount"])

    def row(who: str, line: dict[str, Any]) -> list[str]:
        return [
            who,
            line["label"],
            _hours(line["minutes"]),
            _quantity(line.get("quantityMilli")),
            line.get("unit") or "",
            _money(line["amountCents"]),
        ]

    for worker in report["workers"]:
        for line in worker["lines"]:
            writer.writerow(row(worker["name"], line))
        writer.writerow([worker["name"], "Gross pay", _hours(worker["minutes"]), "", "", _money(worker["grossCents"])])
    for line in report["totals"]["lines"]:
        writer.writerow(row("All workers", line))
    writer.writerow(
        [
            "All workers",
            "Gross pay",
            _hours(report["totals"]["minutes"]),
            "",
            "",
            _money(report["totals"]["grossCents"]),
        ]
    )
    return out.getvalue()


def deductions_csv(report: dict[str, Any]) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Deductions report", f"{report['from']} to {report['to']}"])
    writer.writerow(["Worker", "Deduction", "Type", "Amount"])
    for name, summary in [*((w["name"], w) for w in report["workers"]), ("All workers", report["totals"])]:
        for line in summary["taxes"]:
            writer.writerow([name, line["label"], "Tax", _money(line["amountCents"])])
        for line in summary["other"]:
            writer.writerow([name, line["label"], "Other", _money(line["amountCents"])])
        writer.writerow([name, "Total deductions", "", _money(summary["deductionsCents"])])
    return out.getvalue()
