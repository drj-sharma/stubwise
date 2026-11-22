"""Configuration, read and validated once from the environment at start-up.

A bad or missing value stops the process with a message naming the variable,
before the server accepts a single request.
"""

from __future__ import annotations

import os
import secrets
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

API_VERSION = "0.2.0"
MIN_APP_VERSION = "1.0.0"

ACCESS_TOKEN_SECONDS = 15 * 60
DEFAULT_DATABASE_URL = "sqlite:///./stubwise.db"

TaxBanditsEnv = Literal["sandbox", "production"]

_LOG_LEVELS = {"critical", "error", "warning", "info", "debug"}
_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"", "0", "false", "no", "off"}


class ConfigError(Exception):
    """A bad or missing setting."""


@dataclass(frozen=True, slots=True)
class TaxBanditsCredentials:
    client_id: str = ""
    client_secret: str = ""
    user_token: str = ""
    env: TaxBanditsEnv = "sandbox"

    def __repr__(self) -> str:
        # Hand-written so a logged Settings object cannot leak the secrets.
        return f"TaxBanditsCredentials(env={self.env!r}, configured={self.configured})"

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.user_token)


@dataclass(frozen=True, slots=True)
class Settings:
    app_env: Literal["development", "test", "production"] = "development"
    host: str = "127.0.0.1"
    port: int = 4000
    log_level: str = "info"
    database_url: str = DEFAULT_DATABASE_URL
    # Signs our own access tokens. Never logged.
    auth_jwt_secret: str = field(default="", repr=False)
    refresh_token_days: int = 60
    # OAuth client IDs whose ID tokens we accept (the token's `aud`).
    google_client_ids: tuple[str, ...] = ()
    # Bundle IDs (native apps) and Services IDs (web) accepted as an Apple token's `aud`.
    apple_client_ids: tuple[str, ...] = ()
    cors_allowed_origins: tuple[str, ...] = ()
    docs_enabled: bool = True
    rate_limit_per_minute: int = 300
    auth_rate_limit_per_minute: int = 20
    write_rate_limit_per_minute: int = 120
    filing_rate_limit_per_minute: int = 10
    filing_enabled: bool = False
    taxbandits: TaxBanditsCredentials = TaxBanditsCredentials()

    @property
    def filing_active(self) -> bool:
        """Filing is parked: it needs the switch AND working credentials."""
        return self.filing_enabled and self.taxbandits.configured


def _int(env: Mapping[str, str], name: str, default: int, minimum: int, maximum: int) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a whole number") from exc
    if not minimum <= value <= maximum:
        raise ConfigError(f"{name} must be between {minimum} and {maximum}")
    return value


def _bool(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name, "").strip().lower()
    if name not in env or raw == "":
        return default
    if raw in _TRUE:
        return True
    if raw in _FALSE:
        return False
    raise ConfigError(f"{name} must be true or false")


def _list(env: Mapping[str, str], name: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in env.get(name, "").split(",") if item.strip())


def _database_url(raw: str) -> str:
    # Hosting providers hand out postgres:// URLs; SQLAlchemy needs the driver named.
    for prefix in ("postgres://", "postgresql://"):
        if raw.startswith(prefix):
            return "postgresql+psycopg://" + raw[len(prefix) :]
    return raw


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env

    app_env = env.get("APP_ENV", "").strip() or "development"
    if app_env not in ("development", "test", "production"):
        raise ConfigError("APP_ENV must be development, test or production")
    production = app_env == "production"

    log_level = (env.get("LOG_LEVEL", "").strip() or "info").lower()
    if log_level not in _LOG_LEVELS:
        raise ConfigError(f"LOG_LEVEL must be one of {', '.join(sorted(_LOG_LEVELS))}")

    database_url = env.get("DATABASE_URL", "").strip()
    if not database_url:
        if production:
            raise ConfigError("DATABASE_URL is required in production")
        database_url = DEFAULT_DATABASE_URL

    jwt_secret = env.get("AUTH_JWT_SECRET", "").strip()
    if not jwt_secret:
        if production:
            raise ConfigError("AUTH_JWT_SECRET is required in production")
        # Development convenience: a fresh secret per process, so access tokens
        # (not refresh tokens) stop working when the server restarts.
        jwt_secret = secrets.token_urlsafe(48)
    elif len(jwt_secret) < 32:
        raise ConfigError("AUTH_JWT_SECRET must be at least 32 characters")

    google_client_ids = _list(env, "GOOGLE_CLIENT_IDS")
    apple_client_ids = _list(env, "APPLE_CLIENT_IDS")
    if production and not (google_client_ids or apple_client_ids):
        raise ConfigError("Set GOOGLE_CLIENT_IDS and/or APPLE_CLIENT_IDS: without one nobody can sign in")

    origins = _list(env, "CORS_ALLOWED_ORIGINS")
    if "*" in origins:
        raise ConfigError("CORS_ALLOWED_ORIGINS must list exact origins, not *")

    tb_env = env.get("TAXBANDITS_ENV", "").strip().lower() or "sandbox"
    if tb_env not in ("sandbox", "production"):
        raise ConfigError("TAXBANDITS_ENV must be sandbox or production")
    taxbandits = TaxBanditsCredentials(
        client_id=env.get("TAXBANDITS_CLIENT_ID", "").strip(),
        client_secret=env.get("TAXBANDITS_CLIENT_SECRET", "").strip(),
        user_token=env.get("TAXBANDITS_USER_TOKEN", "").strip(),
        env=tb_env,  # type: ignore[arg-type]
    )
    filing_enabled = _bool(env, "FILING_ENABLED", False)
    if filing_enabled and not taxbandits.configured:
        raise ConfigError("FILING_ENABLED=true needs TAXBANDITS_CLIENT_ID, _CLIENT_SECRET and _USER_TOKEN")

    return Settings(
        app_env=app_env,  # type: ignore[arg-type]
        host=env.get("HOST", "").strip() or "127.0.0.1",
        port=_int(env, "PORT", 4000, 1, 65535),
        log_level=log_level,
        database_url=_database_url(database_url),
        auth_jwt_secret=jwt_secret,
        refresh_token_days=_int(env, "REFRESH_TOKEN_DAYS", 60, 1, 365),
        google_client_ids=google_client_ids,
        apple_client_ids=apple_client_ids,
        cors_allowed_origins=origins,
        docs_enabled=_bool(env, "DOCS_ENABLED", not production),
        rate_limit_per_minute=_int(env, "RATE_LIMIT_PER_MINUTE", 300, 1, 1_000_000),
        auth_rate_limit_per_minute=_int(env, "AUTH_RATE_LIMIT_PER_MINUTE", 20, 1, 1_000_000),
        write_rate_limit_per_minute=_int(env, "WRITE_RATE_LIMIT_PER_MINUTE", 120, 1, 1_000_000),
        filing_rate_limit_per_minute=_int(env, "FILING_RATE_LIMIT_PER_MINUTE", 10, 1, 1_000_000),
        filing_enabled=filing_enabled,
        taxbandits=taxbandits,
    )
