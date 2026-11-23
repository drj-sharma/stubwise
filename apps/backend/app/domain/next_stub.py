"""Port of packages/domain/src/nextStub.ts."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal, TypedDict

from .calc_stub import StubLine, js_trim, with_computed_amount
from .money import Cents
from .pay_period import (
    IsoDate,
    PayPeriod,
    PaySchedule,
    default_pay_date,
    next_pay_date,
    next_payday,
    next_period,
    period_containing,
)
from .time import DEFAULT_OVERTIME_MULTIPLIER_PCT, overtime_rate_cents

REGULAR_LABEL = "Regular"
OVERTIME_LABEL = "Overtime"
SALARY_LABEL = "Salary"


class DefaultDeduction(TypedDict):
    label: str
    amountCents: Cents


class WorkerPayProfile(TypedDict):
    payType: Literal["hourly", "salary"]
    rateCents: Cents
    """Hourly rate, or salary per pay period."""
    type: Literal["employee", "contractor"]
    defaultDeductions: Sequence[DefaultDeduction]


class StubDraft(TypedDict):
    period: PayPeriod
    payDate: IsoDate
    lines: list[StubLine]


class PreviousStub(TypedDict):
    period: PayPeriod
    payDate: IsoDate
    lines: Sequence[StubLine]


def draft_next_stub(
    worker: WorkerPayProfile,
    schedule: PaySchedule,
    previous: PreviousStub | None,
    today: IsoDate,
    overtime_multiplier_pct: int = DEFAULT_OVERTIME_MULTIPLIER_PCT,
    first_pay_date: IsoDate | None = None,
) -> StubDraft:
    """The draft behind "Next pay period".

    Dates move forward one period, and the lines repeat with the worker's
    current rate. Hours are carried over as a starting point because most small
    crews work a similar week; one-off earnings such as a bonus are not repeated.
    """
    if not previous:
        # With the business's first pay day known, the first stub is for the next real pay day.
        if first_pay_date:
            upcoming = next_payday(first_pay_date, schedule, today)
            return {
                "period": upcoming["period"],
                "payDate": upcoming["payDate"],
                "lines": _first_lines(worker, overtime_multiplier_pct),
            }
        period = period_containing(today, schedule)
        return {
            "period": period,
            "payDate": default_pay_date(period),
            "lines": _first_lines(worker, overtime_multiplier_pct),
        }

    period = next_period(previous["period"], schedule)
    pay_date = next_pay_date(previous["period"], previous["payDate"], period)
    lines: list[StubLine] = []

    for line in previous["lines"]:
        label = js_trim(line["label"]).lower()
        if line["kind"] == "earning":
            if line["minutes"] is not None and line["rateCents"] is not None:
                rate = (
                    overtime_rate_cents(worker["rateCents"], overtime_multiplier_pct)
                    if label == OVERTIME_LABEL.lower()
                    else worker["rateCents"]
                )
                lines.append(with_computed_amount({**line, "rateCents": rate}))
            elif label == SALARY_LABEL.lower():
                lines.append({**line, "amountCents": worker["rateCents"]})
            # Other flat earnings (bonus, tips, reimbursements) are one-offs: not repeated.
        elif not line.get("taxCode") or (line.get("taxCode") == "sit" and line["source"] == "manual"):
            # Calculated taxes are worked out afresh for the new stub, and a one-off
            # typed-over figure is not repeated. Hand-entered state tax carries over.
            lines.append({**line})

    if not any(line["kind"] == "earning" for line in lines):
        earnings = [line for line in _first_lines(worker, overtime_multiplier_pct) if line["kind"] == "earning"]
        lines[:0] = earnings
    return {"period": period, "payDate": pay_date, "lines": lines}


def _first_lines(worker: WorkerPayProfile, overtime_multiplier_pct: int) -> list[StubLine]:
    lines: list[StubLine]
    if worker["payType"] == "hourly":
        lines = [
            _line("earning", REGULAR_LABEL, 0, minutes=0, rate_cents=worker["rateCents"]),
            _line(
                "earning",
                OVERTIME_LABEL,
                0,
                minutes=0,
                rate_cents=overtime_rate_cents(worker["rateCents"], overtime_multiplier_pct),
            ),
        ]
    else:
        lines = [_line("earning", SALARY_LABEL, worker["rateCents"])]
    # Contractors (1099) carry no default deductions.
    if worker["type"] != "contractor":
        lines += [_line("deduction", d["label"], d["amountCents"]) for d in worker["defaultDeductions"]]
    return lines


def _line(
    kind: Literal["earning", "deduction"],
    label: str,
    amount_cents: Cents,
    *,
    minutes: int | None = None,
    rate_cents: Cents | None = None,
) -> StubLine:
    return {
        "kind": kind,
        "label": label,
        "minutes": minutes,
        "rateCents": rate_cents,
        "amountCents": amount_cents,
        "source": "manual",
    }
