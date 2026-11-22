from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth import passwords
from app.config import ConfigError, load_settings
from app.logs import JsonFormatter, scrub

from .conftest import Outbound, bearer, make_client

PASSWORD = "correct horse battery"
WRONG = {"error": {"code": "invalid_credentials", "message": "Email or password is incorrect."}}


@pytest.fixture
def client(outbound: Outbound) -> Iterator[TestClient]:
    with make_client(outbound, password_login_enabled=True) as test_client:
        yield test_client


def rows(client: TestClient, sql: str) -> list[Any]:
    with client.app.state.sessions() as db:
        return list(db.execute(text(sql)))


def signup(client: TestClient, email: str = "renee@example.com", password: str = PASSWORD, **extra: Any) -> Any:
    return client.post("/v1/auth/password/signup", json={"email": email, "password": password, **extra})


def login(client: TestClient, email: str = "renee@example.com", password: str = PASSWORD) -> Any:
    return client.post("/v1/auth/password/login", json={"email": email, "password": password})


def test_sign_up_then_sign_in(client: TestClient) -> None:
    assert client.get("/v1/meta").json()["signIn"]["password"] is True
    created = signup(client, "  Renee@Example.COM ", name=" Renee Okafor ")
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["tokenType"] == "Bearer"
    assert body["user"]["provider"] == "password"
    assert body["user"]["email"] == "renee@example.com"
    assert body["user"]["name"] == "Renee Okafor"
    assert client.get("/v1/me", headers=bearer(body)).json()["id"] == body["user"]["id"]

    signed_in = login(client, "RENEE@example.com")
    assert signed_in.status_code == 200
    assert signed_in.json()["user"]["id"] == body["user"]["id"]
    assert signed_in.json()["sessionId"] != body["sessionId"]
    # A normal session: it refreshes like any other.
    assert client.post("/v1/auth/refresh", json={"refreshToken": signed_in.json()["refreshToken"]}).status_code == 200
    assert rows(client, "SELECT provider, provider_subject FROM users") == [("password", "renee@example.com")]


def test_wrong_password_and_unknown_email_get_the_same_answer(client: TestClient) -> None:
    assert signup(client).status_code == 200
    wrong = login(client, password="not the password")
    unknown = login(client, email="nobody@example.com")
    too_short = login(client, password="short")
    for response in (wrong, unknown, too_short):
        assert response.status_code == 401
        assert response.json() == WRONG


def test_unknown_email_does_the_same_hashing_work(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    real = passwords.verify_password
    monkeypatch.setattr(passwords, "verify_password", lambda pw, stored: calls.append(stored) or real(pw, stored))
    assert login(client, email="nobody@example.com").status_code == 401
    assert len(calls) == 1 and calls[0].startswith("scrypt$n=32768,r=8,p=1,l=64$")


def test_signing_up_twice_with_one_email_is_refused(client: TestClient) -> None:
    assert signup(client).status_code == 200
    again = signup(client, "Renee@example.com", "a different password")
    assert again.status_code == 409
    assert again.json()["error"] == {
        "code": "email_taken",
        "message": "An account with this email already exists. Sign in instead.",
    }
    assert rows(client, "SELECT count(*) FROM users")[0][0] == 1


def test_email_and_password_rules(client: TestClient) -> None:
    for email, password in (
        ("not-an-email", PASSWORD),
        ("a@b", PASSWORD),
        ("x" * 310 + "@example.com", PASSWORD),
        ("renee@example.com", "123456789"),  # 9 characters
        ("renee@example.com", "x" * 129),
    ):
        response = signup(client, email, password)
        assert response.status_code == 400, (email, password)
        # The password is never echoed back in the error.
        assert password not in response.text
    assert signup(client, "renee@example.com", "1234567890").status_code == 200  # exactly 10 is fine
    assert signup(client, "x@example.com", "y" * 128).status_code == 200


def test_password_routes_are_rate_limited(outbound: Outbound) -> None:
    with make_client(outbound, password_login_enabled=True, auth_rate_limit_per_minute=2) as client:
        codes = [login(client).status_code for _ in range(3)]
        assert codes == [401, 401, 429]
        assert signup(client).status_code == 429


def test_routes_do_not_exist_when_switched_off(outbound: Outbound) -> None:
    with make_client(outbound) as client:
        assert client.get("/v1/meta").json()["signIn"]["password"] is False
        for response in (signup(client), login(client)):
            assert response.status_code == 404
            assert response.json()["error"]["code"] == "not_found"
        assert "/v1/auth/password/login" not in client.get("/openapi.json").json()["paths"]


def test_the_switch_is_allowed_in_production_and_counts_as_a_sign_in_method() -> None:
    production = {"APP_ENV": "production", "DATABASE_URL": "postgresql://u:p@db/x", "AUTH_JWT_SECRET": "s" * 40}
    with pytest.raises(ConfigError, match="PASSWORD_LOGIN_ENABLED"):
        load_settings(production)  # no sign-in method at all
    assert load_settings({**production, "PASSWORD_LOGIN_ENABLED": "true"}).password_login_enabled is True
    assert load_settings({}).password_login_enabled is False


def test_passwords_are_stored_only_as_salted_hashes_and_never_logged(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    assert signup(client).status_code == 200
    assert signup(client, "other@example.com").status_code == 200
    assert login(client).status_code == 200
    assert login(client, password="wrong password!").status_code == 401

    hashes = [row[0] for row in rows(client, "SELECT password_hash FROM password_credentials")]
    assert len(hashes) == 2
    assert hashes[0] != hashes[1]  # same password, different salt
    for stored in hashes:
        assert PASSWORD not in stored
        assert stored.startswith("scrypt$n=32768,r=8,p=1,l=64$")
        assert passwords.verify_password(PASSWORD, stored)
        assert not passwords.verify_password("wrong password!", stored)
    dump = "\n".join(
        str(row) for table in ("users", "audit_log", "auth_sessions") for row in rows(client, f"SELECT * FROM {table}")
    )
    assert PASSWORD not in dump

    lines = "\n".join(JsonFormatter().format(record) for record in caplog.records)
    for secret in (PASSWORD, "wrong password!", *hashes):
        assert secret not in caplog.text
        assert secret not in lines


def test_log_redaction_covers_password_fields_and_hashes() -> None:
    stored = passwords.hash_password(PASSWORD)
    for text_ in (
        f"body was {json.dumps({'email': 'a@b.co', 'password': PASSWORD})}",
        f"password={PASSWORD}",
        f"newPassword: {PASSWORD}",
        f"stored {stored}",
    ):
        assert PASSWORD not in scrub(text_)
        assert stored not in scrub(text_)
    record = logging.getLogger("t").makeRecord(
        "t", logging.ERROR, __file__, 1, "%s", (json.dumps({"password": PASSWORD}),), None
    )
    assert PASSWORD not in JsonFormatter().format(record)
    assert scrub("the password field is required") == "the password field is required"


def test_deleting_the_account_removes_the_password_hash(client: TestClient) -> None:
    tokens = signup(client).json()
    signup(client, "other@example.com")
    assert rows(client, "SELECT count(*) FROM password_credentials")[0][0] == 2
    assert client.delete("/v1/me", headers=bearer(tokens)).status_code == 204
    assert rows(client, "SELECT count(*) FROM password_credentials")[0][0] == 1
    assert login(client).status_code == 401
    # The address is free again.
    assert signup(client).status_code == 200


def test_a_malformed_stored_hash_never_matches() -> None:
    for stored in ("", "plain", "bcrypt$x$y$z", "scrypt$n=1$a$b", "scrypt$n=x,r=8,p=1,l=64$AA==$AA=="):
        assert passwords.verify_password(PASSWORD, stored) is False
