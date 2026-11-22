"""Password hashing with the standard library's scrypt.

A stored hash names its algorithm and parameters, so they can be raised
later: old hashes keep verifying with the parameters they were made with.

    scrypt$n=32768,r=8,p=1,l=64$<salt, base64>$<hash, base64>

Passwords and hashes are never logged (app/logs.py also redacts them).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from functools import cache

MIN_LENGTH, MAX_LENGTH = 10, 128

_N, _R, _P, _DKLEN, _SALT_BYTES = 2**15, 8, 1, 64, 16
# scrypt needs about 128 * r * n bytes (32 MiB here); OpenSSL's default ceiling is exactly that, so allow headroom.
_MAXMEM = 64 * 1024 * 1024


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=dklen, maxmem=_MAXMEM)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = _scrypt(password, salt, _N, _R, _P, _DKLEN)
    return f"scrypt$n={_N},r={_R},p={_P},l={_DKLEN}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    """True if ``password`` matches ``stored``. A malformed stored value never matches."""
    try:
        algorithm, params, salt_b64, digest_b64 = stored.split("$")
        if algorithm != "scrypt":
            return False
        values = dict(item.split("=", 1) for item in params.split(","))
        n, r, p, dklen = (int(values[key]) for key in ("n", "r", "p", "l"))
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(digest_b64)
    except (ValueError, KeyError):
        return False
    return hmac.compare_digest(_scrypt(password, salt, n, r, p, dklen), expected)


@cache
def _dummy_hash() -> str:
    return hash_password(secrets.token_urlsafe(16))


def burn_time(password: str) -> None:
    """Does the work of one verification, for an email address with no account, so the
    response time does not reveal which addresses have one."""
    verify_password(password, _dummy_hash())
