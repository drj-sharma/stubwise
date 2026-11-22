"""FastAPI dependencies that identify the caller."""

from __future__ import annotations

import re

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from ..db import get_session
from ..errors import ApiError
from .sessions import Principal, authenticate

_BEARER = re.compile(r"^Bearer ([A-Za-z0-9._-]{20,2000})$")


def current_principal(request: Request, db: Session = Depends(get_session)) -> Principal:
    """The signed-in user and session, or a 401."""
    match = _BEARER.fullmatch(request.headers.get("authorization", ""))
    if not match:
        raise ApiError(
            401,
            "unauthorized",
            'Send a valid access token as "Authorization: Bearer <token>".',
            headers={"WWW-Authenticate": "Bearer"},
        )
    principal = authenticate(db, request.app.state.settings, match[1])
    request.state.user_id = principal.user.id  # for the access log
    return principal


def reader(principal: Principal = Depends(current_principal)) -> str:
    """The signed-in user's id, for routes that only read."""
    return principal.user.id


def writer(request: Request, principal: Principal = Depends(current_principal)) -> str:
    """The signed-in user's id, for routes that change something: also rate limited per user."""
    if not request.app.state.write_limiter.allow(principal.user.id):
        raise ApiError(429, "rate_limited", "Too many changes. Wait a minute and try again.")
    return principal.user.id
