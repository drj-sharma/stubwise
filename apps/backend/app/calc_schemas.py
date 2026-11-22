"""Request shapes for the stateless calculation endpoints."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, Field

from .domain.tax.types import DEFAULT_TAX_PROFILE
from .schemas import (
    Cents,
    DefaultDeduction,
    Id,
    IsoDate,
    IsoDateTime,
    Model,
    OvertimePct,
    PaySchedule,
    Period,
    StartingYtd,
    StubLine,
    TaxProfile,
    UsState,
)

CalcLines = Annotated[list[StubLine], Field(max_length=40)]

_REGULAR = {"kind": "earning", "label": "Regular", "minutes": 4605, "rateCents": 2400, "amountCents": 0,
            "source": "manual"}  # fmt: skip


def _examples(*examples: dict) -> ConfigDict:
    return ConfigDict(strict=True, extra="ignore", json_schema_extra={"examples": list(examples)})


class CalcStubRequest(Model):
    model_config = _examples({"lines": [_REGULAR]})

    lines: CalcLines


class TaxContext(Model):
    profile: TaxProfile | None = Field(description="null for a contractor: nothing is withheld.")
    businessState: UsState | None
    year: Annotated[int, Field(ge=2000, le=2100)]
    schedule: PaySchedule
    priorYtdGrossCents: Annotated[int, Field(ge=0, le=1_000_000_000_000)]


class CalcTaxesRequest(Model):
    model_config = _examples(
        {
            "lines": [_REGULAR],
            "context": {
                "profile": DEFAULT_TAX_PROFILE,
                "businessState": "PA",
                "year": 2026,
                "schedule": "biweekly",
                "priorYtdGrossCents": 3571200,
            },
        }
    )

    lines: CalcLines
    context: TaxContext


class YtdStub(Model):
    id: Id
    payDate: IsoDate
    createdAt: IsoDateTime
    lines: CalcLines


class CalcYtdRequest(Model):
    model_config = _examples(
        {
            "stub": {"id": "s-4", "payDate": "2026-11-27", "createdAt": "2026-11-26T10:00:00.000Z",
                     "lines": [_REGULAR]},
            "workerStubs": [],
            "startingYtd": {"year": 2026, "lines": [{"kind": "earning", "label": "Regular", "amountCents": 3571200}]},
        }
    )  # fmt: skip

    stub: YtdStub
    workerStubs: Annotated[list[YtdStub], Field(max_length=400)] = []
    startingYtd: StartingYtd | None = None


class WorkerPayProfile(Model):
    payType: Literal["hourly", "salary"]
    rateCents: Cents
    type: Literal["employee", "contractor"]
    defaultDeductions: Annotated[list[DefaultDeduction], Field(max_length=20)] = []


class PreviousStub(Model):
    period: Period
    payDate: IsoDate
    lines: CalcLines


class CalcNextStubRequest(Model):
    model_config = _examples(
        {
            "worker": {"payType": "hourly", "rateCents": 2400, "type": "employee", "defaultDeductions": []},
            "schedule": "biweekly",
            "previous": None,
            "today": "2026-11-22",
            "overtimeMultiplierPct": 150,
        }
    )

    worker: WorkerPayProfile
    schedule: PaySchedule
    previous: PreviousStub | None = None
    today: IsoDate
    overtimeMultiplierPct: OvertimePct = 150


class CalcPayPeriodRequest(Model):
    model_config = _examples({"schedule": "biweekly", "today": "2026-11-22", "latest": None})

    schedule: PaySchedule
    today: IsoDate
    latest: Period | None = Field(default=None, description="The newest pay period on record, if any.")
