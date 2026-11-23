"""Import and export of a user's records as one snapshot.

PUT replaces everything the user has with the snapshot; GET returns it in the
same shape. The snapshot keeps the original backup format (periodStart /
periodEnd on stubs) so a backup made by an older app still imports.

Ids are not preserved: rows get new server ids on import, and the worker ids
inside stubs are remapped. Two users importing the same file must not collide,
and a client-chosen id must never be able to address someone else's row.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..domain.money import format_cents
from ..domain.tax.types import normalize_tax_profile
from ..domain.time import pay_for_minutes
from ..errors import ApiError
from ..models import Business, Stub, StubLine, Worker, as_utc, iso_z, utcnow
from ..schemas import Snapshot
from . import audit, records


def verify_snapshot(snapshot: Snapshot) -> None:
    """Cross-record checks that a schema cannot express.

    Every hourly line is recalculated with the same rounding the app uses and
    a backup whose stored amount disagrees is refused, so a bug or a tampered
    client cannot plant wrong pay figures.
    """
    problems: list[dict[str, str]] = []
    worker_ids: set[str] = set()
    for worker in snapshot.workers:
        if worker.id in worker_ids:
            problems.append({"workerId": worker.id, "message": "duplicate worker id"})
        worker_ids.add(worker.id)

    stub_ids: set[str] = set()
    for stub in snapshot.stubs:
        if stub.id in stub_ids:
            problems.append({"stubId": stub.id, "message": "duplicate stub id"})
        stub_ids.add(stub.id)
        if stub.workerId not in worker_ids:
            problems.append({"stubId": stub.id, "message": f"unknown worker {stub.workerId}"})
        if stub.periodEnd < stub.periodStart:
            problems.append({"stubId": stub.id, "message": "period ends before it starts"})
        for line in stub.lines:
            if line.minutes is None or line.rateCents is None:
                continue
            expected = pay_for_minutes(line.minutes, line.rateCents)
            if expected != line.amountCents:
                message = (
                    f'"{line.label}" should be {format_cents(expected)} for its hours and rate, '
                    f"but {format_cents(line.amountCents)} was sent"
                )
                problems.append({"stubId": stub.id, "message": message})
    if problems:
        raise ApiError(422, "snapshot_rejected", "The backup contains records that do not add up.", problems[:20])


def _when(value: str | None, fallback: datetime) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else fallback


def import_snapshot(db: Session, user_id: str, snapshot: Snapshot) -> dict[str, Any]:
    """Replaces all of the user's records in one transaction: all of it is saved, or none of it."""
    now = utcnow()
    _clear(db, user_id)
    source = snapshot.business
    business = Business(
        user_id=user_id,
        name=source.name,
        address=source.address,
        phone=source.phone,
        state=source.state,
        employer_id=source.employerId,
        logo_data_uri=source.logoDataUri,
        pay_schedule=source.paySchedule,
        show_employer_id=source.showEmployerId,
        template_id=source.templateId,
        accent=source.accent,
        overtime_pct=source.overtimePct,
        appearance=source.appearance,
        show_pto=source.showPto,
        show_employer_taxes=source.showEmployerTaxes,
        show_deposit_slip=source.showDepositSlip,
        created_at=now,
        updated_at=now,
    )
    db.add(business)
    db.flush()
    workers: dict[str, Worker] = {}
    for item in snapshot.workers:
        worker = Worker(
            user_id=user_id,
            business_id=business.id,
            name=item.name,
            address=item.address,
            type=item.type,
            pay_type=item.payType,
            rate_cents=item.rateCents,
            default_deductions=[d.model_dump() for d in item.defaultDeductions],
            starting_ytd=item.startingYtd.model_dump() if item.startingYtd else None,
            tax_profile=item.taxProfile.model_dump(),
            pto_start=item.ptoStart.model_dump() if item.ptoStart else None,
            created_at=_when(item.createdAt, now),
            updated_at=now,
        )
        db.add(worker)
        workers[item.id] = worker
    db.flush()
    for entry in snapshot.stubs:
        stub = Stub(
            user_id=user_id,
            worker_id=workers[entry.workerId].id,
            period_start=entry.periodStart,
            period_end=entry.periodEnd,
            pay_date=entry.payDate,
            pto=entry.pto.model_dump() if entry.pto else None,
            employer_taxes=[tax.model_dump() for tax in entry.employerTaxes] if entry.employerTaxes else None,
            created_at=_when(entry.createdAt, now),
            updated_at=now,
        )
        stub.lines = [
            StubLine(
                position=position,
                kind=line.kind,
                label=line.label,
                minutes=line.minutes,
                rate_cents=line.rateCents,
                amount_cents=line.amountCents,
                source=line.source,
                tax_code=line.taxCode,
            )
            for position, line in enumerate(entry.lines)
        ]
        db.add(stub)
    counts = {"workers": len(snapshot.workers), "stubs": len(snapshot.stubs)}
    audit.record(db, user_id, "backup.imported", counts)
    db.commit()
    return {"savedAt": iso_z(now), **counts}


def export_snapshot(db: Session, user_id: str) -> dict[str, Any] | None:
    business = db.scalar(select(Business).where(Business.user_id == user_id).order_by(Business.created_at))
    if business is None:
        return None
    workers = records.list_workers(db, user_id)
    stubs = db.scalars(
        select(Stub).where(Stub.user_id == user_id).order_by(Stub.pay_date, Stub.created_at, Stub.id)
    ).all()
    return {
        "savedAt": iso_z(max(as_utc(row.updated_at) for row in [business, *workers, *stubs])),
        "business": {
            "id": business.id,
            "name": business.name,
            "address": business.address,
            "phone": business.phone,
            "state": business.state,
            "employerId": business.employer_id,
            "logoDataUri": business.logo_data_uri,
            "paySchedule": business.pay_schedule,
            "showEmployerId": business.show_employer_id,
            "templateId": business.template_id,
            "accent": business.accent,
            "overtimePct": business.overtime_pct,
            "appearance": business.appearance,
            "showPto": business.show_pto,
            "showEmployerTaxes": business.show_employer_taxes,
            "showDepositSlip": business.show_deposit_slip,
        },
        "workers": [
            {
                "id": worker.id,
                "name": worker.name,
                "address": worker.address,
                "type": worker.type,
                "payType": worker.pay_type,
                "rateCents": worker.rate_cents,
                "defaultDeductions": worker.default_deductions,
                "startingYtd": worker.starting_ytd,
                "taxProfile": normalize_tax_profile(worker.tax_profile),
                "createdAt": iso_z(worker.created_at),
                # Left out when unset, so a backup stays as small and as old-format as it was.
                **({"ptoStart": worker.pto_start} if worker.pto_start else {}),
            }
            for worker in workers
        ],
        "stubs": [
            {
                "id": stub.id,
                "workerId": stub.worker_id,
                "periodStart": stub.period_start,
                "periodEnd": stub.period_end,
                "payDate": stub.pay_date,
                "createdAt": iso_z(stub.created_at),
                "lines": [
                    {
                        "kind": line.kind,
                        "label": line.label,
                        "minutes": line.minutes,
                        "rateCents": line.rate_cents,
                        "amountCents": line.amount_cents,
                        "source": line.source,
                        # Left out when unset, as the app writes it.
                        **({"taxCode": line.tax_code} if line.tax_code is not None else {}),
                    }
                    for line in stub.lines
                ],
                **({"pto": stub.pto} if stub.pto else {}),
                **({"employerTaxes": stub.employer_taxes} if stub.employer_taxes else {}),
            }
            for stub in stubs
        ],
    }


def delete_records(db: Session, user_id: str) -> None:
    """Deletes the user's business, workers and stubs. The account itself stays; see DELETE /v1/me."""
    _clear(db, user_id)
    audit.record(db, user_id, "backup.deleted")
    db.commit()


def _clear(db: Session, user_id: str) -> None:
    # Workers and stubs go with the business through ON DELETE CASCADE.
    db.execute(delete(Business).where(Business.user_id == user_id))
    db.expire_all()
