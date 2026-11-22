"""Structured logs: one JSON object per line, with the request id, and redacted.

Redaction is the last line of defence, not the first. The code never logs
request bodies, tokens or taxpayer numbers on purpose; this catches what slips
past (a vendor error quoting a number back, a careless future log line, a
traceback) by scrubbing the finished line.
"""

from __future__ import annotations

import json
import logging
import re
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

REDACTED = "[redacted]"

_PATTERNS = [
    # Our access tokens, provider ID tokens, TaxBandits tokens: anything shaped like a JWT.
    re.compile(r"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}"),
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    # Stored password hashes (app/auth/passwords.py), and the value of any "password" field or
    # parameter, quoted or not, JSON-escaped or not: "password": "...", password=..., newPassword: ...
    re.compile(r"scrypt\$[^\s\"']+"),
    re.compile(r"(?i)(?<=password)(?:\\?[\"'])?\s*[:=]\s*(?:\\?[\"'])?(?:[^\"'\\,&}\n]|\\.)+"),
    # SSN/ITIN (123-45-6789), EIN (12-3456789), or a bare run of nine digits. The run must stand
    # alone: nine digits inside a longer id (a request id, a UUID) are not a taxpayer number.
    re.compile(r"(?<![A-Za-z0-9-])(?:\d{3}-\d{2}-\d{4}|\d{2}-\d{7}|\d{9})(?![A-Za-z0-9-])"),
]
_TIN = _PATTERNS[-1]

# Attributes every LogRecord has; anything else was passed with ``extra=`` and is emitted.
_STANDARD = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime", "taskName"}


def scrub(text: str) -> str:
    """Removes tokens, email addresses and taxpayer numbers from ``text``."""
    for pattern in _PATTERNS:
        text = pattern.sub(REDACTED, text)
    return text


def scrub_tins(text: str) -> str:
    """Removes taxpayer numbers only; for vendor messages that are stored and shown to the user."""
    return _TIN.sub(REDACTED, text)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        current = request_id.get()
        if current:
            entry["request_id"] = current
        entry.update({key: value for key, value in record.__dict__.items() if key not in _STANDARD})
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        # Scrubbed after serialising, so messages, extras and tracebacks are all covered.
        return scrub(json.dumps(entry, default=str))


def configure_logging(level: str) -> None:
    root = logging.getLogger()
    root.setLevel(level.upper())
    if not any(isinstance(handler.formatter, JsonFormatter) for handler in root.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        root.addHandler(handler)
    # httpx logs each outbound URL at INFO; uvicorn's access log duplicates ours without the request id.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").disabled = True
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
