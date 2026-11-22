"""Signing in, the account itself, export and deletion."""

from __future__ import annotations

from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import passwords
from ..auth.providers import VerifiedIdentity
from ..auth.sessions import Principal, list_sessions, user_json
from ..errors import ApiError
from ..filing import serialize as filing_json
from ..models import Filing, PasswordCredential, User, iso_z, utcnow
from . import audit, backup

PASSWORD = "password"  # noqa: S105 - the provider name, not a secret
_WRONG = "Email or password is incorrect."


def sign_in(db: Session, identity: VerifiedIdentity, *, fallback_name: str | None) -> User:
    """Finds the account for a verified provider identity, creating it on first sign-in.

    Accounts are keyed by (provider, subject) and never matched by email
    address: see README, "Accounts", for why.
    """
    user = db.scalar(select(User).where(User.provider == identity.provider, User.provider_subject == identity.subject))
    if user is None:
        user = User(
            provider=identity.provider,
            provider_subject=identity.subject,
            email=identity.email,
            name=(identity.name or fallback_name or "")[:120],
        )
        db.add(user)
        db.flush()
        audit.record(db, user.id, "auth.sign_up", {"provider": identity.provider})
    else:
        if identity.email and identity.email != user.email:
            user.email = identity.email  # the provider is the authority on the address
        if not user.name and (identity.name or fallback_name):
            user.name = (identity.name or fallback_name or "")[:120]
        audit.record(db, user.id, "auth.sign_in", {"provider": identity.provider})
    db.commit()
    return user


def sign_up_with_password(db: Session, email: str, password: str, name: str) -> User:
    """Creates an email-and-password account. The email is the account's subject, already trimmed and lower-cased.

    Like Google and Apple accounts, it is a separate account from any other sign-in with the same address.
    """
    taken = db.scalar(select(User.id).where(User.provider == PASSWORD, User.provider_subject == email))
    if taken is not None:
        raise _email_taken()
    password_hash = passwords.hash_password(password)
    user = User(provider=PASSWORD, provider_subject=email, email=email, name=name[:120])
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        # Two sign-ups with the same address at once: the other one won.
        db.rollback()
        raise _email_taken() from None
    db.add(PasswordCredential(user_id=user.id, password_hash=password_hash))
    audit.record(db, user.id, "auth.sign_up", {"provider": PASSWORD})
    db.commit()
    return user


def sign_in_with_password(db: Session, email: str, password: str) -> User:
    """The account for this email and password, or a 401 that does not say which one was wrong."""
    row = db.execute(
        select(User, PasswordCredential)
        .join(PasswordCredential, PasswordCredential.user_id == User.id)
        .where(User.provider == PASSWORD, User.provider_subject == email)
    ).first()
    if row is None:
        passwords.burn_time(password)  # same work as a real check, so timing does not reveal the address
        raise ApiError(401, "invalid_credentials", _WRONG)
    user, credential = row
    if not passwords.verify_password(password, credential.password_hash):
        raise ApiError(401, "invalid_credentials", _WRONG)
    audit.record(db, user.id, "auth.sign_in", {"provider": PASSWORD})
    db.commit()
    return user


def _email_taken() -> ApiError:
    return ApiError(409, "email_taken", "An account with this email already exists. Sign in instead.")


def rename(db: Session, user: User, name: str) -> User:
    user.name = name
    user.updated_at = utcnow()
    db.commit()
    return user


def export(db: Session, principal: Principal) -> dict[str, Any]:
    """Everything held about the user, as one JSON document."""
    user = principal.user
    audit.record(db, user.id, "account.exported")
    db.commit()
    filings = db.scalars(select(Filing).where(Filing.user_id == user.id).order_by(Filing.created_at)).all()
    snapshot = backup.export_snapshot(db, user.id)
    return {
        "exportedAt": iso_z(utcnow()),
        "user": user_json(user),
        "sessions": list_sessions(db, principal),
        "records": {key: value for key, value in snapshot.items() if key != "savedAt"} if snapshot else None,
        "filings": [filing_json(filing) for filing in filings],
        "auditLog": audit.for_user(db, user.id),
    }


def delete_account(db: Session, user: User) -> None:
    """Deletes the account and everything it owns. Cannot be undone.

    Sessions, records, filing records and idempotency keys go through ON DELETE
    CASCADE. The audit entry stays: it holds the (now meaningless) account id
    and the time, and nothing else.
    """
    audit.record(db, user.id, "account.deleted")
    db.execute(delete(User).where(User.id == user.id))
    db.commit()
