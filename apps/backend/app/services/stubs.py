"""Pay stubs: the app's stub actions, run on the server with the same calculations.

Mirrors apps/mobile/src/services/stubs.ts and taxes.ts. Totals and
year-to-date are computed from the saved lines on every read and never stored,
so they cannot drift from the history they summarise.

Like the app, changing one stub does not rewrite later stubs: a later stub's
Social Security or Additional Medicare figure is brought up to date the next
time that stub's own lines or dates are saved.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.calc_stub import calc_stub, with_computed_amount
from ..domain.next_stub import draft_next_stub
from ..domain.pay_period import add_days, current_period, default_pay_date, diff_days, year_of
from ..domain.tax.apply_taxes import TaxContext, apply_taxes, is_tax_override, work_state
from ..domain.tax.types import normalize_tax_profile
from ..domain.ytd import compute_ytd, prior_ytd_gross
from ..errors import ApiError
from ..models import Business, Stub, StubLine, Worker, as_utc, iso_z, utcnow
from ..tax_rules.store import RULES
from . import records

Line = dict[str, Any]


def _sort_key(value: datetime) -> str:
    """Fixed-width UTC text, so comparing strings (as the calculations do) compares instants."""
    return as_utc(value).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _domain_line(row: StubLine) -> Line:
    line: Line = {
        "kind": row.kind,
        "label": row.label,
        "minutes": row.minutes,
        "rateCents": row.rate_cents,
        "amountCents": row.amount_cents,
        "source": row.source,
    }
    if row.tax_code is not None:
        line["taxCode"] = row.tax_code
    return line


def _ytd_stub(stub: Stub) -> dict[str, Any]:
    return {
        "id": stub.id,
        "payDate": stub.pay_date,
        "createdAt": _sort_key(stub.created_at),
        "lines": [_domain_line(row) for row in stub.lines],
    }


def _worker_profile(worker: Worker) -> dict[str, Any]:
    return {
        "payType": worker.pay_type,
        "rateCents": worker.rate_cents,
        "type": worker.type,
        "defaultDeductions": worker.default_deductions,
    }


def worker_stubs(db: Session, worker: Worker) -> list[Stub]:
    """A worker's stubs, newest first: the order the app uses to find "the previous stub"."""
    return list(
        db.scalars(
            select(Stub)
            .where(Stub.worker_id == worker.id, Stub.user_id == worker.user_id)
            .order_by(Stub.pay_date.desc(), Stub.created_at.desc(), Stub.id)
        )
    )


def tax_context(
    db: Session, business: Business, worker: Worker, target: dict[str, Any], history: Sequence[dict[str, Any]]
) -> TaxContext:
    """What the tax calculation needs to know about one stub: who, where, when, pay so far this
    year, and the work state's tax rules for that year (from the tax_rules table)."""
    # Nothing is withheld from a 1099 contractor.
    profile = None if worker.type == "contractor" else normalize_tax_profile(worker.tax_profile)
    year = year_of(target["payDate"])
    state = work_state(profile, business.state)
    return {
        "profile": profile,
        "businessState": business.state,
        "year": year,
        "schedule": business.pay_schedule,  # type: ignore[typeddict-item]
        "priorYtdGrossCents": prior_ytd_gross(target, history, worker.starting_ytd),  # type: ignore[arg-type]
        "stateRules": list(RULES.for_state(db, year, state)) if state else [],  # type: ignore[typeddict-item]
        "payDate": target["payDate"],
    }


def _unsaved(pay_date: str) -> dict[str, Any]:
    """Stands in for a stub about to be saved, so it sorts after every stub already on record."""
    return {"id": "unsaved", "payDate": pay_date, "createdAt": _sort_key(utcnow()), "lines": []}


def _set_lines(stub: Stub, lines: Sequence[Line]) -> None:
    stub.lines = [
        StubLine(
            position=position,
            kind=line["kind"],
            label=line["label"],
            minutes=line["minutes"],
            rate_cents=line["rateCents"],
            amount_cents=line["amountCents"],
            source=line["source"],
            tax_code=line.get("taxCode"),
        )
        for position, line in enumerate(lines)
    ]


def _insert(db: Session, worker: Worker, period: dict[str, str], pay_date: str, lines: Sequence[Line]) -> Stub:
    stub = Stub(
        user_id=worker.user_id,
        worker_id=worker.id,
        period_start=period["start"],
        period_end=period["end"],
        pay_date=pay_date,
    )
    _set_lines(stub, lines)
    db.add(stub)
    return stub


# ---- Actions ------------------------------------------------------------------


def create_next(db: Session, business: Business, worker: Worker, today: str) -> Stub:
    """ "Next pay period" for one worker: dates moved forward one period, the previous
    hours and deductions carried over, taxes worked out afresh."""
    stubs = worker_stubs(db, worker)
    draft = _draft(business, worker, stubs, today)
    history = [_ytd_stub(stub) for stub in stubs]
    lines = apply_taxes(draft["lines"], tax_context(db, business, worker, _unsaved(draft["payDate"]), history))["lines"]
    stub = _insert(db, worker, draft["period"], draft["payDate"], lines)  # type: ignore[arg-type]
    db.commit()
    return stub


def _draft(business: Business, worker: Worker, stubs: Sequence[Stub], today: str) -> Any:
    previous = (
        {
            "period": {"start": stubs[0].period_start, "end": stubs[0].period_end},
            "payDate": stubs[0].pay_date,
            "lines": [_domain_line(row) for row in stubs[0].lines],
        }
        if stubs
        else None
    )
    return draft_next_stub(
        _worker_profile(worker),  # type: ignore[arg-type]
        business.pay_schedule,  # type: ignore[arg-type]
        previous,  # type: ignore[arg-type]
        today,
        business.overtime_pct,
    )


def create_batch(db: Session, business: Business, user_id: str, today: str) -> tuple[dict[str, str], list[Stub]]:
    """This period's stub for every worker who does not have one yet.

    Each new stub starts from that worker's last stub, so hours are a starting
    point to check, not a final figure. All of them are saved, or none.
    """
    all_stubs = list(
        db.scalars(
            select(Stub).where(Stub.user_id == user_id).order_by(Stub.pay_date.desc(), Stub.created_at.desc(), Stub.id)
        )
    )
    latest: dict[str, str] | None = None
    for stub in all_stubs:
        if latest is None or stub.period_end > latest["end"]:
            latest = {"start": stub.period_start, "end": stub.period_end}
    period = current_period(latest, business.pay_schedule, today)  # type: ignore[arg-type]

    created = []
    for worker in records.list_workers(db, user_id):
        stubs = [stub for stub in all_stubs if stub.worker_id == worker.id]
        if any(stub.period_start == period["start"] for stub in stubs):
            continue
        draft = _draft(business, worker, stubs, today)
        # Keep this worker's usual gap between period end and pay date.
        pay_date = (
            add_days(period["end"], diff_days(stubs[0].period_end, stubs[0].pay_date))
            if stubs
            else default_pay_date(period)
        )
        history = [_ytd_stub(stub) for stub in stubs]
        lines = apply_taxes(draft["lines"], tax_context(db, business, worker, _unsaved(pay_date), history))["lines"]
        created.append(_insert(db, worker, period, pay_date, lines))  # type: ignore[arg-type]
    db.commit()
    return period, created  # type: ignore[return-value]


def replace_lines(db: Session, business: Business, worker: Worker, stub: Stub, lines: Sequence[Line]) -> Stub:
    """Saves edited lines. Hourly amounts are recalculated from minutes and rate, and
    the calculated tax lines are brought back in step with the pay."""
    history = [_ytd_stub(other) for other in worker_stubs(db, worker)]
    context = tax_context(db, business, worker, _ytd_stub(stub), history)
    taxed = apply_taxes([with_computed_amount(line) for line in lines], context)["lines"]  # type: ignore[arg-type]
    _replace(db, stub, taxed)
    return stub


def update_dates(
    db: Session,
    business: Business,
    worker: Worker,
    stub: Stub,
    *,
    period: dict[str, str] | None,
    pay_date: str | None,
) -> Stub:
    """Moves a stub. A different pay date can change the tax year and the pay counted
    before this stub, so its taxes are recalculated."""
    start, end = (period["start"], period["end"]) if period else (stub.period_start, stub.period_end)
    if end < start:
        problem = {"path": "period", "message": "period ends before it starts"}
        raise ApiError(400, "invalid_request", "The request is not valid.", [problem])
    stub.period_start, stub.period_end = start, end
    if pay_date is not None:
        stub.pay_date = pay_date
    history = [_ytd_stub(other) for other in worker_stubs(db, worker) if other.id != stub.id]
    target = _ytd_stub(stub)
    taxed = apply_taxes(target["lines"], tax_context(db, business, worker, target, [*history, target]))["lines"]
    _replace(db, stub, taxed)
    return stub


def _replace(db: Session, stub: Stub, lines: Sequence[Line]) -> None:
    # Two steps: the old rows must be gone before new ones reuse their positions.
    stub.lines = []
    db.flush()
    _set_lines(stub, lines)
    records.touch(stub)
    db.commit()


# ---- Reading ------------------------------------------------------------------


class StubView:
    """Turns stubs into API responses, loading each worker's history once however many stubs are shown."""

    def __init__(self, db: Session, user_id: str) -> None:
        self._db = db
        self._user_id = user_id
        self._business: Business | None = None
        self._workers: dict[str, tuple[Worker, list[dict[str, Any]]]] = {}

    def _history(self, worker_id: str) -> tuple[Worker, list[dict[str, Any]]]:
        if worker_id not in self._workers:
            worker = records.owned(self._db, Worker, self._user_id, worker_id)
            self._workers[worker_id] = (worker, [_ytd_stub(stub) for stub in worker_stubs(self._db, worker)])
        return self._workers[worker_id]

    def json(self, stub: Stub) -> dict[str, Any]:
        if self._business is None:
            self._business = records.get_business(self._db, self._user_id)
        worker, history = self._history(stub.worker_id)
        target = _ytd_stub(stub)
        # The stub itself may be newer than the cached history (it was just saved).
        history = [target if other["id"] == stub.id else other for other in history]
        context = tax_context(self._db, self._business, worker, target, history)
        ytd = compute_ytd(target, history, worker.starting_ytd)  # type: ignore[arg-type]
        lines = []
        for row, line in zip(stub.lines, target["lines"], strict=True):
            override = is_tax_override(
                line, profile=context["profile"], year=context["year"], state_rules=context["stateRules"]
            )
            lines.append({"id": row.id, **line, "taxCode": row.tax_code, "taxOverride": override})
        return {
            "id": stub.id,
            "workerId": stub.worker_id,
            "period": {"start": stub.period_start, "end": stub.period_end},
            "payDate": stub.pay_date,
            "lines": lines,
            "totals": calc_stub(target["lines"]),
            "ytd": {**ytd, "byLine": dict(sorted(ytd["byLine"].items()))},
            "taxStatus": apply_taxes(target["lines"], context)["status"],
            "version": stub.version,
            "createdAt": iso_z(stub.created_at),
            "updatedAt": iso_z(stub.updated_at),
        }
