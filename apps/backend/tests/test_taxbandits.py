from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import sys

import httpx
import pytest

from app.logs import JsonFormatter
from app.taxbandits import (
    TaxBanditsAuthError,
    TaxBanditsClient,
    TaxBanditsRejected,
    TaxBanditsUnavailable,
    sign_jws,
)

from .conftest import CREDENTIALS, FakeTaxBandits


def _decode(segment: str) -> dict:
    return json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))


def test_jws_is_hs256_signed_with_the_client_secret() -> None:
    token = sign_jws(CREDENTIALS, issued_at=1_795_000_000)
    header, payload, signature = token.split(".")
    assert _decode(header) == {"alg": "HS256", "typ": "JWT"}
    assert _decode(payload) == {
        "iss": "test-client-id",
        "sub": "test-client-id",
        "aud": "test-user-token",
        "iat": 1_795_000_000,
    }
    expected = hmac.new(b"test-client-secret", f"{header}.{payload}".encode(), hashlib.sha256).digest()
    assert signature == base64.urlsafe_b64encode(expected).rstrip(b"=").decode()
    assert "test-client-secret" not in token


def test_access_token_is_cached_until_shortly_before_it_expires() -> None:
    fake = FakeTaxBandits(token_lifetime=3600)
    now = [1_795_000_000.0]
    client = TaxBanditsClient(CREDENTIALS, transport=httpx.MockTransport(fake), clock=lambda: now[0])

    client.status("W2", "sub-1", "rec-1")
    now[0] += 3600 - 61
    client.status("W2", "sub-1", "rec-1")
    assert len(fake.token_requests) == 1

    now[0] += 2  # inside the last minute of the token's life
    client.status("W2", "sub-1", "rec-1")
    assert len(fake.token_requests) == 2
    assert _decode(fake.token_requests[1].headers["Authentication"].split(".")[1])["iat"] == int(now[0])


def test_production_uses_the_live_hosts() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.host == "oauth.expressauth.net":
            return httpx.Response(200, json={"AccessToken": "t", "ExpiresIn": 3600})
        return httpx.Response(200, json={"FormW2Records": []})

    live = CREDENTIALS.__class__(client_id="a", client_secret="b", user_token="c", env="production")
    TaxBanditsClient(live, transport=httpx.MockTransport(handler)).status("W2", "sub-1", "rec-1")
    assert seen == [
        "https://oauth.expressauth.net/v2/token",
        "https://api.taxbandits.com/v2.0.0/formw2/status?submissionId=sub-1&recordIds=rec-1",
    ]


def test_refused_credentials_and_outages_are_told_apart() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        body = {"StatusCode": 401, "AccessToken": "null", "ExpiresIn": 0, "Errors": [{"Id": "AUTH-100005"}]}
        return httpx.Response(401, json=body)

    with pytest.raises(TaxBanditsAuthError):
        TaxBanditsClient(CREDENTIALS, transport=httpx.MockTransport(refuse)).status("W2", "s", "r")

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    with pytest.raises(TaxBanditsUnavailable):
        TaxBanditsClient(CREDENTIALS, transport=httpx.MockTransport(down)).status("W2", "s", "r")

    def broken(request: httpx.Request) -> httpx.Response:
        if "token" in request.url.path:
            return httpx.Response(200, json={"AccessToken": "t", "ExpiresIn": 3600})
        return httpx.Response(503, text="<html>maintenance</html>")

    with pytest.raises(TaxBanditsUnavailable):
        TaxBanditsClient(CREDENTIALS, transport=httpx.MockTransport(broken)).create("W2", {"ReturnData": []})


def test_an_unexplained_refusal_still_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "token" in request.url.path:
            return httpx.Response(200, json={"AccessToken": "t", "ExpiresIn": 3600})
        return httpx.Response(400, json={"unexpected": "shape"})

    client = TaxBanditsClient(CREDENTIALS, transport=httpx.MockTransport(handler))
    with pytest.raises(TaxBanditsRejected) as raised:
        client.create("1099NEC", {"ReturnData": []})
    assert raised.value.errors[0].message == "TaxBandits answered 400 without an explanation."


def test_log_formatter_scrubs_messages_and_tracebacks() -> None:
    try:
        raise ValueError("bad value 412-55-7890")
    except ValueError:
        record = logging.getLogger("test").makeRecord(
            "test", logging.ERROR, __file__, 1, "failed for %s", ("62-1847305",), sys.exc_info()
        )
    entry = json.loads(JsonFormatter().format(record))
    assert entry["msg"] == "failed for [redacted]"
    assert "ValueError: bad value [redacted]" in entry["exc"]
    assert "412" not in json.dumps(entry)
