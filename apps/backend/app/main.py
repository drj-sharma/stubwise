"""Application factory.

Run with:  uv run uvicorn --factory app.main:create_app
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import sessionmaker

from .auth.providers import IdentityVerifier
from .config import API_VERSION, Settings, load_settings
from .db import make_engine
from .errors import ErrorResponse, install_error_handlers
from .logs import configure_logging
from .middleware import BodyLimitMiddleware, install_request_middleware
from .rate_limit import RateLimiter
from .routes import auth, calc, filing, orders, records, reports, system
from .tax_rules.store import RULES
from .tax_rules.store import seed as seed_tax_rules
from .taxbandits import TaxBanditsClient

log = logging.getLogger(__name__)

DESCRIPTION = """
The CrewStub API: accounts, a small business's workers and pay stubs, and the
pay calculations behind them.

Money is integer cents, worked time is whole minutes, dates are `YYYY-MM-DD`.
Every error is `{"error": {"code", "message", "details"?}}`.
Sign in with `/v1/auth/google` or `/v1/auth/apple`, then send
`Authorization: Bearer <accessToken>`.
"""


def create_app(settings: Settings | None = None, *, outbound_transport: httpx.BaseTransport | None = None) -> FastAPI:
    """Builds the app without starting it, so tests can drive it in-process.

    ``outbound_transport`` replaces the network for every call the server makes
    (provider signing keys, TaxBandits); tests pass a mock.
    """
    settings = settings or load_settings()
    configure_logging(settings.log_level)

    engine = make_engine(settings.database_url)
    http = httpx.Client(timeout=10.0, transport=outbound_transport)
    taxbandits = None
    if settings.filing_active:
        taxbandits = TaxBanditsClient(settings.taxbandits, transport=outbound_transport)
        log.info("tax form filing enabled against the TaxBandits %s environment", taxbandits.environment)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # The tax rules the calculations read: seed files written to the database, then cached.
        with app.state.sessions() as db:
            seed_tax_rules(db)
            RULES.refresh(db, force=True)
        yield
        http.close()
        if taxbandits is not None:
            taxbandits.close()
        engine.dispose()

    docs = settings.docs_enabled
    app = FastAPI(
        title="CrewStub API",
        version=API_VERSION,
        description=DESCRIPTION,
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
        responses={
            401: {"model": ErrorResponse, "description": "Missing, expired or revoked access token."},
            400: {"model": ErrorResponse, "description": "The request is malformed or fails validation."},
            429: {"model": ErrorResponse, "description": "Rate limited."},
        },
    )
    app.state.settings = settings
    app.state.sessions = sessionmaker(engine, expire_on_commit=False)
    app.state.identity = IdentityVerifier(
        google_client_ids=settings.google_client_ids, apple_client_ids=settings.apple_client_ids, http=http
    )
    app.state.taxbandits = taxbandits
    app.state.auth_limiter = RateLimiter(settings.auth_rate_limit_per_minute)
    app.state.write_limiter = RateLimiter(settings.write_rate_limit_per_minute)
    app.state.filing_limiter = RateLimiter(settings.filing_rate_limit_per_minute)

    install_request_middleware(
        app, limiter=RateLimiter(settings.rate_limit_per_minute), production=settings.app_env == "production"
    )
    app.add_middleware(BodyLimitMiddleware)
    if settings.cors_allowed_origins:
        # Off unless origins are listed: the mobile app is not a browser and needs none.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_allowed_origins),
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "If-Match", "X-Request-ID"],
            expose_headers=["X-Request-ID", "Idempotency-Replayed"],
        )

    install_error_handlers(app)
    for router in (
        system.router,
        auth.router,
        auth.me_router,
        records.business_router,
        records.workers_router,
        records.stubs_router,
        records.backup_router,
        calc.router,
        reports.router,
        orders.router,
    ):
        app.include_router(router)
    if settings.password_login_enabled:
        # Off by default: without the switch these routes do not exist (404).
        app.include_router(auth.password_router)
    if settings.filing_active:
        # Parked feature: without the switch and credentials these routes do not exist (404).
        app.include_router(filing.router)
    return app
