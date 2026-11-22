"""Alembic environment. The schema is app.models; the database is whatever DATABASE_URL names."""

from __future__ import annotations

from alembic import context

from app.config import load_settings
from app.db import make_engine
from app.models import Base

target_metadata = Base.metadata


def run_migrations() -> None:
    # Tests and scripts may hand in a live connection; otherwise connect from settings.
    connection = context.config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return
    url = context.config.get_main_option("sqlalchemy.url") or load_settings().database_url
    engine = make_engine(url)
    with engine.connect() as fresh:
        _run(fresh)
        fresh.commit()
    engine.dispose()


def _run(connection) -> None:
    # render_as_batch lets SQLite (development, tests) apply ALTERs that it cannot do in place.
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    raise SystemExit("Offline (--sql) migrations are not set up; run against a database.")
run_migrations()
