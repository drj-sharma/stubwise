"""One error shape for every failure: {"error": {"code", "message", "details"?}}."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """An error the client caused or can act on. Anything else becomes a 500 with no detail leaked."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers


def error_response(
    status_code: int, code: str, message: str, details: Any | None = None, headers: dict[str, str] | None = None
) -> JSONResponse:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return JSONResponse(status_code=status_code, content={"error": error}, headers=headers)


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ErrorResponse(BaseModel):
    """The body of every 4xx and 5xx response."""

    error: ErrorBody

    model_config = {
        "json_schema_extra": {"examples": [{"error": {"code": "worker_not_found", "message": "No such worker."}}]}
    }


_HTTP_CODES = {
    404: ("not_found", "No such endpoint."),
    405: ("method_not_allowed", "Method not allowed."),
    413: ("body_too_large", "The request body is too large."),
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.message, exc.details, exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = _HTTP_CODES.get(exc.status_code, ("bad_request", str(exc.detail)))
        return error_response(exc.status_code, code, message)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_request: Request, exc: RequestValidationError) -> JSONResponse:
        issues = exc.errors()
        if any(issue["type"] == "json_invalid" for issue in issues):
            return error_response(400, "bad_request", "The request body is not valid JSON.")
        # Field paths and messages only. What was sent is never echoed: it may hold an SSN or a token.
        details = [{"path": _path(issue["loc"]), "message": issue["msg"]} for issue in issues[:20]]
        return error_response(400, "invalid_request", "The request is not valid.", details)


def _path(loc: tuple[Any, ...]) -> str:
    """'stubs.0.payDate' for a body field; 'query.limit' or 'header.if-match' for anything else."""
    parts = loc[1:] if loc and loc[0] == "body" else loc
    return ".".join(str(part) for part in parts) or "body"
