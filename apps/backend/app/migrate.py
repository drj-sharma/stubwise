"""Applies database migrations, then exits. Run before the server starts:

    python -m app.migrate

Waits a short while for the database (it may still be starting when the
container does), takes a lock so two instances starting together do not
migrate at once, and exits non-zero with one clear log line when the database
cannot be reached or a migration fails.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from .config import ConfigError, load_settings
from .db import make_engine
from .logs import configure_logging

log = logging.getLogger("stubwise.migrate")

ROOT = Path(__file__).resolve().parents[1]
# An arbitrary constant that identifies "Stubwise schema migration" among Postgres advisory locks.
_LOCK_ID = 7_283_649_101


def _wait_for_database(engine: Engine, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return
        except SQLAlchemyError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)


def main() -> int:
    try:
        settings = load_settings()
    except ConfigError as error:
        # Printed plainly as well: a misconfigured deploy should say why in the first line of its log.
        print(f"Invalid configuration: {error}", file=sys.stderr)
        return 2
    configure_logging(settings.log_level)
    engine = make_engine(settings.database_url)
    where = engine.url.render_as_string(hide_password=True)

    try:
        _wait_for_database(engine, float(os.environ.get("DB_WAIT_SECONDS", "30")))
    except SQLAlchemyError as error:
        log.error("database unreachable at %s (%s); not starting", where, type(error).__name__)
        return 1

    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    try:
        with engine.connect() as connection:
            postgres = engine.dialect.name == "postgresql"
            if postgres:
                # Held for this session only, so it is released even if the process dies mid-migration.
                connection.execute(text("SELECT pg_advisory_lock(:id)"), {"id": _LOCK_ID})
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            connection.commit()
            if postgres:
                connection.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": _LOCK_ID})
                connection.commit()
    except Exception as error:
        log.error("migration failed (%s); not starting", type(error).__name__, exc_info=True)
        return 1
    finally:
        engine.dispose()
    log.info("database schema is up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
