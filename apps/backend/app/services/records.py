"""Businesses and workers.

Isolation rule for this whole package: every query names the owner. A row is
fetched with ``WHERE id = ? AND user_id = ?``, never by id alone, and a row
that belongs to someone else is reported exactly like one that does not exist.
"""

from __future__ import annotations

import base64
from typing import Any, TypeVar

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..domain.tax.types import normalize_tax_profile
from ..errors import ApiError
from ..models import Base, Business, Stub, Worker, iso_z, utcnow
from ..plans import entitlements
from ..schemas import BusinessCreate, BusinessPatch, WorkerCreate, WorkerPatch

Row = TypeVar("Row", bound=Base)

_NOT_FOUND = {
    Business: ("business_not_found", "Set up your business first."),
    Worker: ("worker_not_found", "No such worker."),
    Stub: ("stub_not_found", "No such stub."),
}

DEFAULT_PAGE, MAX_PAGE = 50, 200


def owned(db: Session, model: type[Row], user_id: str, row_id: str) -> Row:
    row = db.scalar(select(model).where(model.id == row_id, model.user_id == user_id))  # type: ignore[attr-defined]
    if row is None:
        code, message = _NOT_FOUND[model]  # type: ignore[index]
        raise ApiError(404, code, message)
    return row


def check_version(request: Request, row: Any) -> None:
    """Optimistic concurrency: ``If-Match: <version>`` makes an update fail if the row changed since it was read."""
    expected = request.headers.get("if-match")
    if expected is None:
        return
    if expected.strip().strip('"') != str(row.version):
        raise ApiError(
            412,
            "version_conflict",
            "This record was changed elsewhere since you loaded it. Reload it and try again.",
            {"currentVersion": row.version},
        )


def touch(row: Any) -> None:
    row.version += 1
    row.updated_at = utcnow()


def encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(f"o:{offset}".encode()).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> int:
    if cursor is None:
        return 0
    try:
        kind, _, value = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode().partition(":")
        offset = int(value)
        if kind != "o" or offset < 0:
            raise ValueError
    except ValueError:
        raise ApiError(400, "invalid_cursor", "That cursor is not valid. Start again without one.") from None
    return offset


def page(items: list[Any], offset: int, limit: int) -> tuple[list[Any], str | None]:
    """``items`` holds up to ``limit + 1`` rows; the extra one only says whether there is a next page."""
    return items[:limit], encode_cursor(offset + limit) if len(items) > limit else None


# ---- Business -----------------------------------------------------------------


def get_business(db: Session, user_id: str) -> Business:
    business = db.scalar(select(Business).where(Business.user_id == user_id).order_by(Business.created_at))
    if business is None:
        raise ApiError(404, *_NOT_FOUND[Business])
    return business


def create_business(db: Session, user_id: str, plan: str, body: BusinessCreate) -> Business:
    count = db.scalar(select(func.count()).select_from(Business).where(Business.user_id == user_id)) or 0
    if count >= entitlements(plan).max_businesses:
        raise ApiError(409, "business_exists", "This account already has a business. Update it instead.")
    business = Business(
        user_id=user_id,
        name=body.name,
        address=body.address,
        phone=body.phone,
        state=body.state,
        employer_id=body.employerId,
        logo_data_uri=body.logoDataUri,
        pay_schedule=body.paySchedule,
        first_pay_date=body.firstPayDate,
        show_employer_id=body.showEmployerId,
        template_id=body.templateId,
        accent=body.accent,
        overtime_pct=body.overtimePct,
        appearance=body.appearance,
    )
    db.add(business)
    db.commit()
    return business


_BUSINESS_COLUMNS = {
    "name": "name",
    "address": "address",
    "phone": "phone",
    "state": "state",
    "employerId": "employer_id",
    "logoDataUri": "logo_data_uri",
    "paySchedule": "pay_schedule",
    "firstPayDate": "first_pay_date",
    "showEmployerId": "show_employer_id",
    "templateId": "template_id",
    "accent": "accent",
    "overtimePct": "overtime_pct",
    "appearance": "appearance",
}
# Fields that may be cleared by sending null; null for any other field is refused.
_BUSINESS_NULLABLE = {"state", "employerId", "logoDataUri", "firstPayDate"}


def update_business(db: Session, business: Business, body: BusinessPatch) -> Business:
    changes = body.model_dump(exclude_unset=True)
    _refuse_nulls(changes, _BUSINESS_NULLABLE)
    for field, value in changes.items():
        setattr(business, _BUSINESS_COLUMNS[field], value)
    if changes:
        touch(business)
    db.commit()
    return business


def business_json(business: Business) -> dict[str, Any]:
    return {
        "id": business.id,
        "name": business.name,
        "address": business.address,
        "phone": business.phone,
        "state": business.state,
        "employerId": business.employer_id,
        "logoDataUri": business.logo_data_uri,
        "paySchedule": business.pay_schedule,
        "firstPayDate": business.first_pay_date,
        "showEmployerId": business.show_employer_id,
        "templateId": business.template_id,
        "accent": business.accent,
        "overtimePct": business.overtime_pct,
        "appearance": business.appearance,
        "version": business.version,
        "createdAt": iso_z(business.created_at),
        "updatedAt": iso_z(business.updated_at),
    }


# ---- Workers ------------------------------------------------------------------


def list_workers(db: Session, user_id: str) -> list[Worker]:
    """Every worker, in the order the app lists them."""
    return list(
        db.scalars(select(Worker).where(Worker.user_id == user_id).order_by(Worker.created_at, Worker.name, Worker.id))
    )


def create_worker(db: Session, user_id: str, plan: str, body: WorkerCreate) -> Worker:
    business = get_business(db, user_id)
    count = db.scalar(select(func.count()).select_from(Worker).where(Worker.user_id == user_id)) or 0
    limit = entitlements(plan).max_workers
    if count >= limit:
        raise ApiError(409, "worker_limit_reached", f"This account can have at most {limit} workers.")
    worker = Worker(
        user_id=user_id,
        business_id=business.id,
        name=body.name,
        address=body.address,
        type=body.type,
        pay_type=body.payType,
        rate_cents=body.rateCents,
        default_deductions=[d.model_dump() for d in body.defaultDeductions],
        starting_ytd=body.startingYtd.model_dump() if body.startingYtd else None,
        tax_profile=body.taxProfile.model_dump(),
    )
    db.add(worker)
    db.commit()
    return worker


_WORKER_COLUMNS = {
    "name": "name",
    "address": "address",
    "type": "type",
    "payType": "pay_type",
    "rateCents": "rate_cents",
    "defaultDeductions": "default_deductions",
    "startingYtd": "starting_ytd",
    "taxProfile": "tax_profile",
}


def update_worker(db: Session, worker: Worker, body: WorkerPatch) -> Worker:
    # mode="json" so nested models arrive as the plain dicts the JSON columns store.
    changes = body.model_dump(exclude_unset=True, mode="json")
    _refuse_nulls(changes, {"startingYtd"})
    for field, value in changes.items():
        setattr(worker, _WORKER_COLUMNS[field], value)
    if changes:
        touch(worker)
    db.commit()
    return worker


def worker_json(worker: Worker) -> dict[str, Any]:
    return {
        "id": worker.id,
        "name": worker.name,
        "address": worker.address,
        "type": worker.type,
        "payType": worker.pay_type,
        "rateCents": worker.rate_cents,
        "defaultDeductions": worker.default_deductions,
        "startingYtd": worker.starting_ytd,
        # Normalised on the way out, so a profile stored before a field existed still has every field.
        "taxProfile": normalize_tax_profile(worker.tax_profile),
        "version": worker.version,
        "createdAt": iso_z(worker.created_at),
        "updatedAt": iso_z(worker.updated_at),
    }


def _refuse_nulls(changes: dict[str, Any], nullable: set[str]) -> None:
    for field, value in changes.items():
        if value is None and field not in nullable:
            raise ApiError(
                400, "invalid_request", "The request is not valid.", [{"path": field, "message": "may not be null"}]
            )
