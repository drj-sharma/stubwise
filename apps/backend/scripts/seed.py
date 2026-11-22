"""Fills a development database with a sample account, business, workers and stubs.

    uv run alembic upgrade head
    uv run python scripts/seed.py

There is no way to sign in without Google or Apple, so the script also opens a
session for the sample account and prints its refresh token; exchange it at
POST /v1/auth/refresh for an access token. Refuses to run in production.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.auth import sessions
from app.config import load_settings
from app.db import make_engine
from app.models import User
from app.schemas import BusinessCreate, WorkerCreate
from app.services import records, stubs

WORKERS = [
    {"name": "Marcus Bell", "type": "employee", "payType": "hourly", "rateCents": 2400,
     "defaultDeductions": [{"label": "Health insurance", "amountCents": 8500}]},
    {"name": "Dana Reyes", "type": "employee", "payType": "salary", "rateCents": 240000},
    {"name": "Tyrone Whitaker", "type": "contractor", "payType": "hourly", "rateCents": 3200},
]  # fmt: skip
HOURS = [
    {"kind": "earning", "label": "Regular", "minutes": 4800, "rateCents": 2400, "amountCents": 0, "source": "manual"},
    {"kind": "deduction", "label": "Health insurance", "minutes": None, "rateCents": None, "amountCents": 8500,
     "source": "manual"},
]  # fmt: skip


def main() -> int:
    settings = load_settings()
    if settings.app_env == "production":
        print("Refusing to seed a production database.", file=sys.stderr)
        return 1
    engine = make_engine(settings.database_url)
    with sessionmaker(engine, expire_on_commit=False)() as db:
        user = db.scalar(select(User).where(User.provider == "dev", User.provider_subject == "seed"))
        if user is None:
            user = User(provider="dev", provider_subject="seed", email=None, name="Sample Owner")
            db.add(user)
            db.commit()
            business = records.create_business(
                db,
                user.id,
                user.plan,
                BusinessCreate(
                    name="Ridgeline Auto Repair", state="PA", paySchedule="biweekly", phone="(412) 555-0142"
                ),
            )
            for index, fields in enumerate(WORKERS):
                worker = records.create_worker(db, user.id, user.plan, WorkerCreate(**fields))
                stub = stubs.create_next(db, business, worker, "2026-11-18")
                if index == 0:
                    stubs.replace_lines(db, business, worker, stub, HOURS)
                    stubs.create_next(db, business, worker, "2026-11-18")
            print("Created the sample account with 3 workers and 4 stubs.")
        else:
            print("The sample account already exists; opening another session for it.")
        tokens = sessions.start_session(db, settings, user, "seed script")
    engine.dispose()
    print(f"\nRefresh token (single use):\n  {tokens['refreshToken']}\n")
    print("Get an access token from the running server with:")
    print(f"  curl -s -X POST http://{settings.host}:{settings.port}/v1/auth/refresh \\")
    print("    -H 'content-type: application/json' \\")
    print(f"""    -d '{{"refreshToken": "{tokens["refreshToken"]}"}}'""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
