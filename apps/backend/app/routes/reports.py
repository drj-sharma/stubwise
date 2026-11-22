"""Reports over a range of pay dates, worked out on the server from the saved stubs."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from ..auth.deps import reader
from ..db import get_session
from ..domain.pay_period import is_iso_date
from ..errors import ApiError
from ..services import reports

router = APIRouter(prefix="/v1/reports", tags=["Reports"])

From = Annotated[str, Query(alias="from", description="First pay date included, YYYY-MM-DD.")]
To = Annotated[str, Query(alias="to", description="Last pay date included, YYYY-MM-DD.")]
Format = Annotated[Literal["json", "csv"], Query(description="`csv` for a spreadsheet file.")]


def _range(start: str, end: str) -> tuple[str, str]:
    problems = [
        {"path": name, "message": "must be a date, YYYY-MM-DD"}
        for name, value in (("from", start), ("to", end))
        if not is_iso_date(value)
    ]
    if not problems and end < start:
        problems.append({"path": "to", "message": "is before from"})
    if problems:
        raise ApiError(400, "invalid_request", "The request is not valid.", problems)
    return start, end


def _csv(body: str, name: str, start: str, end: str) -> Response:
    return Response(
        body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="crewstub-{name}-{start}-to-{end}.csv"'},
    )


@router.get("/earnings", summary="Earnings by worker and kind of pay, for pay dates in a range")
def earnings(
    start: From, end: To, format: Format = "json", user_id: str = Depends(reader), db: Session = Depends(get_session)
) -> Any:
    start, end = _range(start, end)
    report = reports.earnings(db, user_id, start, end)
    return _csv(reports.earnings_csv(report), "earnings", start, end) if format == "csv" else report


@router.get("/deductions", summary="Taxes and other deductions by worker, for pay dates in a range")
def deductions(
    start: From, end: To, format: Format = "json", user_id: str = Depends(reader), db: Session = Depends(get_session)
) -> Any:
    start, end = _range(start, end)
    report = reports.deductions(db, user_id, start, end)
    return _csv(reports.deductions_csv(report), "deductions", start, end) if format == "csv" else report
