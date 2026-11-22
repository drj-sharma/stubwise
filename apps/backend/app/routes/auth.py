from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import ConfigDict, Field, StringConstraints
from sqlalchemy.orm import Session

from ..auth import sessions
from ..auth.deps import current_principal
from ..auth.providers import Provider
from ..auth.sessions import Principal
from ..db import get_session
from ..errors import ApiError
from ..schemas import Model, Out
from ..services import account

router = APIRouter(prefix="/v1/auth", tags=["Sign-in and sessions"])

Token = Annotated[str, StringConstraints(min_length=20, max_length=8192)]
Nonce = Annotated[str, StringConstraints(min_length=1, max_length=256)]
NamePart = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]


class GoogleSignIn(Model):
    model_config = ConfigDict(
        strict=True, extra="ignore", json_schema_extra={"examples": [{"idToken": "eyJhbGciOiJSUzI1NiIs..."}]}
    )

    idToken: Token = Field(repr=False, description="The ID token from Google Sign-In.")
    nonce: Nonce | None = Field(default=None, description="The nonce the app put in the sign-in request, if any.")


class FullName(Model):
    givenName: NamePart = ""
    familyName: NamePart = ""


class AppleSignIn(Model):
    model_config = ConfigDict(
        strict=True,
        extra="ignore",
        json_schema_extra={
            "examples": [
                {
                    "identityToken": "eyJraWQiOiJ...",
                    "fullName": {"givenName": "Renee", "familyName": "Okafor"},
                    "nonce": "c1f0...",
                }
            ]
        },
    )

    identityToken: Token = Field(repr=False, description="The identity token from Sign in with Apple.")
    fullName: FullName | None = Field(
        default=None, description="Apple only gives the app the name on the first sign-in; pass it along then."
    )
    nonce: Nonce | None = Field(
        default=None,
        description="Exactly the value Apple put in the token's nonce claim (the SHA-256 hex digest, if the app "
        "hashed its nonce before handing it to Apple).",
    )


class RefreshRequest(Model):
    refreshToken: Annotated[str, StringConstraints(min_length=20, max_length=200)] = Field(repr=False)


class UserOut(Out):
    id: str
    provider: str
    email: str | None
    name: str
    plan: str
    entitlements: dict[str, int]
    createdAt: str
    updatedAt: str


class TokenPair(Out):
    accessToken: str = Field(description="Send as 'Authorization: Bearer <token>'. Lasts 15 minutes.")
    tokenType: str
    expiresIn: int
    refreshToken: str = Field(description="Single use: every refresh returns a new one.")
    sessionId: str
    user: UserOut


class SessionOut(Out):
    id: str
    current: bool
    userAgent: str
    createdAt: str
    lastUsedAt: str


class SessionList(Out):
    sessions: list[SessionOut]


def auth_rate_limit(request: Request) -> None:
    """Per client address: these routes are reachable without credentials."""
    address = request.client.host if request.client else "unknown"
    if not request.app.state.auth_limiter.allow(address):
        raise ApiError(429, "rate_limited", "Too many sign-in attempts. Wait a minute and try again.")


def _sign_in(
    request: Request, db: Session, provider: Provider, token: str, nonce: str | None, name: str | None
) -> dict[str, Any]:
    identity = request.app.state.identity.verify(provider, token, nonce=nonce)
    user = account.sign_in(db, identity, fallback_name=name)
    return sessions.start_session(db, request.app.state.settings, user, request.headers.get("user-agent", ""))


@router.post("/google", response_model=TokenPair, dependencies=[Depends(auth_rate_limit)])
def sign_in_with_google(body: GoogleSignIn, request: Request, db: Session = Depends(get_session)) -> Any:
    """Exchanges a Google ID token for a Stubwise session, creating the account on first use."""
    return _sign_in(request, db, "google", body.idToken, body.nonce, None)


@router.post("/apple", response_model=TokenPair, dependencies=[Depends(auth_rate_limit)])
def sign_in_with_apple(body: AppleSignIn, request: Request, db: Session = Depends(get_session)) -> Any:
    """Exchanges an Apple identity token for a Stubwise session, creating the account on first use."""
    name = f"{body.fullName.givenName} {body.fullName.familyName}".strip() if body.fullName else None
    return _sign_in(request, db, "apple", body.identityToken, body.nonce, name or None)


@router.post("/refresh", response_model=TokenPair, dependencies=[Depends(auth_rate_limit)])
def refresh(body: RefreshRequest, request: Request, db: Session = Depends(get_session)) -> Any:
    """Swaps a refresh token for a new access token and a new refresh token.

    Each refresh token works once. Presenting one a second time revokes the
    whole session, because it means the token was copied.
    """
    return sessions.refresh(db, request.app.state.settings, body.refreshToken)


@router.post("/logout", status_code=204)
def logout(principal: Principal = Depends(current_principal), db: Session = Depends(get_session)) -> Response:
    """Ends the current session. Its access and refresh tokens stop working at once."""
    sessions.revoke_session(db, principal.user.id, principal.session_id, "auth.logout")
    return Response(status_code=204)


@router.get("/sessions", response_model=SessionList)
def list_sessions(principal: Principal = Depends(current_principal), db: Session = Depends(get_session)) -> Any:
    """The devices signed in to this account."""
    return {"sessions": sessions.list_sessions(db, principal)}


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(
    session_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_session)
) -> Response:
    """Signs another device out."""
    sessions.revoke_session(db, principal.user.id, session_id, "auth.session_revoked")
    return Response(status_code=204)


me_router = APIRouter(prefix="/v1/me", tags=["Account"])


class MePatch(Model):
    model_config = ConfigDict(strict=True, extra="ignore", json_schema_extra={"examples": [{"name": "Renee Okafor"}]})

    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]


@me_router.get("", response_model=UserOut)
def get_me(principal: Principal = Depends(current_principal)) -> Any:
    return sessions.user_json(principal.user)


@me_router.patch("", response_model=UserOut)
def update_me(
    body: MePatch, principal: Principal = Depends(current_principal), db: Session = Depends(get_session)
) -> Any:
    return sessions.user_json(account.rename(db, principal.user, body.name))


@me_router.get("/export")
def export_me(principal: Principal = Depends(current_principal), db: Session = Depends(get_session)) -> Any:
    """Everything held about the account: profile, sessions, business, workers, stubs, filings, audit log."""
    return account.export(db, principal)


@me_router.delete("", status_code=204)
def delete_me(principal: Principal = Depends(current_principal), db: Session = Depends(get_session)) -> Response:
    """Deletes the account and all its data, on every device. Cannot be undone."""
    account.delete_account(db, principal.user)
    return Response(status_code=204)
