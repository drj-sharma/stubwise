"""Optional ``Idempotency-Key`` for requests that create something.

A phone on a bad connection cannot tell "the request never arrived" from "the
reply got lost". With a key, sending the same request again returns the first
answer instead of creating a second worker or stub.

PUT, PATCH and DELETE are idempotent by nature and ignore the header.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from fastapi import Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_session
from ..errors import ApiError
from ..models import IdempotencyKey, as_utc, utcnow

_KEY = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_KEEP = timedelta(hours=24)


class Idempotency:
    def __init__(self, request: Request, db: Session = Depends(get_session)) -> None:
        self._db = db
        self._key = request.headers.get("idempotency-key")
        self._target = f"{request.method} {request.url.path}"
        if self._key is not None and not _KEY.fullmatch(self._key):
            raise ApiError(400, "invalid_idempotency_key", "Idempotency-Key must be 1-128 letters, digits or . _ : -")

    def run(self, user_id: str, body: BaseModel | None, status_code: int, action: Callable[[], Any]) -> Any:
        """Runs ``action`` once per key. Returns its result, or the stored reply on a repeat."""
        if self._key is None:
            return action()
        payload = body.model_dump(mode="json") if body is not None else None
        fingerprint = hashlib.sha256(json.dumps([self._target, payload], sort_keys=True).encode()).hexdigest()

        existing = self._db.get(IdempotencyKey, (user_id, self._key))
        if existing is not None and utcnow() - as_utc(existing.created_at) > _KEEP:
            self._db.delete(existing)
            self._db.commit()
            existing = None
        if existing is None:
            # Claim the key before doing the work, so a concurrent duplicate cannot also do it.
            try:
                self._db.add(IdempotencyKey(user_id=user_id, key=self._key, fingerprint=fingerprint))
                self._db.commit()
            except IntegrityError:
                self._db.rollback()
                existing = self._db.get(IdempotencyKey, (user_id, self._key))
        if existing is not None:
            return self._replay(existing, fingerprint)

        try:
            result = action()
        except BaseException:
            # A failed attempt leaves nothing behind, so the same key can be tried again.
            self._db.rollback()
            self._db.execute(
                delete(IdempotencyKey).where(IdempotencyKey.user_id == user_id, IdempotencyKey.key == self._key)
            )
            self._db.commit()
            raise
        claimed = self._db.get(IdempotencyKey, (user_id, self._key))
        if claimed is not None:
            claimed.status_code = status_code
            claimed.response = result
            self._db.commit()
        return result

    def _replay(self, stored: IdempotencyKey, fingerprint: str) -> JSONResponse:
        if stored.fingerprint != fingerprint:
            raise ApiError(
                422, "idempotency_key_reused", "This Idempotency-Key was already used for a different request."
            )
        if stored.status_code is None:
            raise ApiError(409, "idempotency_in_progress", "The first request with this key is still running.")
        return JSONResponse(
            status_code=stored.status_code, content=stored.response, headers={"Idempotency-Replayed": "true"}
        )
