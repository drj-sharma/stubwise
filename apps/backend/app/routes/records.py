from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth.deps import current_principal, reader, writer
from ..auth.sessions import Principal
from ..db import get_session
from ..domain.pay_period import is_iso_date
from ..errors import ApiError
from ..models import Stub, Worker, utcnow
from ..schemas import (
    BatchOut,
    BusinessCreate,
    BusinessOut,
    BusinessPatch,
    LinesReplace,
    Snapshot,
    StubOut,
    StubPage,
    StubPatch,
    Today,
    WorkerCreate,
    WorkerOut,
    WorkerPage,
    WorkerPatch,
)
from ..services import backup, records, stubs
from ..services.idempotency import Idempotency

Limit = Annotated[int, Query(ge=1, le=records.MAX_PAGE, description="Page size.")]
Cursor = Annotated[str | None, Query(description="`nextCursor` from the previous page.")]

IF_MATCH = "Optional `If-Match: <version>` makes the change fail with 412 if the record changed since it was read."
IDEMPOTENT = "Optional `Idempotency-Key` makes a retry return the first result instead of creating a second record."

# ---- Business -----------------------------------------------------------------

business_router = APIRouter(prefix="/v1/business", tags=["Business"])


@business_router.get("", response_model=BusinessOut)
def get_business(user_id: str = Depends(reader), db: Session = Depends(get_session)) -> Any:
    return records.business_json(records.get_business(db, user_id))


@business_router.post("", response_model=BusinessOut, status_code=201, description=IDEMPOTENT)
def create_business(
    body: BusinessCreate,
    principal: Principal = Depends(current_principal),
    user_id: str = Depends(writer),
    idem: Idempotency = Depends(),
    db: Session = Depends(get_session),
) -> Any:
    return idem.run(
        user_id,
        body,
        201,
        lambda: records.business_json(records.create_business(db, user_id, principal.user.plan, body)),
    )


@business_router.patch("", response_model=BusinessOut, description=IF_MATCH)
def update_business(
    body: BusinessPatch, request: Request, user_id: str = Depends(writer), db: Session = Depends(get_session)
) -> Any:
    business = records.get_business(db, user_id)
    records.check_version(request, business)
    return records.business_json(records.update_business(db, business, body))


@business_router.delete("", status_code=204)
def delete_business(user_id: str = Depends(writer), db: Session = Depends(get_session)) -> Response:
    """Deletes the business with its workers and stubs."""
    business = records.get_business(db, user_id)
    db.delete(business)
    db.commit()
    return Response(status_code=204)


# ---- Workers ------------------------------------------------------------------

workers_router = APIRouter(prefix="/v1/workers", tags=["Workers"])


@workers_router.get("", response_model=WorkerPage)
def list_workers(
    limit: Limit = records.DEFAULT_PAGE,
    cursor: Cursor = None,
    user_id: str = Depends(reader),
    db: Session = Depends(get_session),
) -> Any:
    offset = records.decode_cursor(cursor)
    rows = db.scalars(
        select(Worker)
        .where(Worker.user_id == user_id)
        .order_by(Worker.created_at, Worker.name, Worker.id)
        .offset(offset)
        .limit(limit + 1)
    ).all()
    items, next_cursor = records.page(list(rows), offset, limit)
    return {"items": [records.worker_json(worker) for worker in items], "nextCursor": next_cursor}


@workers_router.post("", response_model=WorkerOut, status_code=201, description=IDEMPOTENT)
def create_worker(
    body: WorkerCreate,
    principal: Principal = Depends(current_principal),
    user_id: str = Depends(writer),
    idem: Idempotency = Depends(),
    db: Session = Depends(get_session),
) -> Any:
    return idem.run(
        user_id, body, 201, lambda: records.worker_json(records.create_worker(db, user_id, principal.user.plan, body))
    )


@workers_router.get("/{worker_id}", response_model=WorkerOut)
def get_worker(worker_id: str, user_id: str = Depends(reader), db: Session = Depends(get_session)) -> Any:
    return records.worker_json(records.owned(db, Worker, user_id, worker_id))


@workers_router.patch("/{worker_id}", response_model=WorkerOut, description=IF_MATCH)
def update_worker(
    worker_id: str,
    body: WorkerPatch,
    request: Request,
    user_id: str = Depends(writer),
    db: Session = Depends(get_session),
) -> Any:
    worker = records.owned(db, Worker, user_id, worker_id)
    records.check_version(request, worker)
    return records.worker_json(records.update_worker(db, worker, body))


@workers_router.delete("/{worker_id}", status_code=204)
def delete_worker(worker_id: str, user_id: str = Depends(writer), db: Session = Depends(get_session)) -> Response:
    """Deletes the worker and all their stubs."""
    db.delete(records.owned(db, Worker, user_id, worker_id))
    db.commit()
    return Response(status_code=204)


def _today(body: Today | None) -> str:
    """The user's date if the app sent it, else the server's UTC date."""
    today = body.today if body and body.today else utcnow().date().isoformat()
    if not is_iso_date(today):
        raise ApiError(400, "invalid_request", "The request is not valid.", [{"path": "today", "message": "bad date"}])
    return today


@workers_router.post(
    "/{worker_id}/stubs/next",
    response_model=StubOut,
    status_code=201,
    tags=["Stubs"],
    summary="Draft and save the worker's next stub",
    description="Dates move forward one pay period from the worker's newest stub (or start at the period "
    "containing `today`), hours and deductions carry over, and taxes are calculated. " + IDEMPOTENT,
)
def create_next_stub(
    worker_id: str,
    body: Today | None = None,
    user_id: str = Depends(writer),
    idem: Idempotency = Depends(),
    db: Session = Depends(get_session),
) -> Any:
    worker = records.owned(db, Worker, user_id, worker_id)
    business = records.get_business(db, user_id)
    today = _today(body)
    return idem.run(
        user_id,
        body,
        201,
        lambda: stubs.StubView(db, user_id).json(stubs.create_next(db, business, worker, today)),
    )


# ---- Stubs --------------------------------------------------------------------

stubs_router = APIRouter(prefix="/v1/stubs", tags=["Stubs"])


@stubs_router.get("", response_model=StubPage, summary="List stubs, newest pay date first")
def list_stubs(
    worker_id: Annotated[str | None, Query(alias="workerId", description="Only this worker's stubs.")] = None,
    limit: Limit = records.DEFAULT_PAGE,
    cursor: Cursor = None,
    user_id: str = Depends(reader),
    db: Session = Depends(get_session),
) -> Any:
    offset = records.decode_cursor(cursor)
    query = select(Stub).where(Stub.user_id == user_id)
    if worker_id is not None:
        query = query.where(Stub.worker_id == records.owned(db, Worker, user_id, worker_id).id)
    rows = db.scalars(
        query.order_by(Stub.pay_date.desc(), Stub.created_at.desc(), Stub.id).offset(offset).limit(limit + 1)
    ).all()
    items, next_cursor = records.page(list(rows), offset, limit)
    view = stubs.StubView(db, user_id)
    return {"items": [view.json(stub) for stub in items], "nextCursor": next_cursor}


@stubs_router.post(
    "/batch",
    response_model=BatchOut,
    status_code=201,
    summary="Make this period's stub for every worker without one",
    description="The period follows on from the newest stub on record. " + IDEMPOTENT,
)
def create_batch(
    body: Today | None = None,
    user_id: str = Depends(writer),
    idem: Idempotency = Depends(),
    db: Session = Depends(get_session),
) -> Any:
    business = records.get_business(db, user_id)
    today = _today(body)

    def action() -> dict[str, Any]:
        period, created = stubs.create_batch(db, business, user_id, today)
        view = stubs.StubView(db, user_id)
        return {"period": period, "created": [view.json(stub) for stub in created]}

    return idem.run(user_id, body, 201, action)


@stubs_router.get("/{stub_id}", response_model=StubOut)
def get_stub(stub_id: str, user_id: str = Depends(reader), db: Session = Depends(get_session)) -> Any:
    return stubs.StubView(db, user_id).json(records.owned(db, Stub, user_id, stub_id))


@stubs_router.put(
    "/{stub_id}/lines",
    response_model=StubOut,
    summary="Replace a stub's lines",
    description="Hourly amounts are recalculated from minutes and rate, and calculated tax lines are brought "
    "up to date. A tax line sent with source `manual` is kept exactly as typed. " + IF_MATCH,
)
def replace_lines(
    stub_id: str,
    body: LinesReplace,
    request: Request,
    user_id: str = Depends(writer),
    db: Session = Depends(get_session),
) -> Any:
    stub = records.owned(db, Stub, user_id, stub_id)
    records.check_version(request, stub)
    worker = records.owned(db, Worker, user_id, stub.worker_id)
    business = records.get_business(db, user_id)
    stubs.replace_lines(db, business, worker, stub, [line.as_domain() for line in body.lines])
    return stubs.StubView(db, user_id).json(stub)


@stubs_router.patch(
    "/{stub_id}",
    response_model=StubOut,
    summary="Change a stub's pay period or pay date",
    description="Taxes are recalculated: a different pay date can change the tax year and the pay counted "
    "before this stub. " + IF_MATCH,
)
def update_stub(
    stub_id: str,
    body: StubPatch,
    request: Request,
    user_id: str = Depends(writer),
    db: Session = Depends(get_session),
) -> Any:
    stub = records.owned(db, Stub, user_id, stub_id)
    records.check_version(request, stub)
    worker = records.owned(db, Worker, user_id, stub.worker_id)
    business = records.get_business(db, user_id)
    stubs.update_dates(
        db, business, worker, stub, period=body.period.model_dump() if body.period else None, pay_date=body.payDate
    )
    return stubs.StubView(db, user_id).json(stub)


@stubs_router.delete("/{stub_id}", status_code=204)
def delete_stub(stub_id: str, user_id: str = Depends(writer), db: Session = Depends(get_session)) -> Response:
    """Deletes the stub. Year-to-date on later stubs no longer includes it."""
    db.delete(records.owned(db, Stub, user_id, stub_id))
    db.commit()
    return Response(status_code=204)


# ---- Backup -------------------------------------------------------------------

backup_router = APIRouter(prefix="/v1/backup", tags=["Import and export"])


@backup_router.put("", summary="Replace all records with a snapshot")
def import_backup(body: Snapshot, user_id: str = Depends(writer), db: Session = Depends(get_session)) -> Any:
    """Replaces the business, workers and stubs with the snapshot, all or nothing.

    Rows get new ids; read them back with GET. Hourly amounts must match
    minutes x rate or the snapshot is refused.
    """
    backup.verify_snapshot(body)
    return backup.import_snapshot(db, user_id, body)


@backup_router.get("", summary="Export all records as a snapshot")
def export_backup(user_id: str = Depends(reader), db: Session = Depends(get_session)) -> Any:
    found = backup.export_snapshot(db, user_id)
    if found is None:
        raise ApiError(404, "no_backup", "There are no records to export yet.")
    return found


@backup_router.delete("", status_code=204, summary="Delete all records, keeping the account")
def delete_backup(user_id: str = Depends(writer), db: Session = Depends(get_session)) -> Response:
    backup.delete_records(db, user_id)
    return Response(status_code=204)
