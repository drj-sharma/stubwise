"""Order history: the pay stubs the user has paid for, newest first."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth.deps import reader
from ..db import get_session
from ..models import Order, iso_z
from ..services import records

router = APIRouter(prefix="/v1/orders", tags=["Orders"])

Limit = Annotated[int, Query(ge=1, le=records.MAX_PAGE, description="Page size.")]
Cursor = Annotated[str | None, Query(description="`nextCursor` from the previous page.")]


def order_json(order: Order) -> dict[str, Any]:
    return {
        "id": order.id,
        "stubId": order.stub_id,
        "workerName": order.worker_name,
        "payDate": order.pay_date,
        "amountCents": order.amount_cents,
        "currency": order.currency,
        "status": order.status,
        "provider": order.provider,
        "createdAt": iso_z(order.created_at),
    }


StubFilter = Annotated[
    str | None,
    Query(alias="stubId", description="Only purchases of this stub: a paid stub can be corrected again at no charge."),
]


@router.get("", summary="Purchases, newest first")
def list_orders(
    limit: Limit = records.DEFAULT_PAGE,
    cursor: Cursor = None,
    stub_id: StubFilter = None,
    user_id: str = Depends(reader),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    offset = records.decode_cursor(cursor)
    query = select(Order).where(Order.user_id == user_id)
    if stub_id is not None:
        query = query.where(Order.stub_id == stub_id)
    rows = list(db.scalars(query.order_by(Order.created_at.desc(), Order.id).offset(offset).limit(limit + 1)))
    more = len(rows) > limit
    return {
        "items": [order_json(order) for order in rows[:limit]],
        "nextCursor": records.encode_cursor(offset + limit) if more else None,
    }
