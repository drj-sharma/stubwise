from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from .. import filing
from ..auth.deps import reader
from ..db import get_session
from ..errors import ApiError
from ..filing_schemas import ConsentRequest, FilingRequest
from ..taxbandits import TaxBanditsClient

# Parked: main.py mounts this router only when FILING_ENABLED=true and TaxBandits credentials are set.
router = APIRouter(prefix="/v1", tags=["Tax form filing (parked)"])


def rate_limited_user(request: Request, user_id: str = Depends(reader)) -> str:
    if not request.app.state.filing_limiter.allow(user_id):
        raise ApiError(429, "rate_limited", "Too many filing requests. Wait a minute and try again.")
    return user_id


def taxbandits(request: Request, _user_id: str = Depends(rate_limited_user)) -> TaxBanditsClient:
    client: TaxBanditsClient | None = request.app.state.taxbandits
    if client is None:
        raise ApiError(503, "filing_unavailable", "Tax form filing is not set up on this server.")
    return client


def filing_user(
    user_id: str = Depends(rate_limited_user),
    _client: TaxBanditsClient = Depends(taxbandits),
    session: Session = Depends(get_session),
) -> str:
    """The gate for every /v1/filings route: signed in, under the rate limit, consent given."""
    filing.require_consent(session, user_id)
    return user_id


# ---- Consent ------------------------------------------------------------------


@router.get("/filing/consent")
def get_consent(user_id: str = Depends(rate_limited_user), session: Session = Depends(get_session)) -> dict[str, Any]:
    return filing.consent_state(session, user_id)


@router.post("/filing/consent")
def give_consent(
    body: ConsentRequest,
    user_id: str = Depends(rate_limited_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    return filing.record_consent(session, user_id, body.consentVersion)


@router.delete("/filing/consent", status_code=204)
def withdraw_consent(user_id: str = Depends(rate_limited_user), session: Session = Depends(get_session)) -> Response:
    filing.withdraw_consent(session, user_id)
    return Response(status_code=204)


# ---- Filings ------------------------------------------------------------------


@router.post("/filings", status_code=201)
def create_filing(
    body: FilingRequest,
    user_id: str = Depends(filing_user),
    client: TaxBanditsClient = Depends(taxbandits),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    return filing.create_filing(session, client, user_id, body)


@router.post("/filings/{filing_id}/transmit")
def transmit_filing(
    filing_id: str,
    user_id: str = Depends(filing_user),
    client: TaxBanditsClient = Depends(taxbandits),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    return filing.transmit_filing(session, client, user_id, filing_id)


@router.get("/filings")
def list_filings(
    user_id: str = Depends(filing_user),
    client: TaxBanditsClient = Depends(taxbandits),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    return {"filings": filing.list_filings(session, client, user_id)}


@router.get("/filings/{filing_id}")
def get_filing(
    filing_id: str,
    user_id: str = Depends(filing_user),
    client: TaxBanditsClient = Depends(taxbandits),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    return filing.get_filing(session, client, user_id, filing_id)
