"""Year-end tax form filing (W-2, 1099-NEC) through TaxBandits.

The full SSN/EIN exists only inside the request being handled: it goes to
TaxBandits and is then dropped. The database keeps the last four digits and
TaxBandits' identifiers, which is all that reviewing, transmitting and status
checks need.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .errors import ApiError
from .filing_schemas import NecFilingRequest, W2FilingRequest, W2Recipient
from .models import Filing, FilingConsent, FilingRecipient, as_utc, iso_z, utcnow
from .taxbandits import (
    TaxBanditsAuthError,
    TaxBanditsClient,
    TaxBanditsError,
    TaxBanditsRejected,
    VendorError,
)
from .taxbandits_payloads import build_1099nec, build_w2

log = logging.getLogger(__name__)

CONSENT_VERSION = "2026-11-22"
"""Version of the consent text the app shows. Change it when the text changes: everyone is asked again."""

STATUS_REFRESH_INTERVAL = timedelta(seconds=60)
"""How stale a status may be before a GET asks TaxBandits again."""

# Federal statuses after which TaxBandits has nothing more to report for a return.
_SETTLED = {"ACCEPTED", "ACCEPTED_WITH_ERRORS", "REJECTED"}
# Least advanced first; a filing is as far along as its slowest return.
_PROGRESS = ["CREATED", "TRANSMITTED", "SENT_TO_AGENCY", "ACCEPTED_WITH_ERRORS", "ACCEPTED"]


# ---- Consent ----------------------------------------------------------------


def record_consent(session: Session, user_id: str, consent_version: str) -> dict[str, Any]:
    if consent_version != CONSENT_VERSION:
        raise ApiError(
            409,
            "consent_version_mismatch",
            f"The current consent text is version {CONSENT_VERSION}. Show that text and send its version.",
        )
    session.merge(FilingConsent(user_id=user_id, consent_version=consent_version, consented_at=utcnow()))
    session.commit()
    return consent_state(session, user_id)


def withdraw_consent(session: Session, user_id: str) -> None:
    session.execute(delete(FilingConsent).where(FilingConsent.user_id == user_id))
    session.commit()


def consent_state(session: Session, user_id: str) -> dict[str, Any]:
    consent = session.get(FilingConsent, user_id)
    # Agreement to an older text does not cover the current one.
    given = consent is not None and consent.consent_version == CONSENT_VERSION
    return {
        "consented": given,
        "consentVersion": CONSENT_VERSION,
        "consentedAt": iso_z(consent.consented_at) if consent and given else None,
    }


def require_consent(session: Session, user_id: str) -> None:
    if not consent_state(session, user_id)["consented"]:
        raise ApiError(
            403,
            "consent_required",
            "Filing sends tax data to TaxBandits. Record the owner's consent with POST /v1/filing/consent first.",
        )


# ---- Filings ----------------------------------------------------------------


def create_filing(
    session: Session, client: TaxBanditsClient, user_id: str, request: W2FilingRequest | NecFilingRequest
) -> dict[str, Any]:
    """Creates the forms at TaxBandits (nothing goes to the IRS/SSA yet) and records the filing.

    All or nothing: if TaxBandits refuses any recipient, the ones it did create
    are deleted again and no filing is stored.
    """
    payload = build_w2(request) if isinstance(request, W2FilingRequest) else build_1099nec(request)
    with _vendor_failures(
        "filing_rejected",
        "TaxBandits did not accept these forms.",
        unavailable="The filing service could not be reached. Nothing was sent to the IRS or SSA.",
        request=request,
    ):
        result = client.create(request.formType, payload)
    del payload  # the only other place the full numbers live; do not keep it around

    by_sequence = {record.sequence_id: record for record in result.records}
    complete = all(str(n) in by_sequence for n in range(1, len(request.recipients) + 1))
    if result.errors or not complete or not result.submission_id:
        _discard_at_taxbandits(client, request.formType, result.submission_id)
        raise ApiError(
            422,
            "filing_rejected",
            "TaxBandits did not accept these forms.",
            _error_details(result.errors, request) or None,
        )

    now = utcnow()
    filing = Filing(
        id=str(uuid.uuid4()),
        user_id=user_id,
        form_type=request.formType,
        tax_year=request.taxYear,
        employer_name=request.employer.name,
        employer_ein_last4=request.employer.ein[-4:],
        tb_submission_id=result.submission_id,
        tb_business_id=result.business_id,
        created_at=now,
    )
    for position, recipient in enumerate(request.recipients):
        record = by_sequence[str(position + 1)]
        if isinstance(recipient, W2Recipient):
            tin, tin_type, amount = recipient.ssn, "SSN", recipient.wagesCents
        else:
            tin, tin_type, amount = recipient.tin, recipient.tinType, recipient.nonemployeeCompensationCents
        filing.recipients.append(
            FilingRecipient(
                position=position,
                ref=recipient.ref,
                name=recipient.display_name,
                tin_type=tin_type,
                tin_last4=tin[-4:],
                amount_cents=amount,
                tb_record_id=record.record_id,
                tb_recipient_id=record.recipient_id,
                federal_status=record.federal_status.upper(),
            )
        )
    try:
        session.add(filing)
        session.commit()
    except Exception:
        session.rollback()
        # Without our record nobody could ever transmit or find these drafts again.
        _discard_at_taxbandits(client, request.formType, result.submission_id)
        raise
    log.info("filing %s created: %s for %d recipient(s)", filing.id, filing.form_type, len(filing.recipients))
    return serialize(filing)


def transmit_filing(session: Session, client: TaxBanditsClient, user_id: str, filing_id: str) -> dict[str, Any]:
    """Sends a reviewed filing to the IRS/SSA. Cannot be undone."""
    filing = _own_filing(session, user_id, filing_id)
    unconfirmed_attempt = filing.transmit_requested_at is not None and filing.transmitted_at is None
    # An earlier attempt ended without an answer. Find out what happened to it
    # before sending again; if TaxBandits cannot say, do not guess.
    if unconfirmed_attempt and not _refresh(session, client, filing, force=True):
        raise ApiError(
            502,
            "filing_provider_unavailable",
            "The filing service could not be reached to confirm an earlier attempt. Try again later.",
        )
    if filing.transmitted_at is not None:
        raise ApiError(409, "already_transmitted", "This filing has already been sent.")

    # Written before the call so that a crash or timeout leaves a trace of the attempt.
    filing.transmit_requested_at = utcnow()
    session.commit()
    try:
        with _vendor_failures(
            "transmit_rejected",
            "TaxBandits did not accept the filing for transmission.",
            unavailable="The filing service did not answer. The filing may or may not have been sent: "
            "check its status before trying again.",
        ):
            statuses = client.transmit(
                filing.form_type,  # type: ignore[arg-type]
                filing.tb_submission_id,
                [recipient.tb_record_id for recipient in filing.recipients],
            )
    except ApiError as error:
        if error.code == "transmit_rejected":
            # A definite no: nothing was sent, so there is no attempt left to confirm.
            filing.transmit_requested_at = None
            session.commit()
        raise
    now = utcnow()
    filing.transmitted_at = now
    filing.status_checked_at = now
    _apply_statuses(filing, {status.record_id: status for status in statuses})
    session.commit()
    log.info("filing %s transmitted", filing.id)
    return serialize(filing)


def get_filing(session: Session, client: TaxBanditsClient, user_id: str, filing_id: str) -> dict[str, Any]:
    filing = _own_filing(session, user_id, filing_id)
    _refresh(session, client, filing)
    return serialize(filing)


def list_filings(session: Session, client: TaxBanditsClient, user_id: str) -> list[dict[str, Any]]:
    filings = session.scalars(
        select(Filing).where(Filing.user_id == user_id).order_by(Filing.created_at.desc(), Filing.id)
    ).all()
    for filing in filings:
        _refresh(session, client, filing)
    return [serialize(filing) for filing in filings]


def serialize(filing: Filing) -> dict[str, Any]:
    """The only view of a filing the API returns. Taxpayer numbers appear as their last four digits."""
    return {
        "id": filing.id,
        "formType": filing.form_type,
        "taxYear": filing.tax_year,
        "status": _overall_status(filing),
        "employer": {"name": filing.employer_name, "einLast4": filing.employer_ein_last4},
        "recipients": [
            {
                "ref": recipient.ref,
                "name": recipient.name,
                "tinType": recipient.tin_type,
                "tinLast4": recipient.tin_last4,
                "amountCents": recipient.amount_cents,
                "status": recipient.federal_status.lower(),
                "statusMessage": recipient.status_message,
            }
            for recipient in filing.recipients
        ],
        "createdAt": iso_z(filing.created_at),
        "transmittedAt": iso_z(filing.transmitted_at) if filing.transmitted_at else None,
        "statusCheckedAt": iso_z(filing.status_checked_at) if filing.status_checked_at else None,
    }


# ---- Internals --------------------------------------------------------------


def _own_filing(session: Session, user_id: str, filing_id: str) -> Filing:
    filing = session.scalar(select(Filing).where(Filing.id == filing_id, Filing.user_id == user_id))
    if filing is None:
        raise ApiError(404, "filing_not_found", "No such filing.")
    return filing


def _overall_status(filing: Filing) -> str:
    statuses = {recipient.federal_status for recipient in filing.recipients}
    if "REJECTED" in statuses:
        return "rejected"
    known = [status for status in statuses if status in _PROGRESS]
    if len(known) < len(statuses):
        # A status this code does not know (e.g. YET_TO_RETRANSMIT) is reported as it is.
        return sorted(statuses - set(_PROGRESS))[0].lower()
    return min(known, key=_PROGRESS.index).lower()


def _apply_statuses(filing: Filing, statuses: dict[str, Any]) -> None:
    for recipient in filing.recipients:
        status = statuses.get(recipient.tb_record_id)
        if status is not None:
            recipient.federal_status = status.federal_status[:40]
            recipient.status_message = status.message[:500] if status.message else None


def _refresh(session: Session, client: TaxBanditsClient, filing: Filing, *, force: bool = False) -> bool:
    """Brings a filing's statuses up to date, at most once per refresh interval unless forced.

    Returns False when TaxBandits could not be asked. For a plain GET that is
    not an error: the stored status is returned and ``statusCheckedAt`` shows
    how old it is.
    """
    pending = [r for r in filing.recipients if r.federal_status not in _SETTLED]
    if filing.transmit_requested_at is None or not pending:
        return True
    now = utcnow()
    checked = filing.status_checked_at
    if not force and checked and now - as_utc(checked) < STATUS_REFRESH_INTERVAL:
        return True
    try:
        found = {}
        for recipient in pending:
            status = client.status(filing.form_type, filing.tb_submission_id, recipient.tb_record_id)  # type: ignore[arg-type]
            if status is not None:
                found[status.record_id] = status
    except TaxBanditsError as error:
        log.warning("could not refresh filing %s: %s", filing.id, error)
        return False
    _apply_statuses(filing, found)
    filing.status_checked_at = now
    if filing.transmitted_at is None and any(r.federal_status != "CREATED" for r in filing.recipients):
        # The transmit call that never answered did go through.
        filing.transmitted_at = filing.transmit_requested_at
    session.commit()
    return True


def _discard_at_taxbandits(client: TaxBanditsClient, form_type: str, submission_id: str | None) -> None:
    if not submission_id:
        return
    try:
        client.delete(form_type, submission_id)  # type: ignore[arg-type]
    except TaxBanditsError as error:
        # Untransmitted drafts are never sent anywhere, so a leftover is clutter, not a filing.
        log.warning("could not delete TaxBandits submission %s: %s", submission_id, error)


def _error_details(
    errors: list[VendorError], request: W2FilingRequest | NecFilingRequest | None = None
) -> list[dict[str, Any]]:
    details = []
    for error in errors[:20]:
        detail: dict[str, Any] = {"code": error.code, "field": error.field, "message": error.message}
        position = int(error.sequence_id) if error.sequence_id and error.sequence_id.isdigit() else 0
        if request is not None and 1 <= position <= len(request.recipients):
            detail["recipientRef"] = request.recipients[position - 1].ref
        details.append(detail)
    return details


@contextmanager
def _vendor_failures(
    rejected_code: str,
    rejected_message: str,
    *,
    unavailable: str,
    request: W2FilingRequest | NecFilingRequest | None = None,
) -> Iterator[None]:
    """Turns TaxBandits failures into this API's errors."""
    try:
        yield
    except TaxBanditsRejected as error:
        raise ApiError(422, rejected_code, rejected_message, _error_details(error.errors, request)) from None
    except TaxBanditsAuthError as error:
        log.error("TaxBandits refused our credentials: %s", error)
        raise ApiError(502, "filing_provider_error", "Tax filing is not available right now.") from None
    except TaxBanditsError as error:
        log.warning("TaxBandits call failed: %s", error)
        raise ApiError(502, "filing_provider_unavailable", unavailable) from None
