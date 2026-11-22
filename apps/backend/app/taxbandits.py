"""Client for the TaxBandits API v2.0.0 (https://developer.taxbandits.com/docs/2.0.0/).

Everything that knows a TaxBandits URL, header or field name lives in this
file and in taxbandits_payloads.py. Shapes were taken from the public docs on
2026-11-22; nothing here has been run against the sandbox. Points the docs
left open or contradicted themselves on are marked ``# UNVERIFIED:``.

This module never logs a request or response body.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from .config import TaxBanditsCredentials
from .logs import scrub_tins as scrub

log = logging.getLogger(__name__)

FormType = Literal["W2", "1099NEC"]

# "URLs & Versioning" page. Tax year 2026 is only supported in v2.0.0.
OAUTH_URLS = {
    "sandbox": "https://testoauth.expressauth.net/v2/token",
    "production": "https://oauth.expressauth.net/v2/token",
}
API_URLS = {
    "sandbox": "https://testapi.taxbandits.com/v2.0.0/",
    "production": "https://api.taxbandits.com/v2.0.0/",
}

# Paths as written in each page's endpoint heading. The docs' own code samples
# spell them with different capitalisation ("formw2/Create", "Formw2/transmit").
# UNVERIFIED: that paths are case-insensitive, as that inconsistency implies.
_CREATE_PATH = {"W2": "formw2/create", "1099NEC": "Form1099NEC/Create"}
_UTILITY_PATH = {"W2": "formw2", "1099NEC": "form1099"}

# The key holding the per-record results. The W-2 Create page's field table says
# "FormRecords" while its sample JSON says "FormW2Records"; the 1099 Status table
# says "1099Records" while its sample says "Form1099Records". All are accepted.
_RECORD_KEYS = {"W2": ("FormW2Records", "FormRecords"), "1099NEC": ("Form1099Records", "1099Records")}

_TOKEN_REFRESH_MARGIN_SECONDS = 60


class TaxBanditsError(Exception):
    """Base class. Messages are safe to log: they never contain request data."""


class TaxBanditsUnavailable(TaxBanditsError):
    """Network failure, timeout, a 5xx, or a reply that could not be understood."""


class TaxBanditsAuthError(TaxBanditsError):
    """TaxBandits refused our credentials. A configuration problem on our side."""


@dataclass(frozen=True, slots=True)
class VendorError:
    code: str
    field: str
    message: str
    sequence_id: str | None = None


class TaxBanditsRejected(TaxBanditsError):
    """TaxBandits understood the request and refused it; ``errors`` says why."""

    def __init__(self, errors: list[VendorError]) -> None:
        super().__init__(f"TaxBandits rejected the request with {len(errors)} error(s)")
        self.errors = errors


@dataclass(frozen=True, slots=True)
class CreatedRecord:
    sequence_id: str
    record_id: str
    recipient_id: str | None
    federal_status: str


@dataclass(frozen=True, slots=True)
class CreateResult:
    submission_id: str | None
    business_id: str | None
    records: list[CreatedRecord]
    errors: list[VendorError] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class RecordStatus:
    record_id: str
    federal_status: str
    message: str | None


def sign_jws(credentials: TaxBanditsCredentials, issued_at: int) -> str:
    """The HS256-signed token TaxBandits exchanges for an access token (OAuth page, step 2)."""

    def b64(data: bytes) -> bytes:
        return base64.urlsafe_b64encode(data).rstrip(b"=")

    header = {"alg": "HS256", "typ": "JWT"}
    # The optional "scope" and "categories" claims are left out, which the docs say
    # grants full access to all categories. They could narrow the token to W-2/1099.
    payload = {
        "iss": credentials.client_id,
        "sub": credentials.client_id,
        "aud": credentials.user_token,
        "iat": issued_at,
    }
    signing_input = b".".join(b64(json.dumps(part, separators=(",", ":")).encode()) for part in (header, payload))
    signature = hmac.new(credentials.client_secret.encode(), signing_input, hashlib.sha256).digest()
    return (signing_input + b"." + b64(signature)).decode()


class TaxBanditsClient:
    def __init__(
        self,
        credentials: TaxBanditsCredentials,
        *,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._credentials = credentials
        self._clock = clock
        self._oauth_url = OAUTH_URLS[credentials.env]
        self._http = httpx.Client(base_url=API_URLS[credentials.env], timeout=timeout_seconds, transport=transport)
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = threading.Lock()

    @property
    def environment(self) -> str:
        return self._credentials.env

    def close(self) -> None:
        self._http.close()

    # ---- Authentication ---------------------------------------------------

    def _access_token(self) -> str:
        with self._token_lock:
            now = self._clock()
            if self._token and now < self._token_expires_at - _TOKEN_REFRESH_MARGIN_SECONDS:
                return self._token
            # UNVERIFIED: the docs' prose says to send the JWS "as the Bearer token in
            # the Authentication header", but their header table shows the bare JWS
            # with no "Bearer " prefix. The table is followed here.
            headers = {"Authentication": sign_jws(self._credentials, int(now))}
            try:
                response = self._http.get(self._oauth_url, headers=headers)
                body = response.json()
            except (httpx.HTTPError, ValueError) as error:
                raise TaxBanditsUnavailable(f"token request failed: {type(error).__name__}") from None
            token = body.get("AccessToken") if isinstance(body, dict) else None
            # The docs' error sample carries the string "null" rather than JSON null.
            if response.status_code != 200 or not isinstance(token, str) or token in ("", "null"):
                if response.status_code >= 500:
                    raise TaxBanditsUnavailable(f"token request answered {response.status_code}")
                raise TaxBanditsAuthError(f"token request refused with status {response.status_code}")
            expires_in = body.get("ExpiresIn")
            self._token = token
            self._token_expires_at = now + (expires_in if isinstance(expires_in, int | float) else 3600)
            return token

    def _forget_token(self) -> None:
        with self._token_lock:
            self._token = None

    # ---- Transport --------------------------------------------------------

    def _request(self, method: str, path: str, **kwargs: Any) -> tuple[int, dict[str, Any]]:
        """Sends one authenticated call. Returns the status and JSON body of any 2xx or 4xx reply."""
        for attempt in (1, 2):
            headers = {"Authorization": f"Bearer {self._access_token()}"}
            try:
                response = self._http.request(method, path, headers=headers, **kwargs)
            except httpx.HTTPError as error:
                raise TaxBanditsUnavailable(f"{method} {path} failed: {type(error).__name__}") from None
            if response.status_code == 401 and attempt == 1:
                # The cached token may have been revoked early; fetch a new one once.
                self._forget_token()
                continue
            break
        log.info("taxbandits %s %s -> %s", method, path, response.status_code)
        if response.status_code == 401:
            raise TaxBanditsAuthError(f"{method} {path} refused the access token")
        if response.status_code >= 500:
            raise TaxBanditsUnavailable(f"{method} {path} answered {response.status_code}")
        try:
            body = response.json()
        except ValueError:
            body = None
        if not isinstance(body, dict):
            raise TaxBanditsUnavailable(f"{method} {path} answered {response.status_code} without a JSON object")
        return response.status_code, body

    # ---- Endpoints --------------------------------------------------------

    def create(self, form_type: FormType, payload: dict[str, Any]) -> CreateResult:
        """Creates the returns at TaxBandits without sending them to the IRS/SSA.

        A reply can mix created records and refused ones (HTTP 207); both are
        returned, and the caller decides what a partial result means.
        """
        status, body = self._request("POST", _CREATE_PATH[form_type], json=payload)
        records_node = _first(body, _RECORD_KEYS[form_type])
        records_node = records_node if isinstance(records_node, dict) else {}
        records = [
            CreatedRecord(
                sequence_id=str(item.get("SequenceId")),
                record_id=str(item["RecordId"]),
                # W-2 sample JSON names it EmployeeId; the field table and 1099-NEC say RecipientId.
                recipient_id=_first(item, ("RecipientId", "EmployeeId")),
                federal_status=str((item.get("Federal") or {}).get("Status") or "CREATED"),
            )
            for item in records_node.get("SuccessRecords") or []
            if isinstance(item, dict) and item.get("RecordId")
        ]
        errors = _errors(body, records_node)
        if status >= 400 and not records:
            # UNVERIFIED: the body of a 400. The docs list the fields (top-level
            # "Errors" and per-record "ErrorRecords", each {Id, Name, Message}) but the
            # sample was not readable; an unrecognised body yields a generic error.
            raise TaxBanditsRejected(errors or [_unexplained(status)])
        return CreateResult(
            submission_id=body.get("SubmissionId"),
            business_id=body.get("BusinessId"),
            records=records,
            errors=errors,
        )

    def transmit(self, form_type: FormType, submission_id: str, record_ids: list[str]) -> list[RecordStatus]:
        """Sends created returns to the IRS/SSA. Cannot be undone."""
        payload = {"SubmissionId": submission_id, "RecordIds": record_ids}
        status, body = self._request("POST", f"{_UTILITY_PATH[form_type]}/transmit", json=payload)
        statuses = _record_statuses(body, form_type)
        if status >= 400 or not statuses:
            # UNVERIFIED: the body of a 400/404 from Transmit; parsed like other error bodies.
            raise TaxBanditsRejected(_errors(body, body) or [_unexplained(status)])
        return statuses

    def status(self, form_type: FormType, submission_id: str, record_id: str) -> RecordStatus | None:
        """The current status of one return, or None if TaxBandits did not report it.

        One record per call, exactly as the docs' sample request. Their Delete
        endpoint takes a comma-separated list, but
        UNVERIFIED: whether Status accepts several recordIds in one call.
        """
        params = {"submissionId": submission_id, "recordIds": record_id}
        status, body = self._request("GET", f"{_UTILITY_PATH[form_type]}/status", params=params)
        if status >= 400:
            raise TaxBanditsRejected(_errors(body, body) or [_unexplained(status)])
        return next((s for s in _record_statuses(body, form_type) if s.record_id == record_id), None)

    def delete(self, form_type: FormType, submission_id: str) -> None:
        """Deletes every not-yet-transmitted return in a submission."""
        status, body = self._request(
            "DELETE", f"{_UTILITY_PATH[form_type]}/delete", params={"submissionId": submission_id}
        )
        if status >= 400:
            raise TaxBanditsRejected(_errors(body, body) or [_unexplained(status)])


def _first(node: dict[str, Any], keys: tuple[str, ...]) -> Any:
    return next((node[key] for key in keys if node.get(key) is not None), None)


def _unexplained(status: int) -> VendorError:
    return VendorError(code="", field="", message=f"TaxBandits answered {status} without an explanation.")


def _vendor_errors(items: Any, sequence_id: str | None = None) -> list[VendorError]:
    return [
        VendorError(
            code=str(item.get("Id") or ""),
            field=scrub(str(item.get("Name") or "")),
            # A vendor message may quote the offending value back, so it is scrubbed
            # before it can be stored, returned or logged.
            message=scrub(str(item.get("Message") or "")),
            sequence_id=sequence_id,
        )
        for item in (items if isinstance(items, list) else [])
        if isinstance(item, dict)
    ]


def _errors(body: dict[str, Any], records_node: dict[str, Any]) -> list[VendorError]:
    errors = _vendor_errors(body.get("Errors"))
    for record in records_node.get("ErrorRecords") or []:
        if isinstance(record, dict):
            sequence_id = record.get("SequenceId")
            errors += _vendor_errors(record.get("Errors"), None if sequence_id is None else str(sequence_id))
    return errors


def _record_statuses(body: dict[str, Any], form_type: FormType) -> list[RecordStatus]:
    """Reads the Transmit and Status replies, which share a shape."""
    records = _first(body, _RECORD_KEYS[form_type])
    statuses = []
    for item in records if isinstance(records, list) else []:
        federal = item.get("FederalStatus") if isinstance(item, dict) else None
        if not isinstance(federal, dict) or not item.get("RecordId") or not federal.get("Status"):
            continue
        # W-2 replies explain a status in "Message"; the 1099 sample uses an "Errors" list instead.
        reasons = [
            federal.get("Message"),
            *(error.message for error in _vendor_errors(federal.get("Errors"))),
        ]
        message = scrub("; ".join(str(reason) for reason in reasons if reason)) or None
        statuses.append(RecordStatus(str(item["RecordId"]), str(federal["Status"]).upper(), message))
    return statuses
