"""Request plumbing: body size limits, request ids, the access log and security headers."""

from __future__ import annotations

import logging
import re
import time
import traceback
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import error_response
from .logs import request_id
from .rate_limit import RateLimiter

log = logging.getLogger("stubwise.request")

DEFAULT_BODY_LIMIT = 256 * 1024
# A backup carries up to 5,000 stubs and a logo; a business carries a logo.
BODY_LIMITS = {"/v1/backup": 8 * 1024 * 1024, "/v1/business": 1024 * 1024, "/v1/filings": 64 * 1024}

_SAFE_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{8,64}")


def body_limit(path: str) -> int:
    return BODY_LIMITS.get(path, DEFAULT_BODY_LIMIT)


class BodyLimitMiddleware:
    """Refuses bodies over the route's limit, whether or not the client declared a length."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = body_limit(scope["path"])
        declared = dict(scope["headers"]).get(b"content-length", b"")
        if declared.isdigit() and int(declared) > limit:
            response = error_response(413, "body_too_large", f"The request body may be at most {limit} bytes.")
            await response(scope, receive, send)
            return

        received = 0
        overflowed = False
        replaced = False

        async def limited_receive() -> Message:
            nonlocal received, overflowed
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Stop feeding the route. Whatever it makes of the truncated body is replaced below.
                    overflowed = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal replaced
            if not overflowed:
                await send(message)
            elif not replaced:
                replaced = True
                response = error_response(413, "body_too_large", f"The request body may be at most {limit} bytes.")
                await response(scope, receive, send)

        await self.app(scope, limited_receive, guarded_send)


def install_request_middleware(app, *, limiter: RateLimiter, production: bool) -> None:
    @app.middleware("http")
    async def handle(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        incoming = request.headers.get("x-request-id", "")
        current = incoming if _SAFE_REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        token = request_id.set(current)
        started = time.perf_counter()
        try:
            address = request.client.host if request.client else "unknown"
            if not limiter.allow(address):
                response: Response = error_response(
                    429, "rate_limited", "Too many requests. Wait a minute and try again."
                )
            else:
                try:
                    response = await call_next(request)
                except Exception as error:
                    # The exception type and stack frames, but never str(error): a validation or
                    # database driver error can quote the offending value, which may be an SSN.
                    frames = "".join(traceback.format_tb(error.__traceback__))
                    log.error("unhandled %s\n%s", type(error).__name__, frames)
                    response = error_response(500, "internal_error", "Something went wrong on our side.")
            response.headers["X-Request-ID"] = current
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "no-referrer"
            # Responses hold pay and tax details; no proxy or device should keep a copy.
            response.headers["Cache-Control"] = "no-store"
            if production:
                response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            log.info(
                "%s %s -> %s",
                request.method,
                request.url.path,
                response.status_code,
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    "user_id": getattr(request.state, "user_id", None),
                },
            )
            return response
        finally:
            request_id.reset(token)
