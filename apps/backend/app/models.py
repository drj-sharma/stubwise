"""Database tables.

Every row that belongs to a person carries ``user_id`` and is only ever read
or written through a query filtered by it (see services/). Deleting a user
removes all of it through ON DELETE CASCADE.

Filing tables cannot hold a full SSN, EIN or TIN: they keep the last four
digits and TaxBandits' identifiers only. Keep it that way when adding columns.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid.uuid4())


def as_utc(value: datetime) -> datetime:
    """SQLite hands timestamps back without a zone; they are always stored as UTC."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def iso_z(value: datetime) -> str:
    """'2026-11-26T10:00:00.000Z', the form the app uses."""
    return as_utc(value).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Base(DeclarativeBase):
    pass


Timestamp = DateTime(timezone=True)


def _owner() -> Mapped[str]:
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


# ---- Accounts ---------------------------------------------------------------


class User(Base):
    __tablename__ = "users"
    # One account per provider identity. Accounts are not merged by email: see README, "Accounts".
    __table_args__ = (UniqueConstraint("provider", "provider_subject"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    provider: Mapped[str] = mapped_column(String(10))
    provider_subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(120), default="")
    plan: Mapped[str] = mapped_column(String(20), default="free")
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow, onupdate=utcnow)


class PasswordCredential(Base):
    """The password of an account with provider ``password``: a self-describing scrypt hash, never the password."""

    __tablename__ = "password_credentials"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow, onupdate=utcnow)


class AuthSession(Base):
    """One signed-in device. Its refresh tokens form a family: reuse of a spent one revokes it."""

    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = _owner()
    user_agent: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    last_used_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(Timestamp)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("auth_sessions.id", ondelete="CASCADE"), index=True)
    # SHA-256 of the token; the token itself is shown to the client once and never stored.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(Timestamp)
    used_at: Mapped[datetime | None] = mapped_column(Timestamp)


class AuditLog(Base):
    """Security-relevant events. ``user_id`` is deliberately not a foreign key:
    the record that an account was deleted must outlive the account."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    event: Mapped[str] = mapped_column(String(60))
    request_id: Mapped[str | None] = mapped_column(String(64))
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    # Null while the first request is still running.
    status_code: Mapped[int | None] = mapped_column(Integer)
    response: Mapped[Any | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


# ---- Records ----------------------------------------------------------------


class Business(Base):
    """One per user for now (enforced in services/records.py, not here, so more can be allowed later)."""

    __tablename__ = "businesses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = _owner()
    name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str] = mapped_column(String(240), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    state: Mapped[str | None] = mapped_column(String(2))
    employer_id: Mapped[str | None] = mapped_column(String(20))
    logo_data_uri: Mapped[str | None] = mapped_column(Text)
    pay_schedule: Mapped[str] = mapped_column(String(12))
    show_employer_id: Mapped[bool] = mapped_column(Boolean, default=True)
    template_id: Mapped[str] = mapped_column(String(20), default="classic")
    accent: Mapped[str] = mapped_column(String(7), default="#3F3D9E")
    overtime_pct: Mapped[int] = mapped_column(Integer, default=150)
    appearance: Mapped[str] = mapped_column(String(10), default="light")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class Worker(Base):
    __tablename__ = "workers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = _owner()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str] = mapped_column(String(240), default="")
    type: Mapped[str] = mapped_column(String(10))
    pay_type: Mapped[str] = mapped_column(String(6))
    rate_cents: Mapped[int] = mapped_column(BigInteger)
    default_deductions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    starting_ytd: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    tax_profile: Mapped[dict[str, Any]] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class Stub(Base):
    __tablename__ = "stubs"
    __table_args__ = (Index("stubs_worker_pay_date", "worker_id", "pay_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = _owner()
    worker_id: Mapped[str] = mapped_column(ForeignKey("workers.id", ondelete="CASCADE"))
    # Dates are 'YYYY-MM-DD' text, as everywhere in the app: no zone, sorts correctly.
    period_start: Mapped[str] = mapped_column(String(10))
    period_end: Mapped[str] = mapped_column(String(10))
    pay_date: Mapped[str] = mapped_column(String(10))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)

    lines: Mapped[list[StubLine]] = relationship(
        order_by="StubLine.position", cascade="all, delete-orphan", passive_deletes=True, lazy="selectin"
    )


class StubLine(Base):
    __tablename__ = "stub_lines"
    __table_args__ = (UniqueConstraint("stub_id", "position"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    stub_id: Mapped[str] = mapped_column(ForeignKey("stubs.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))
    label: Mapped[str] = mapped_column(String(60))
    minutes: Mapped[int | None] = mapped_column(Integer)
    rate_cents: Mapped[int | None] = mapped_column(BigInteger)
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    source: Mapped[str] = mapped_column(String(10))
    tax_code: Mapped[str | None] = mapped_column(String(20))


# ---- Filing (parked; see README) ----------------------------------------------


class FilingConsent(Base):
    __tablename__ = "filing_consents"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    consent_version: Mapped[str] = mapped_column(String(40))
    consented_at: Mapped[datetime] = mapped_column(Timestamp)


class Filing(Base):
    __tablename__ = "filings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = _owner()
    form_type: Mapped[str] = mapped_column(String(10))
    tax_year: Mapped[int] = mapped_column(Integer)
    employer_name: Mapped[str] = mapped_column(String(75))
    employer_ein_last4: Mapped[str] = mapped_column(String(4))
    tb_submission_id: Mapped[str] = mapped_column(String(64))
    tb_business_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(Timestamp)
    # Set before the transmit call is made; transmitted_at only once TaxBandits confirms it.
    transmit_requested_at: Mapped[datetime | None] = mapped_column(Timestamp)
    transmitted_at: Mapped[datetime | None] = mapped_column(Timestamp)
    status_checked_at: Mapped[datetime | None] = mapped_column(Timestamp)

    recipients: Mapped[list[FilingRecipient]] = relationship(
        back_populates="filing",
        order_by="FilingRecipient.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )


class FilingRecipient(Base):
    __tablename__ = "filing_recipients"
    __table_args__ = (UniqueConstraint("filing_id", "position"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filing_id: Mapped[str] = mapped_column(ForeignKey("filings.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    ref: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(80))
    tin_type: Mapped[str] = mapped_column(String(4))
    tin_last4: Mapped[str] = mapped_column(String(4))
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    tb_record_id: Mapped[str] = mapped_column(String(64))
    tb_recipient_id: Mapped[str | None] = mapped_column(String(64))
    federal_status: Mapped[str] = mapped_column(String(40))
    status_message: Mapped[str | None] = mapped_column(String(500))

    filing: Mapped[Filing] = relationship(back_populates="recipients")
