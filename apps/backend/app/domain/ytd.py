"""Port of packages/domain/src/ytd.ts."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TypedDict

from .calc_stub import LineKind, StubLine, line_amount, line_key
from .money import Cents
from .pay_period import IsoDate, year_of


class StartingYtdLine(TypedDict):
    kind: LineKind
    label: str
    amountCents: Cents


class StartingYtd(TypedDict):
    """What a worker was already paid this calendar year before the app was used."""

    year: int
    lines: Sequence[StartingYtdLine]


class YtdStub(TypedDict):
    id: str
    payDate: IsoDate
    createdAt: str
    """Breaks ties between stubs paid on the same date."""
    lines: Sequence[StubLine]


class YtdTotals(TypedDict):
    grossCents: Cents
    deductionsCents: Cents
    netCents: Cents
    byLine: dict[str, Cents]
    """Year-to-date amount per line, keyed by ``line_key``, in the order lines were first met."""


def compute_ytd(target: YtdStub, worker_stubs: Sequence[YtdStub], starting_ytd: StartingYtd | None) -> YtdTotals:
    """Year to date for ``target``.

    Starting balances for that calendar year, plus every saved stub for the
    worker paid in the same year up to and including ``target``. Always
    recomputed from history and never stored, which is why it cannot drift.
    """
    year = year_of(target["payDate"])
    by_line: dict[str, Cents] = {}
    totals = {"earning": 0, "deduction": 0}

    def add(kind: LineKind, label: str, amount: Cents) -> None:
        key = line_key(kind, label)
        by_line[key] = by_line.get(key, 0) + amount
        totals["earning" if kind == "earning" else "deduction"] += amount

    if starting_ytd and starting_ytd["year"] == year:
        for line in starting_ytd["lines"]:
            add(line["kind"], line["label"], line["amountCents"])

    included: dict[str, YtdStub] = {}
    for stub in worker_stubs:
        if year_of(stub["payDate"]) == year and _is_at_or_before(stub, target):
            included[stub["id"]] = stub
    # The target counts even when it has not been saved yet (live totals while editing).
    included[target["id"]] = target

    for stub in included.values():
        for stub_line in stub["lines"]:
            add(stub_line["kind"], stub_line["label"], line_amount(stub_line))

    gross, deducted = totals["earning"], totals["deduction"]
    return {"grossCents": gross, "deductionsCents": deducted, "netCents": gross - deducted, "byLine": by_line}


def _is_at_or_before(stub: YtdStub, target: YtdStub) -> bool:
    if stub["id"] == target["id"]:
        return True
    if stub["payDate"] != target["payDate"]:
        return stub["payDate"] < target["payDate"]
    return stub["createdAt"] <= target["createdAt"]


def prior_ytd_gross(target: YtdStub, worker_stubs: Sequence[YtdStub], starting_ytd: StartingYtd | None) -> Cents:
    """Gross pay this calendar year before ``target``: starting balances plus every earlier stub.

    Social Security's wage base and Additional Medicare Tax depend on it.
    Only the target's id, payDate and createdAt are read.
    """
    return compute_ytd({**target, "lines": []}, worker_stubs, starting_ytd)["grossCents"]
