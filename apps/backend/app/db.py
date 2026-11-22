"""Engine and session set-up. The schema itself is managed by Alembic (see migrations/)."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool


def make_engine(database_url: str) -> Engine:
    if database_url.startswith("sqlite"):
        options: dict = {"connect_args": {"check_same_thread": False}}
        if ":memory:" in database_url or database_url in ("sqlite://", "sqlite:///"):
            # One shared connection, or every request would see its own empty database.
            options["poolclass"] = StaticPool
        engine = create_engine(database_url, **options)

        @event.listens_for(engine, "connect")
        def _enforce_foreign_keys(dbapi_connection, _record) -> None:
            # SQLite ignores ON DELETE CASCADE unless asked on every connection.
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return engine
    return create_engine(database_url, pool_pre_ping=True)


def get_session(request: Request) -> Iterator[Session]:
    """One session per request; commits happen explicitly in the service code."""
    session: Session = request.app.state.sessions()
    try:
        yield session
    finally:
        session.close()
