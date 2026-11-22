from __future__ import annotations

import time
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth.sessions import hash_token

from .conftest import (
    GOOGLE_CLIENT_ID,
    JWT_SECRET,
    FakeIdentityProviders,
    Outbound,
    bearer,
    make_client,
    new_user,
    sign_in,
)


def rows(client: TestClient, sql: str) -> list[Any]:
    with client.app.state.sessions() as db:
        return list(db.execute(text(sql)))


# ---- Signing in ---------------------------------------------------------------


def test_google_sign_in_creates_the_account_once(client: TestClient, identity: FakeIdentityProviders) -> None:
    first = sign_in(client, identity, "g-123")
    assert first["tokenType"] == "Bearer"
    assert first["expiresIn"] == 900
    assert first["user"]["provider"] == "google"
    assert first["user"]["email"] == "g-123@example.com"
    assert first["user"]["name"] == "Renee Okafor"
    assert first["user"]["plan"] == "free"
    assert first["user"]["entitlements"] == {"maxBusinesses": 1, "maxWorkers": 50}

    second = sign_in(client, identity, "g-123")
    assert second["user"]["id"] == first["user"]["id"]
    assert second["sessionId"] != first["sessionId"]
    assert rows(client, "SELECT count(*) FROM users")[0][0] == 1
    assert client.get("/v1/me", headers=bearer(second)).json()["id"] == first["user"]["id"]


def test_apple_sign_in_takes_the_name_from_the_app_on_first_use(
    client: TestClient, identity: FakeIdentityProviders
) -> None:
    token = identity.token("apple", "001234.abc")
    body = {"identityToken": token, "fullName": {"givenName": "Renee", "familyName": "Okafor"}}
    first = client.post("/v1/auth/apple", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["user"]["name"] == "Renee Okafor"
    assert first.json()["user"]["provider"] == "apple"
    assert first.json()["user"]["email"] == "001234.abc@privaterelay.appleid.com"

    # Later sign-ins carry no name; the stored one is kept.
    again = client.post("/v1/auth/apple", json={"identityToken": identity.token("apple", "001234.abc")})
    assert again.json()["user"]["name"] == "Renee Okafor"
    assert again.json()["user"]["id"] == first.json()["user"]["id"]


def test_the_same_email_at_two_providers_is_two_accounts(client: TestClient, identity: FakeIdentityProviders) -> None:
    google = client.post("/v1/auth/google", json={"idToken": identity.token("google", "same", email="r@example.com")})
    apple = client.post(
        "/v1/auth/apple", json={"identityToken": identity.token("apple", "same", email="r@example.com")}
    )
    assert google.json()["user"]["email"] == apple.json()["user"]["email"] == "r@example.com"
    assert google.json()["user"]["id"] != apple.json()["user"]["id"]


@pytest.mark.parametrize(
    "claims",
    [
        {"aud": "someone-elses-client-id"},
        {"iss": "https://accounts.example.com"},
        {"exp": int(time.time()) - 3600},
        {"email_verified": False},
        {"omit": ("sub",)},
        {"omit": ("exp",)},
    ],
)
def test_google_tokens_with_bad_claims_are_refused(
    client: TestClient, identity: FakeIdentityProviders, claims: dict[str, Any]
) -> None:
    response = client.post("/v1/auth/google", json={"idToken": identity.token("google", "g-1", **claims)})
    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "invalid_identity_token", "message": "That sign-in could not be verified."}
    }
    assert rows(client, "SELECT count(*) FROM users")[0][0] == 0


def test_both_documented_google_issuers_are_accepted(client: TestClient, identity: FakeIdentityProviders) -> None:
    for issuer in ("accounts.google.com", "https://accounts.google.com"):
        token = identity.token("google", "g-1", iss=issuer)
        assert client.post("/v1/auth/google", json={"idToken": token}).status_code == 200


def test_forged_tokens_are_refused(client: TestClient, identity: FakeIdentityProviders) -> None:
    good = identity.token("google", "g-1")
    header, payload, signature = good.split(".")
    forgeries = {
        "signed by another key": identity.token_signed_by_stranger("google", "g-1"),
        "unknown key id": identity.token("google", "g-1", kid="not-published"),
        "tampered payload": ".".join([header, payload[:-2] + ("AA" if payload[-2:] != "AA" else "BB"), signature]),
        "no signature": f"{header}.{payload}.",
        # Algorithm confusion: signed with HMAC, hoping the server uses a public value as the secret.
        "hmac": jwt.encode(
            {"sub": "g-1", "aud": GOOGLE_CLIENT_ID, "iss": "https://accounts.google.com", "exp": time.time() + 60},
            "x" * 32,
            algorithm="HS256",
            headers={"kid": identity.kid},
        ),
        "an apple token": identity.token("apple", "g-1"),
        "not a token": "x" * 40,
    }
    for name, token in forgeries.items():
        response = client.post("/v1/auth/google", json={"idToken": token})
        assert response.status_code == 401, name
        assert response.json()["error"]["code"] == "invalid_identity_token", name
    # One of our own access tokens is not an identity token either.
    ours = sign_in(client, identity, "g-1")["accessToken"]
    assert client.post("/v1/auth/google", json={"idToken": ours}).status_code == 401


def test_apple_tokens_are_checked_the_same_way(client: TestClient, identity: FakeIdentityProviders) -> None:
    def post(**claims: Any) -> int:
        token = identity.token("apple", "a-1", **claims)
        return client.post("/v1/auth/apple", json={"identityToken": token}).status_code

    assert post() == 200
    assert post(aud="com.someone.else") == 401
    assert post(iss="https://accounts.google.com") == 401
    assert post(exp=int(time.time()) - 3600) == 401
    # An address Apple does not vouch for is not stored, but the sign-in itself is fine.
    token = identity.token("apple", "a-2", email_verified="false")
    unverified = client.post("/v1/auth/apple", json={"identityToken": token})
    assert unverified.status_code == 200
    assert unverified.json()["user"]["email"] is None


def test_a_nonce_in_the_token_must_be_presented(client: TestClient, identity: FakeIdentityProviders) -> None:
    token = identity.token("apple", "a-1", nonce="n-abc123")
    assert client.post("/v1/auth/apple", json={"identityToken": token}).status_code == 401
    assert client.post("/v1/auth/apple", json={"identityToken": token, "nonce": "wrong"}).status_code == 401
    assert client.post("/v1/auth/apple", json={"identityToken": token, "nonce": "n-abc123"}).status_code == 200
    # Claiming a nonce the token does not carry is refused too.
    plain = identity.token("apple", "a-1")
    assert client.post("/v1/auth/apple", json={"identityToken": plain, "nonce": "n-abc123"}).status_code == 401


def test_signing_keys_are_cached_and_refetched_on_rotation(client: TestClient, identity: FakeIdentityProviders) -> None:
    for sub in ("g-1", "g-2", "g-3"):
        sign_in(client, identity, sub)
    assert identity.fetches == ["https://www.googleapis.com/oauth2/v3/certs"]
    sign_in(client, identity, "a-1", provider="apple")
    assert identity.fetches[-1] == "https://appleid.apple.com/auth/keys"
    assert len(identity.fetches) == 2

    # Google rotates its key. A token with the new key id is refused until the keys may be fetched again
    # (unknown key ids trigger at most one refetch a minute), then accepted.
    identity.kid = "key-2"
    token = identity.token("google", "g-1")
    assert client.post("/v1/auth/google", json={"idToken": token}).status_code == 401
    assert len(identity.fetches) == 2
    cache = client.app.state.identity._keys["google"]
    cache._fetched_at -= 61
    assert client.post("/v1/auth/google", json={"idToken": token}).status_code == 200
    assert len(identity.fetches) == 3


def test_sign_in_when_the_provider_keys_cannot_be_fetched(client: TestClient, identity: FakeIdentityProviders) -> None:
    identity.down = True
    response = client.post("/v1/auth/google", json={"idToken": identity.token("google", "g-1")})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "identity_provider_unavailable"


def test_a_provider_without_client_ids_is_off(outbound: Outbound, identity: FakeIdentityProviders) -> None:
    with make_client(outbound, apple_client_ids=()) as client:
        assert client.get("/v1/meta").json()["signIn"] == {"google": True, "apple": False, "password": False}
        response = client.post("/v1/auth/apple", json={"identityToken": identity.token("apple", "a-1")})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "provider_not_configured"
        assert identity.fetches == []


def test_sign_in_is_rate_limited_per_client(outbound: Outbound, identity: FakeIdentityProviders) -> None:
    with make_client(outbound, auth_rate_limit_per_minute=2) as client:
        codes = [client.post("/v1/auth/google", json={"idToken": "x" * 40}).status_code for _ in range(3)]
        assert codes == [401, 401, 429]
        assert client.post("/v1/auth/refresh", json={"refreshToken": "x" * 40}).status_code == 429
        assert client.get("/health").status_code == 200


# ---- Access tokens ------------------------------------------------------------


def test_every_private_route_needs_a_valid_access_token(client: TestClient) -> None:
    expired = jwt.encode(
        {"iss": "stubwise", "aud": "stubwise-api", "sub": "u", "sid": "s", "iat": 1, "exp": 2},
        JWT_SECRET,
        algorithm="HS256",
    )
    forged = jwt.encode(
        {"iss": "stubwise", "aud": "stubwise-api", "sub": "u", "sid": "s", "iat": 1, "exp": time.time() + 600},
        "another-secret-another-secret-another-secret",
        algorithm="HS256",
    )
    public = {"/health", "/ready", "/v1/meta", "/v1/meta/tax-coverage"}
    unauthenticated = {"/v1/auth/google", "/v1/auth/apple", "/v1/auth/refresh"}
    credentials = (
        {},
        {"authorization": "Basic abc"},
        bearer({"accessToken": expired}),
        bearer({"accessToken": forged}),
    )
    checked = 0
    # The route table, as published. A new route is covered here without anyone remembering to add it.
    for path, operations in client.get("/openapi.json").json()["paths"].items():
        if path in public | unauthenticated:
            continue
        url = path.replace("{worker_id}", "x").replace("{stub_id}", "x").replace("{session_id}", "x")
        for method in operations:
            for headers in credentials:
                response = client.request(method.upper(), url, headers=headers, json={})
                assert response.status_code == 401, (method, path, headers)
                assert response.json()["error"]["code"] == "unauthorized"
            checked += 1
    assert checked >= 30


def test_tokens_are_stored_only_as_hashes(client: TestClient, identity: FakeIdentityProviders) -> None:
    tokens = sign_in(client, identity)
    stored = [row[0] for row in rows(client, "SELECT token_hash FROM refresh_tokens")]
    assert stored == [hash_token(tokens["refreshToken"])]
    dump = str(
        [
            tuple(r)
            for table in ("users", "auth_sessions", "refresh_tokens")
            for r in rows(client, f"SELECT * FROM {table}")
        ]
    )
    assert tokens["refreshToken"] not in dump
    assert tokens["accessToken"] not in dump


# ---- Refresh, logout, sessions ------------------------------------------------


def test_refresh_rotates_the_token(client: TestClient, identity: FakeIdentityProviders) -> None:
    first = sign_in(client, identity)
    second = client.post("/v1/auth/refresh", json={"refreshToken": first["refreshToken"]})
    assert second.status_code == 200, second.text
    assert second.json()["refreshToken"] != first["refreshToken"]
    assert second.json()["sessionId"] == first["sessionId"]
    assert client.get("/v1/me", headers=bearer(second.json())).status_code == 200
    third = client.post("/v1/auth/refresh", json={"refreshToken": second.json()["refreshToken"]})
    assert third.status_code == 200


def test_reusing_a_refresh_token_revokes_the_whole_session(client: TestClient, identity: FakeIdentityProviders) -> None:
    stolen = sign_in(client, identity)
    other_device = sign_in(client, identity)
    fresh = client.post("/v1/auth/refresh", json={"refreshToken": stolen["refreshToken"]}).json()

    replay = client.post("/v1/auth/refresh", json={"refreshToken": stolen["refreshToken"]})
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "invalid_refresh_token"

    # Everything descended from that sign-in is dead: the newest refresh token and the access tokens.
    assert client.post("/v1/auth/refresh", json={"refreshToken": fresh["refreshToken"]}).status_code == 401
    assert client.get("/v1/me", headers=bearer(fresh)).status_code == 401
    assert client.get("/v1/me", headers=bearer(stolen)).status_code == 401
    # The user's other device is a different session and is untouched.
    assert client.get("/v1/me", headers=bearer(other_device)).status_code == 200
    events = [row[0] for row in rows(client, "SELECT event FROM audit_log ORDER BY id")]
    assert "auth.refresh_reuse_detected" in events


def test_unknown_and_expired_refresh_tokens_are_refused(client: TestClient, identity: FakeIdentityProviders) -> None:
    assert client.post("/v1/auth/refresh", json={"refreshToken": "x" * 64}).status_code == 401
    tokens = sign_in(client, identity)
    with client.app.state.sessions() as db:
        db.execute(text("UPDATE refresh_tokens SET expires_at = '2020-01-01 00:00:00'"))
        db.commit()
    assert client.post("/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]}).status_code == 401


def test_logout_ends_the_session_at_once(client: TestClient, identity: FakeIdentityProviders) -> None:
    tokens = sign_in(client, identity)
    assert client.post("/v1/auth/logout", headers=bearer(tokens)).status_code == 204
    assert client.get("/v1/me", headers=bearer(tokens)).status_code == 401
    assert client.post("/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]}).status_code == 401


def test_sessions_can_be_listed_and_revoked(client: TestClient, identity: FakeIdentityProviders) -> None:
    phone = sign_in(client, identity)
    tablet = sign_in(client, identity)
    stranger = sign_in(client, identity, "user-2")

    listed = client.get("/v1/auth/sessions", headers=bearer(phone)).json()["sessions"]
    assert {session["id"] for session in listed} == {phone["sessionId"], tablet["sessionId"]}
    assert [session["id"] for session in listed if session["current"]] == [phone["sessionId"]]

    # Another user's session cannot be revoked, or even confirmed to exist.
    theirs = client.delete(f"/v1/auth/sessions/{stranger['sessionId']}", headers=bearer(phone))
    assert theirs.status_code == 404
    assert client.get("/v1/me", headers=bearer(stranger)).status_code == 200

    assert client.delete(f"/v1/auth/sessions/{tablet['sessionId']}", headers=bearer(phone)).status_code == 204
    assert client.get("/v1/me", headers=bearer(tablet)).status_code == 401
    assert len(client.get("/v1/auth/sessions", headers=bearer(phone)).json()["sessions"]) == 1


# ---- The account --------------------------------------------------------------


def test_profile_can_be_read_and_renamed(client: TestClient, auth: dict[str, str]) -> None:
    assert client.patch("/v1/me", headers=auth, json={"name": "  R. Okafor "}).json()["name"] == "R. Okafor"
    assert client.get("/v1/me", headers=auth).json()["name"] == "R. Okafor"
    assert client.patch("/v1/me", headers=auth, json={"name": 5}).status_code == 400
    # plan is not something a user can set.
    assert client.patch("/v1/me", headers=auth, json={"name": "R", "plan": "pro"}).json()["plan"] == "free"


def test_deleting_the_account_removes_everything_it_owned(client: TestClient, identity: FakeIdentityProviders) -> None:
    from .test_records import seed

    tokens = sign_in(client, identity)
    headers = bearer(tokens)
    seed(client, headers)
    keeper = new_user(client, identity, "user-2")
    seed(client, keeper)

    assert client.delete("/v1/me", headers=headers).status_code == 204
    assert client.get("/v1/me", headers=headers).status_code == 401
    assert client.post("/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]}).status_code == 401

    user_id = tokens["user"]["id"]
    for table in ("users", "auth_sessions", "businesses", "workers", "stubs", "idempotency_keys"):
        column = "id" if table == "users" else "user_id"
        assert rows(client, f"SELECT count(*) FROM {table} WHERE {column} = '{user_id}'")[0][0] == 0, table
    assert rows(client, "SELECT count(*) FROM refresh_tokens")[0][0] == 1
    assert rows(client, "SELECT count(*) FROM stub_lines")[0][0] > 0  # the other user's
    assert client.get("/v1/workers", headers=keeper).json()["items"] != []
    # The record that it happened outlives the account.
    assert (
        rows(client, f"SELECT event FROM audit_log WHERE user_id = '{user_id}' ORDER BY id DESC")[0][0]
        == "account.deleted"
    )

    # Signing in again starts a new, empty account.
    again = sign_in(client, identity)
    assert again["user"]["id"] != user_id
    assert client.get("/v1/business", headers=bearer(again)).status_code == 404


def test_export_returns_everything_and_only_the_users_own(client: TestClient, identity: FakeIdentityProviders) -> None:
    from .test_records import seed

    tokens = sign_in(client, identity)
    headers = bearer(tokens)
    mine = seed(client, headers)
    theirs = seed(client, new_user(client, identity, "user-2"), business_name="Other Shop")

    export = client.get("/v1/me/export", headers=headers)
    assert export.status_code == 200
    body = export.json()
    assert body["user"]["id"] == tokens["user"]["id"]
    assert [session["id"] for session in body["sessions"]] == [tokens["sessionId"]]
    assert body["records"]["business"]["name"] == "Ridgeline Auto Repair"
    assert [worker["id"] for worker in body["records"]["workers"]] == [mine["worker"]["id"]]
    assert [stub["id"] for stub in body["records"]["stubs"]] == [mine["stub"]["id"]]
    assert body["filings"] == []
    assert [entry["event"] for entry in body["auditLog"]] == ["auth.sign_up", "account.exported"]
    assert "Other Shop" not in export.text
    assert theirs["worker"]["id"] not in export.text
    assert tokens["refreshToken"] not in export.text
