from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect

from app.config import ConfigError, load_settings
from app.logs import JsonFormatter, request_id, scrub
from app.models import Base
from app.rate_limit import RateLimiter

from .conftest import Outbound, make_client

BACKEND = Path(__file__).resolve().parents[1]
PRODUCTION = {
    "APP_ENV": "production",
    "DATABASE_URL": "postgres://u:p@db:5432/stubwise",
    "AUTH_JWT_SECRET": "s" * 40,
    "GOOGLE_CLIENT_IDS": "a.apps.googleusercontent.com, b.apps.googleusercontent.com",
}


def test_health_ready_and_meta(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok", "version": "0.2.0"}
    assert client.get("/ready").json() == {"status": "ready"}
    meta = client.get("/v1/meta").json()
    assert [template["id"] for template in meta["templates"]] == ["classic", "modern", "compact", "ledger"]
    assert meta["minAppVersion"] == "1.0.0"
    assert meta["signIn"] == {"google": True, "apple": True, "password": False}
    assert meta["filing"]["available"] is False


def test_ready_reports_a_database_that_does_not_answer(client: TestClient) -> None:
    client.app.state.sessions.kw["bind"].dispose()
    Base.metadata.drop_all(client.app.state.sessions.kw["bind"])
    assert client.get("/health").status_code == 200  # liveness does not depend on the database
    assert client.get("/ready").status_code == 200  # SELECT 1 still works on an empty database
    broken = create_engine("sqlite:////nonexistent-dir/x.db")
    client.app.state.sessions.configure(bind=broken)
    response = client.get("/ready")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "not_ready"


def test_errors_share_one_shape(client: TestClient, auth: dict[str, str]) -> None:
    assert client.get("/nope").json() == {"error": {"code": "not_found", "message": "No such endpoint."}}
    assert client.post("/health").json()["error"]["code"] == "method_not_allowed"
    bad = client.put("/v1/backup", headers={**auth, "content-type": "application/json"}, content="{not json")
    assert bad.status_code == 400
    assert bad.json() == {"error": {"code": "bad_request", "message": "The request body is not valid JSON."}}
    invalid = client.post("/v1/business", headers=auth, json={"name": "x", "paySchedule": "daily", "state": "ZZ"})
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "invalid_request"
    assert {detail["path"] for detail in invalid.json()["error"]["details"]} == {"paySchedule", "state"}
    assert "ZZ" not in invalid.text  # what was sent is never echoed back
    query = client.get("/v1/workers", headers=auth, params={"limit": "many"})
    assert query.json()["error"]["details"][0]["path"] == "query.limit"


def test_stub_rendering_and_old_device_routes_are_gone(client: TestClient, auth: dict[str, str]) -> None:
    for method, path in (("POST", "/v1/stubs/render"), ("POST", "/v1/devices"), ("POST", "/v1/stubs/compute")):
        assert client.request(method, path, headers=auth, json={}).status_code in (404, 405)


def test_an_unexpected_failure_is_a_500_with_no_detail(
    client: TestClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from app.services import records

    number = "-".join(["412", "55", "7890"])  # built at run time, so it is data and not source code

    def explode(*_args: object) -> None:
        raise RuntimeError(f"no business for {number}")

    monkeypatch.setattr(records, "get_business", explode)
    response = client.get("/v1/business", headers=auth)
    assert response.status_code == 500
    assert response.json() == {"error": {"code": "internal_error", "message": "Something went wrong on our side."}}
    assert response.headers["x-request-id"]
    assert "unhandled RuntimeError" in caplog.text
    # The traceback shows where it failed, not the values involved.
    assert "explode" in caplog.text
    assert number not in caplog.text


def test_oversized_bodies_are_refused(client: TestClient, auth: dict[str, str]) -> None:
    def chunks(size: int):
        yield b" " * size

    for path, limit in (("/v1/workers", 256 * 1024), ("/v1/business", 1024 * 1024), ("/v1/backup", 8 * 1024 * 1024)):
        method = "PUT" if path == "/v1/backup" else "POST"
        declared = client.request(method, path, headers=auth, content=b" " * (limit + 1))
        assert declared.status_code == 413, path
        assert declared.json()["error"]["code"] == "body_too_large"
        # No Content-Length to check up front: the body is counted as it arrives.
        streamed = client.request(method, path, headers=auth, content=chunks(limit + 1))
        assert streamed.status_code == 413, path
        assert streamed.json()["error"]["code"] == "body_too_large"
        assert client.request(method, path, headers=auth, content=b" " * 1000).status_code == 400


def test_requests_are_rate_limited_per_client(outbound: Outbound) -> None:
    with make_client(outbound, rate_limit_per_minute=3) as client:
        assert [client.get("/health").status_code for _ in range(4)] == [200, 200, 200, 429]
        assert client.get("/health").json()["error"]["code"] == "rate_limited"


def test_rate_limiter_window_resets() -> None:
    now = [0.0]
    limiter = RateLimiter(2, window_seconds=60, clock=lambda: now[0])
    assert [limiter.allow("a"), limiter.allow("a"), limiter.allow("a")] == [True, True, False]
    assert limiter.allow("b")
    now[0] = 60.0
    assert limiter.allow("a")


def test_security_headers_and_request_ids(client: TestClient, outbound: Outbound) -> None:
    response = client.get("/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["cache-control"] == "no-store"
    assert "strict-transport-security" not in response.headers
    assert len(response.headers["x-request-id"]) == 32
    assert (
        client.get("/health", headers={"x-request-id": "trace-abc-12345"}).headers["x-request-id"] == "trace-abc-12345"
    )
    # A value that could break a log line or a header is replaced, not echoed.
    assert client.get("/health", headers={"x-request-id": "a b"}).headers["x-request-id"] != "a b"
    assert client.get("/nope").headers["x-content-type-options"] == "nosniff"
    with make_client(outbound, app_env="production") as live:
        assert "max-age=31536000" in live.get("/health").headers["strict-transport-security"]


def test_cors_is_off_unless_origins_are_listed(client: TestClient, outbound: Outbound) -> None:
    preflight = {"origin": "https://app.example.com", "access-control-request-method": "GET"}
    assert "access-control-allow-origin" not in client.options("/v1/me", headers=preflight).headers
    assert "access-control-allow-origin" not in client.get("/health", headers={"origin": "https://x.example"}).headers
    with make_client(outbound, cors_allowed_origins=("https://app.example.com",)) as open_client:
        allowed = open_client.options("/v1/me", headers=preflight)
        assert allowed.headers["access-control-allow-origin"] == "https://app.example.com"
        stranger = open_client.options("/v1/me", headers={**preflight, "origin": "https://evil.example"})
        assert "access-control-allow-origin" not in stranger.headers


def test_openapi_documents_the_api(client: TestClient, outbound: Outbound) -> None:
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "CrewStub API"
    tags = {tag for path in schema["paths"].values() for operation in path.values() for tag in operation["tags"]}
    assert {"Sign-in and sessions", "Account", "Business", "Workers", "Stubs", "Calculations", "Service"} <= tags
    assert not any("filing" in tag.lower() for tag in tags)
    components = schema["components"]["schemas"]
    for model in ("WorkerCreate", "BusinessCreate", "LinesReplace", "CalcTaxesRequest", "AppleSignIn", "ErrorResponse"):
        assert components[model]["examples"], model
    stub = schema["paths"]["/v1/stubs/{stub_id}"]["get"]
    assert stub["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/StubOut")
    assert "401" in stub["responses"]
    # Off in production unless asked for.
    with make_client(outbound, docs_enabled=False) as closed:
        assert closed.get("/docs").status_code == 404
        assert closed.get("/openapi.json").status_code == 404


# ---- Configuration ------------------------------------------------------------


def test_production_settings_are_validated_at_startup() -> None:
    loaded = load_settings(PRODUCTION)
    assert loaded.database_url == "postgresql+psycopg://u:p@db:5432/stubwise"
    assert loaded.google_client_ids == ("a.apps.googleusercontent.com", "b.apps.googleusercontent.com")
    assert loaded.apple_client_ids == ()
    assert loaded.docs_enabled is False
    assert loaded.cors_allowed_origins == ()
    assert (loaded.port, loaded.refresh_token_days) == (4000, 60)
    assert "s" * 40 not in repr(loaded)

    for missing in ("DATABASE_URL", "AUTH_JWT_SECRET", "GOOGLE_CLIENT_IDS"):
        with pytest.raises(ConfigError, match=missing):
            load_settings({key: value for key, value in PRODUCTION.items() if key != missing})
    for name, value in (
        ("AUTH_JWT_SECRET", "short"),
        ("PORT", "http"),
        ("PORT", "70000"),
        ("LOG_LEVEL", "loud"),
        ("APP_ENV", "staging"),
        ("CORS_ALLOWED_ORIGINS", "*"),
        ("DOCS_ENABLED", "maybe"),
        ("TAXBANDITS_ENV", "live"),
    ):
        with pytest.raises(ConfigError, match=name):
            load_settings({**PRODUCTION, name: value})


def test_development_needs_no_configuration() -> None:
    loaded = load_settings({})
    assert loaded.app_env == "development"
    assert loaded.database_url.startswith("sqlite")
    assert len(loaded.auth_jwt_secret) >= 32
    assert loaded.auth_jwt_secret != load_settings({}).auth_jwt_secret
    assert loaded.docs_enabled is True


def test_filing_is_parked_unless_switched_on_with_credentials() -> None:
    credentials = {"TAXBANDITS_CLIENT_ID": "id", "TAXBANDITS_CLIENT_SECRET": "secret", "TAXBANDITS_USER_TOKEN": "token"}
    assert load_settings({}).filing_active is False
    assert load_settings(credentials).filing_active is False  # credentials alone do not turn it on
    assert load_settings({**credentials, "FILING_ENABLED": "true"}).filing_active is True
    with pytest.raises(ConfigError, match="FILING_ENABLED"):
        load_settings({"FILING_ENABLED": "true"})
    with pytest.raises(ConfigError, match="FILING_ENABLED"):
        load_settings({"FILING_ENABLED": "true", "TAXBANDITS_CLIENT_ID": "id"})
    assert "secret" not in repr(load_settings(credentials))


# ---- Logs ---------------------------------------------------------------------


def test_logs_are_json_with_the_request_id_and_redacted() -> None:
    token = request_id.set("req-12345678")
    try:
        record = logging.getLogger("test").makeRecord(
            "test",
            logging.WARNING,
            __file__,
            1,
            "sign-in failed for %s with %s",
            ("renee@example.com", "Bearer abcdefghijklmnop"),
            None,
            extra={"user_id": "3f2c9d1e-0000-4a6b-9c1d-1234567890ab", "ssn": "412-55-7890"},
        )
        entry = json.loads(JsonFormatter().format(record))
    finally:
        request_id.reset(token)
    assert entry["level"] == "warning"
    assert entry["request_id"] == "req-12345678"
    assert entry["msg"] == "sign-in failed for [redacted] with [redacted]"
    assert entry["ssn"] == "[redacted]"
    assert entry["user_id"] == "3f2c9d1e-0000-4a6b-9c1d-1234567890ab"  # ids are not mistaken for numbers
    assert entry["ts"].startswith("20")


def test_scrub_removes_secrets_and_leaves_other_text() -> None:
    jwt_like = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl"
    assert scrub(f"token {jwt_like} for a@b.co, SSN 412-55-7890, EIN 62-1847305, bare 412557890.") == (
        "token [redacted] for [redacted], SSN [redacted], EIN [redacted], bare [redacted]."
    )
    untouched = "stub 9ee90c549ab123456789e2df took 1234567890 ns on 2026-11-22, $52,416.57, 18001745 cents"
    assert scrub(untouched) == untouched


def test_requests_are_logged_once_with_who_and_how_long(
    client: TestClient, auth: dict[str, str], caplog: pytest.LogCaptureFixture
) -> None:
    caplog.clear()
    response = client.get("/v1/me", headers=auth)
    (entry,) = [record for record in caplog.records if record.name == "stubwise.request"]
    assert (entry.method, entry.path, entry.status) == ("GET", "/v1/me", 200)
    assert entry.user_id == response.json()["id"]
    assert entry.duration_ms >= 0
    # Neither the access token nor the email address appears in any log line.
    assert auth["authorization"].split()[1] not in caplog.text
    assert response.json()["email"] not in caplog.text


# ---- Migrations ---------------------------------------------------------------


def test_migrations_build_exactly_the_schema_the_models_describe(tmp_path: Path) -> None:
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "head")

    engine = create_engine(url)
    with engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert differences == [], "models changed without a migration: run `alembic revision --autogenerate`"
    tables = set(inspect(engine).get_table_names())
    assert set(Base.metadata.tables) <= tables

    command.downgrade(config, "base")
    assert set(inspect(engine).get_table_names()) == {"alembic_version"}


# ---- Deploy -------------------------------------------------------------------


def test_migrate_command_applies_migrations_and_reports_an_unreachable_database(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    from app import migrate

    url = f"sqlite:///{tmp_path / 'deploy.db'}"
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DATABASE_URL", url)
    assert migrate.main() == 0
    assert migrate.main() == 0  # running it again on an up-to-date database is harmless
    assert set(Base.metadata.tables) <= set(inspect(create_engine(url)).get_table_names())

    # The URL form a hosting platform hands out, pointing at nothing.
    monkeypatch.setenv("DATABASE_URL", "postgresql://stubwise:sekret-pw@127.0.0.1:1/stubwise")
    monkeypatch.setenv("DB_WAIT_SECONDS", "0")
    assert migrate.main() == 1
    assert "database unreachable at postgresql+psycopg://stubwise:***@127.0.0.1:1/stubwise" in caplog.text
    assert "sekret-pw" not in caplog.text

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("DATABASE_URL")
    assert migrate.main() == 2
    assert "DATABASE_URL is required in production" in capsys.readouterr().err


def test_the_image_contains_what_the_server_needs() -> None:
    """Guards the deploy files against the mistakes that only show up on the server."""
    dockerfile = (BACKEND / "Dockerfile").read_text()
    assert "USER stubwise" in dockerfile
    assert "EXPOSE 4000" in dockerfile
    # Tax data is loaded at start-up from inside the app package, which the image copies whole.
    from app.domain.tax.data import TAX_DATA_PATH

    assert TAX_DATA_PATH.is_relative_to(BACKEND / "app")
    assert "COPY app ./app" in dockerfile
    assert "COPY migrations ./migrations" in dockerfile
    ignored = (BACKEND / ".dockerignore").read_text().split()
    assert not any(entry.startswith(("app", "migrations", "uv.lock", "alembic.ini")) for entry in ignored)
    entrypoint = (BACKEND / "docker-entrypoint.sh").read_text()
    assert entrypoint.index("upgrade head") < entrypoint.index("exec uvicorn")  # migrate, then serve
    assert "${HOST:-0.0.0.0}" in entrypoint
    assert "${PORT:-4000}" in entrypoint
