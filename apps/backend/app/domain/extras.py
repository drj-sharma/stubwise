"""Optional stub extras: paid time off balances and employer-paid taxes.

Like year-to-date (ytd.py) these are worked out from the saved stubs on every
read and never stored, so a later stub always carries on from the one before
it. Mirrored in packages/domain/src/extras.ts for the shared types.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, TypedDict

from .money import Cents
from .pay_period import year_of
from .ytd import _is_at_or_before

PTO_KINDS = ("sick", "vacation")


class ExtrasStub(TypedDict):
    id: str
    payDate: str
    createdAt: str
    pto: Mapping[str, Any] | None
    employerTaxes: Sequence[Mapping[str, Any]] | None


def _counted(target: ExtrasStub, stubs: Sequence[ExtrasStub]) -> list[ExtrasStub]:
    """Every stub up to and including ``target``, which counts even when not saved yet."""
    included = {stub["id"]: stub for stub in stubs if _is_at_or_before(stub, target)}  # type: ignore[arg-type]
    included[target["id"]] = target
    return list(included.values())


def compute_pto(
    target: ExtrasStub, stubs: Sequence[ExtrasStub], start: Mapping[str, Any] | None
) -> dict[str, dict[str, int]]:
    """Accrued and used this stub, and the balance available after it, in minutes, for sick and vacation.

    The balance is what the worker had before the first stub, plus everything
    accrued, minus everything used, across all years (time off does not reset on January 1).
    """
    counted = _counted(target, stubs)
    result: dict[str, dict[str, int]] = {}
    for kind in PTO_KINDS:
        balance = int((start or {}).get(f"{kind}Minutes", 0))
        for stub in counted:
            entry = (stub["pto"] or {}).get(kind) or {}
            balance += int(entry.get("accruedMinutes", 0)) - int(entry.get("usedMinutes", 0))
        this = (target["pto"] or {}).get(kind) or {}
        result[kind] = {
            "accruedMinutes": int(this.get("accruedMinutes", 0)),
            "usedMinutes": int(this.get("usedMinutes", 0)),
            "availableMinutes": balance,
        }
    return result


def compute_employer_taxes(target: ExtrasStub, stubs: Sequence[ExtrasStub]) -> list[dict[str, Any]]:
    """The target's employer-paid taxes, each with its year-to-date (same calendar year, by label)."""
    year = year_of(target["payDate"])
    totals: dict[str, Cents] = {}
    for stub in _counted(target, stubs):
        if year_of(stub["payDate"]) != year:
            continue
        for tax in stub["employerTaxes"] or []:
            key = str(tax["label"]).strip().lower()
            totals[key] = totals.get(key, 0) + int(tax["amountCents"])
    return [
        {
            "label": tax["label"],
            "amountCents": tax["amountCents"],
            "ytdCents": totals[str(tax["label"]).strip().lower()],
        }
        for tax in target["employerTaxes"] or []
    ]


def carry_forward(stub: ExtrasStub | None) -> tuple[dict[str, Any] | None, list[dict[str, Any]] | None]:
    """What the next stub starts from: the same accrual and employer taxes, with nothing used."""
    if stub is None:
        return None, None
    pto = None
    if stub["pto"]:
        pto = {
            kind: {"accruedMinutes": int((stub["pto"].get(kind) or {}).get("accruedMinutes", 0)), "usedMinutes": 0}
            for kind in PTO_KINDS
        }
    taxes = [dict(tax) for tax in stub["employerTaxes"] or []] or None
    return pto, taxes
