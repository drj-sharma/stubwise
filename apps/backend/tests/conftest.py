from __future__ import annotations

import json
import os
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.config import Settings, TaxBanditsCredentials, _database_url
from app.main import create_app
from app.models import Base

OAUTH_HOST = "testoauth.expressauth.net"
API_HOST = "testapi.taxbandits.com"

CREDENTIALS = TaxBanditsCredentials(
    client_id="test-client-id",
    client_secret="test-client-secret",
    user_token="test-user-token",
    env="sandbox",
)


@dataclass
class FakeTaxBandits:
    """Stands in for TaxBandits over an httpx MockTransport. No test ever touches the network.

    Replies follow the sample JSON in the v2.0.0 docs.
    """

    calls: list[tuple[str, str, Any]] = field(default_factory=list)
    token_requests: list[httpx.Request] = field(default_factory=list)
    token_lifetime: int = 3600
    reject_sequence_ids: set[str] = field(default_factory=set)
    """Recipients (by SequenceId) that Create refuses."""
    federal_status: str = "SENT_TO_AGENCY"
    """What Status reports for every record."""
    status_message: str | None = None
    failing: set[str] = field(default_factory=set)
    """Operations ('create', 'transmit', 'status', 'delete') that drop the connection."""
    expire_tokens_once: bool = False
    transmitted: set[str] = field(default_factory=set)
    deleted: list[str] = field(default_factory=list)
    _tokens: list[str] = field(default_factory=list)

    def paths(self) -> list[str]:
        return [f"{method} {path}" for method, path, _ in self.calls]

    def bodies(self, path_suffix: str) -> list[Any]:
        return [body for _, path, body in self.calls if path.endswith(path_suffix)]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.url.host in (OAUTH_HOST, API_HOST), f"unexpected host {request.url.host}"
        if request.url.host == OAUTH_HOST:
            return self._token(request)

        assert request.url.path.startswith("/v2.0.0/")
        path = request.url.path.removeprefix("/v2.0.0/").lower()
        body = json.loads(request.content) if request.content else dict(request.url.params)
        self.calls.append((request.method, path, body))

        if self.expire_tokens_once:
            self.expire_tokens_once = False
            self._tokens.clear()
        if request.headers.get("authorization") not in [f"Bearer {token}" for token in self._tokens]:
            return httpx.Response(401, json={"StatusCode": 401, "Errors": [{"Id": "AUTH", "Message": "no"}]})

        operation = path.rsplit("/", 1)[-1]
        if operation in self.failing:
            raise httpx.ReadTimeout("simulated timeout", request=request)
        form = "W2" if path.startswith("formw2") else "1099"
        return getattr(self, f"_{operation}")(form, body)

    def _token(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/v2/token"
        self.token_requests.append(request)
        token = f"access-{uuid.uuid4().hex}"
        self._tokens.append(token)
        return httpx.Response(
            200,
            json={
                "StatusCode": 200,
                "StatusName": "Ok",
                "StatusMessage": "Successful API call",
                "AccessToken": token,
                "TokenType": "Bearer",
                "ExpiresIn": self.token_lifetime,
                "Errors": None,
            },
        )

    def _create(self, form: str, body: dict[str, Any]) -> httpx.Response:
        success, errors = [], []
        for item in body["ReturnData"]:
            sequence = item["SequenceId"]
            if sequence in self.reject_sequence_ids:
                tin = item["Employee" if form == "W2" else "Recipient"]["TINDetails"]["TIN"]
                errors.append(
                    {
                        "SequenceId": sequence,
                        "RecordId": None,
                        # Echoes the number back, as a careless vendor message might.
                        "Errors": [{"Id": "F00-100145", "Name": "TIN", "Message": f"TIN {tin} is invalid"}],
                    }
                )
                continue
            record = {
                "SequenceId": sequence,
                "RecordId": str(uuid.uuid4()),
                "PayeeRef": None,
                "Federal": {"Status": "CREATED", "StatusCd": "FED_001", "Info": None, "Errors": None},
                "State": [],
            }
            record["EmployeeId" if form == "W2" else "RecipientId"] = str(uuid.uuid4())
            success.append(record)
        records = {"SuccessRecords": success or None, "ErrorRecords": errors or None}
        reply: dict[str, Any] = {
            "SubmissionId": str(uuid.uuid4()),
            "BusinessId": str(uuid.uuid4()),
            "PayerRef": None,
            "Errors": None,
        }
        reply.update({"FormType": "W2", "FormW2Records": records} if form == "W2" else {"Form1099Type": "NEC"})
        if form != "W2":
            reply["Form1099Records"] = records
        if not success:
            reply["SubmissionId"] = None
            return httpx.Response(400, json=reply)
        return httpx.Response(207 if errors else 200, json=reply)

    def _transmit(self, form: str, body: dict[str, Any]) -> httpx.Response:
        self.transmitted.update(body["RecordIds"])
        records = [
            {
                "FormType": "FormW2" if form == "W2" else "Form1099NEC",
                "SubmissionId": body["SubmissionId"],
                "RecordId": record_id,
                "FederalStatus": {"Code": "FED-005", "Status": "TRANSMITTED", "Message": None},
                "StatesStatus": [],
            }
            for record_id in body["RecordIds"]
        ]
        return httpx.Response(200, json={"FormW2Records" if form == "W2" else "Form1099Records": records})

    def _status(self, form: str, params: dict[str, Any]) -> httpx.Response:
        record_id = params["recordIds"]
        status = self.federal_status if record_id in self.transmitted else "CREATED"
        record = {
            "RecordId": record_id,
            "FederalStatus": {"Status": status, "Message": self.status_message, "Errors": None},
        }
        key = "FormW2Records" if form == "W2" else "Form1099Records"
        return httpx.Response(200, json={"SubmissionId": params["submissionId"], key: [record], "Errors": None})

    def _delete(self, form: str, params: dict[str, Any]) -> httpx.Response:
        self.deleted.append(params["submissionId"])
        key = "FormW2Records" if form == "W2" else "Form1099Records"
        return httpx.Response(200, json={key: {"SuccessRecords": [], "ErrorRecords": None}, "Errors": None})


# In-memory SQLite by default. Set TEST_DATABASE_URL to run the same suite against Postgres
# (a database used for nothing else: every test drops and recreates all tables).
TEST_DATABASE_URL = _database_url(os.environ.get("TEST_DATABASE_URL", "").strip() or "sqlite://")

GOOGLE_CLIENT_ID = "1234-test.apps.googleusercontent.com"
APPLE_BUNDLE_ID = "com.stubwise.app"
JWT_SECRET = "test-secret-test-secret-test-secret-0123"

# One key pair for the whole run: generating RSA keys is the slow part.
_PROVIDER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwk(key: rsa.RSAPrivateKey, kid: str) -> dict[str, Any]:
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    return {**jwk, "kid": kid, "alg": "RS256", "use": "sig"}


@dataclass
class FakeIdentityProviders:
    """Google's and Apple's key endpoints, and a way to mint ID tokens signed with those keys."""

    fetches: list[str] = field(default_factory=list)
    kid: str = "key-1"
    down: bool = False
    max_age: int = 3600

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.fetches.append(str(request.url))
        if self.down:
            raise httpx.ConnectError("no route", request=request)
        assert str(request.url) in (
            "https://www.googleapis.com/oauth2/v3/certs",
            "https://appleid.apple.com/auth/keys",
        )
        return httpx.Response(
            200,
            json={"keys": [_jwk(_PROVIDER_KEY, self.kid)]},
            headers={"cache-control": f"public, max-age={self.max_age}"},
        )

    def token(
        self,
        provider: str,
        sub: str,
        *,
        key: rsa.RSAPrivateKey | None = None,
        kid: str | None = None,
        algorithm: str = "RS256",
        omit: tuple[str, ...] = (),
        **claims: Any,
    ) -> str:
        now = int(time.time())
        if provider == "google":
            body = {
                "iss": "https://accounts.google.com",
                "aud": GOOGLE_CLIENT_ID,
                "email": f"{sub}@example.com",
                "email_verified": True,
                "name": "Renee Okafor",
            }
        else:
            body = {
                "iss": "https://appleid.apple.com",
                "aud": APPLE_BUNDLE_ID,
                "email": f"{sub}@privaterelay.appleid.com",
                "email_verified": "true",
            }
        body.update({"sub": sub, "iat": now, "exp": now + 600})
        body.update(claims)
        body = {name: value for name, value in body.items() if name not in omit}
        return jwt.encode(body, key or _PROVIDER_KEY, algorithm=algorithm, headers={"kid": kid or self.kid})

    def token_signed_by_stranger(self, provider: str, sub: str) -> str:
        return self.token(provider, sub, key=_OTHER_KEY)


@dataclass
class Outbound:
    """Every outbound call the server can make, answered locally."""

    identity: FakeIdentityProviders
    taxbandits: FakeTaxBandits

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.host in (OAUTH_HOST, API_HOST):
            return self.taxbandits(request)
        return self.identity(request)


def settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "app_env": "test",
        "database_url": TEST_DATABASE_URL,
        "auth_jwt_secret": JWT_SECRET,
        "google_client_ids": (GOOGLE_CLIENT_ID,),
        "apple_client_ids": (APPLE_BUNDLE_ID,),
        "rate_limit_per_minute": 100_000,
        "auth_rate_limit_per_minute": 100_000,
        "write_rate_limit_per_minute": 100_000,
        "filing_rate_limit_per_minute": 100_000,
    }
    return Settings(**{**values, **overrides})


def make_client(outbound: Outbound, **overrides: Any) -> TestClient:
    app = create_app(settings(**overrides), outbound_transport=httpx.MockTransport(outbound))
    if not TEST_DATABASE_URL.startswith("sqlite"):
        Base.metadata.drop_all(app.state.sessions.kw["bind"])  # a real database keeps the last test's rows
    # Tests build the schema straight from the models; test_migrations checks Alembic produces the same one.
    Base.metadata.create_all(app.state.sessions.kw["bind"])
    return TestClient(app)


@pytest.fixture
def taxbandits() -> FakeTaxBandits:
    return FakeTaxBandits()


@pytest.fixture
def identity() -> FakeIdentityProviders:
    return FakeIdentityProviders()


@pytest.fixture
def outbound(identity: FakeIdentityProviders, taxbandits: FakeTaxBandits) -> Outbound:
    return Outbound(identity, taxbandits)


@pytest.fixture
def client(outbound: Outbound) -> Iterator[TestClient]:
    with make_client(outbound) as test_client:
        yield test_client


def sign_in(client: TestClient, identity: FakeIdentityProviders, sub: str = "user-1", provider: str = "google") -> dict:
    """Signs in and returns the whole token response."""
    field_name = "idToken" if provider == "google" else "identityToken"
    response = client.post(f"/v1/auth/{provider}", json={field_name: identity.token(provider, sub)})
    assert response.status_code == 200, response.text
    return response.json()


def bearer(tokens: dict) -> dict[str, str]:
    return {"authorization": f"Bearer {tokens['accessToken']}"}


def new_user(client: TestClient, identity: FakeIdentityProviders, sub: str) -> dict[str, str]:
    return bearer(sign_in(client, identity, sub))


@pytest.fixture
def auth(client: TestClient, identity: FakeIdentityProviders) -> dict[str, str]:
    """Authorization headers for a signed-in user."""
    return new_user(client, identity, "user-1")


@pytest.fixture
def other(client: TestClient, identity: FakeIdentityProviders) -> dict[str, str]:
    """A second, unrelated user."""
    return new_user(client, identity, "user-2")
