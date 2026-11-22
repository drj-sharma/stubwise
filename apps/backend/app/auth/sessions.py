"""Our own sessions: a short-lived access token and a rotating refresh token.

The access token is a JWT (HS256) that lasts 15 minutes and names the user and
the session. It is still checked against the database on every request, so
signing out or deleting an account takes effect at once, not 15 minutes later.

The refresh token is random, stored only as a SHA-256 hash, and replaced every
time it is used. A refresh token that is presented a second time has been
copied (by a thief, or from a backup): the whole session is revoked, which
signs out both the thief and the owner, and the owner signs in again.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import jwt
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import ACCESS_TOKEN_SECONDS, Settings
from ..errors import ApiError
from ..models import AuthSession, RefreshToken, User, as_utc, iso_z, utcnow
from ..plans import entitlements_json
from ..services import audit

_ISSUER = "stubwise"
_AUDIENCE = "stubwise-api"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _invalid() -> ApiError:
    return ApiError(
        401,
        "unauthorized",
        'Send a valid access token as "Authorization: Bearer <token>".',
        headers={"WWW-Authenticate": "Bearer"},
    )


@dataclass(frozen=True, slots=True)
class Principal:
    user: User
    session_id: str


def issue_access_token(settings: Settings, user_id: str, session_id: str) -> str:
    now = int(utcnow().timestamp())
    claims = {
        "iss": _ISSUER,
        "aud": _AUDIENCE,
        "sub": user_id,
        "sid": session_id,
        "iat": now,
        "exp": now + ACCESS_TOKEN_SECONDS,
    }
    return jwt.encode(claims, settings.auth_jwt_secret, algorithm="HS256")


def authenticate(db: Session, settings: Settings, token: str) -> Principal:
    try:
        claims = jwt.decode(
            token,
            settings.auth_jwt_secret,
            algorithms=["HS256"],
            audience=_AUDIENCE,
            issuer=_ISSUER,
            options={"require": ["exp", "iat", "sub", "sid"]},
        )
    except jwt.PyJWTError:
        raise _invalid() from None
    row = db.execute(
        select(User, AuthSession)
        .join(AuthSession, AuthSession.user_id == User.id)
        .where(User.id == claims["sub"], AuthSession.id == claims["sid"], AuthSession.revoked_at.is_(None))
    ).first()
    if row is None:
        raise _invalid()
    return Principal(user=row[0], session_id=row[1].id)


def _new_refresh_token(db: Session, settings: Settings, session_id: str) -> str:
    token = secrets.token_urlsafe(48)
    expires = utcnow() + timedelta(days=settings.refresh_token_days)
    db.add(RefreshToken(session_id=session_id, token_hash=hash_token(token), expires_at=expires))
    return token


def _token_pair(settings: Settings, user: User, session_id: str, refresh_token: str) -> dict[str, Any]:
    return {
        "accessToken": issue_access_token(settings, user.id, session_id),
        "tokenType": "Bearer",
        "expiresIn": ACCESS_TOKEN_SECONDS,
        "refreshToken": refresh_token,
        "sessionId": session_id,
        "user": user_json(user),
    }


def start_session(db: Session, settings: Settings, user: User, user_agent: str) -> dict[str, Any]:
    session = AuthSession(user_id=user.id, user_agent=user_agent[:200])
    db.add(session)
    db.flush()
    refresh_token = _new_refresh_token(db, settings, session.id)
    db.commit()
    return _token_pair(settings, user, session.id, refresh_token)


def refresh(db: Session, settings: Settings, refresh_token: str) -> dict[str, Any]:
    invalid = ApiError(401, "invalid_refresh_token", "Sign in again.")
    stored = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token)))
    if stored is None:
        raise invalid
    session = db.get(AuthSession, stored.session_id)
    if session is None or session.revoked_at is not None:
        raise invalid
    now = utcnow()
    if stored.used_at is not None:
        # Reuse: this token was already exchanged once. Treat the session as stolen.
        session.revoked_at = now
        audit.record(db, session.user_id, "auth.refresh_reuse_detected", {"sessionId": session.id})
        db.commit()
        raise invalid
    if as_utc(stored.expires_at) <= now:
        raise invalid
    # Spend the token with a guarded UPDATE, so that of two requests racing with
    # the same token exactly one wins and the other is treated as reuse above.
    spent = db.execute(
        update(RefreshToken).where(RefreshToken.id == stored.id, RefreshToken.used_at.is_(None)).values(used_at=now)
    )
    if spent.rowcount != 1:
        db.rollback()
        raise invalid
    user = db.get(User, session.user_id)
    if user is None:
        raise invalid
    session.last_used_at = now
    new_token = _new_refresh_token(db, settings, session.id)
    db.commit()
    return _token_pair(settings, user, session.id, new_token)


def revoke_session(db: Session, user_id: str, session_id: str, event: str) -> None:
    session = db.scalar(select(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == user_id))
    if session is None:
        raise ApiError(404, "session_not_found", "No such session.")
    if session.revoked_at is None:
        session.revoked_at = utcnow()
        audit.record(db, user_id, event, {"sessionId": session_id})
    db.commit()


def list_sessions(db: Session, principal: Principal) -> list[dict[str, Any]]:
    sessions = db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == principal.user.id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.last_used_at.desc(), AuthSession.id)
    ).all()
    return [
        {
            "id": session.id,
            "current": session.id == principal.session_id,
            "userAgent": session.user_agent,
            "createdAt": iso_z(session.created_at),
            "lastUsedAt": iso_z(session.last_used_at),
        }
        for session in sessions
    ]


def user_json(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "provider": user.provider,
        "email": user.email,
        "name": user.name,
        "plan": user.plan,
        "entitlements": entitlements_json(user.plan),
        "createdAt": iso_z(user.created_at),
        "updatedAt": iso_z(user.updated_at),
    }
