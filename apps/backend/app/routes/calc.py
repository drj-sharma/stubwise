"""Stateless calculation endpoints: the same functions the records use, with nothing read or stored."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..auth.deps import reader
from ..calc_schemas import (
    CalcNextStubRequest,
    CalcPayPeriodRequest,
    CalcStubRequest,
    CalcTaxesRequest,
    CalcYtdRequest,
)
from ..domain.calc_stub import calc_stub, with_computed_amount
from ..domain.next_stub import draft_next_stub
from ..domain.pay_period import current_period, default_pay_date, next_period, period_containing
from ..domain.tax.apply_taxes import apply_taxes
from ..domain.ytd import compute_ytd, prior_ytd_gross

router = APIRouter(prefix="/v1/calc", tags=["Calculations"], dependencies=[Depends(reader)])


@router.post("/stub", summary="Totals for a set of lines")
def stub_totals(body: CalcStubRequest) -> dict[str, Any]:
    """Hourly lines are recalculated from minutes and rate; a stale amount is not trusted."""
    lines = [with_computed_amount(line.as_domain()) for line in body.lines]  # type: ignore[arg-type]
    return {"lines": lines, "totals": calc_stub(lines)}


@router.post("/taxes", summary="Bring the tax lines in step with the earnings")
def taxes(body: CalcTaxesRequest) -> dict[str, Any]:
    lines = [with_computed_amount(line.as_domain()) for line in body.lines]  # type: ignore[arg-type]
    result = apply_taxes(lines, body.context.model_dump())  # type: ignore[arg-type]
    return {"lines": result["lines"], "status": result["status"], "totals": calc_stub(result["lines"])}


@router.post("/ytd", summary="Year to date for a stub, given the worker's other stubs")
def ytd(body: CalcYtdRequest) -> dict[str, Any]:
    target = _ytd_stub(body.stub)
    others = [_ytd_stub(stub) for stub in body.workerStubs]
    starting = body.startingYtd.model_dump() if body.startingYtd else None
    totals = compute_ytd(target, others, starting)  # type: ignore[arg-type]
    return {
        **totals,
        "byLine": dict(sorted(totals["byLine"].items())),
        "priorYtdGrossCents": prior_ytd_gross(target, others, starting),  # type: ignore[arg-type]
    }


def _ytd_stub(stub: Any) -> Any:
    return {
        "id": stub.id,
        "payDate": stub.payDate,
        "createdAt": stub.createdAt,
        "lines": [line.as_domain() for line in stub.lines],
    }


@router.post("/next-stub", summary="Draft the next stub from the previous one")
def next_stub(body: CalcNextStubRequest) -> dict[str, Any]:
    """Dates and lines only; pass the result to /v1/calc/taxes for the tax lines."""
    previous = (
        {
            "period": body.previous.period.model_dump(),
            "payDate": body.previous.payDate,
            "lines": [line.as_domain() for line in body.previous.lines],
        }
        if body.previous
        else None
    )
    draft = draft_next_stub(
        body.worker.model_dump(),  # type: ignore[arg-type]
        body.schedule,
        previous,  # type: ignore[arg-type]
        body.today,
        body.overtimeMultiplierPct,
    )
    return {**draft, "totals": calc_stub(draft["lines"])}


@router.post("/pay-period", summary="Pay periods and the default pay date around a day")
def pay_period(body: CalcPayPeriodRequest) -> dict[str, Any]:
    containing = period_containing(body.today, body.schedule)
    latest = body.latest.model_dump() if body.latest else None
    current = current_period(latest, body.schedule, body.today)  # type: ignore[arg-type]
    return {
        "containing": containing,
        "next": next_period(containing, body.schedule),
        "current": current,
        "defaultPayDate": default_pay_date(current),
    }
