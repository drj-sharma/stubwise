"""The audit log: who signed in, exported or deleted what, and when.

Details hold ids and counts only, never tokens, email addresses or pay data.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..logs import request_id
from ..models import AuditLog, iso_z


def record(db: Session, user_id: str | None, event: str, detail: dict[str, Any] | None = None) -> None:
    """Adds an entry to the caller's transaction; the caller commits."""
    db.add(AuditLog(user_id=user_id, event=event, request_id=request_id.get(), detail=detail))


def for_user(db: Session, user_id: str) -> list[dict[str, Any]]:
    entries = db.scalars(select(AuditLog).where(AuditLog.user_id == user_id).order_by(AuditLog.id)).all()
    return [{"event": entry.event, "at": iso_z(entry.created_at), "detail": entry.detail} for entry in entries]
