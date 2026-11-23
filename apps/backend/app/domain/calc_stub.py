"""Port of packages/domain/src/calcStub.ts."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Literal, NotRequired, TypedDict

from .money import Cents, assert_cents, sum_cents
from .time import Minutes, pay_for_minutes, pay_for_quantity

LineKind = Literal["earning", "deduction"]
LineSource = Literal["manual", "calculated"]
TaxCode = str
"""fit, ss, medicare, sit (state income), sdi, fli, pfml, ui, ltc, transit, or local:<place>."""


class StubLine(TypedDict):
    """One line of a pay stub.

    ``manual`` lines carry an amount the user typed. ``calculated`` lines are
    tax amounts worked out here, so they can be recomputed without touching
    what the user entered. ``taxCode`` is set on tax deductions only.
    """

    kind: LineKind
    label: str
    minutes: Minutes | None
    rateCents: Cents | None
    amountCents: Cents
    source: LineSource
    taxCode: NotRequired[TaxCode | None]
    quantityMilli: NotRequired[int | None]
    """Units of work for a per-mile, per-load, per-day or per-piece earning, in thousandths of a unit
    (12.5 miles is 12500). Set with ``rateCents`` (the rate per unit) and with ``minutes`` None."""
    unit: NotRequired[str | None]
    """What the quantity counts: "mile", "load", "day" or "piece"."""
    supplemental: NotRequired[bool]
    """Earnings only: True when federal income tax is withheld on the line at the flat supplemental
    rate (a bonus or commission) instead of as ordinary pay. Absent or False: ordinary."""


class StubTotals(TypedDict):
    grossCents: Cents
    deductionsCents: Cents
    netCents: Cents
    totalMinutes: Minutes


def is_hourly_line(line: StubLine) -> bool:
    """True when the amount is time multiplied by a rate, not a typed figure."""
    return line["minutes"] is not None and line["rateCents"] is not None


def is_quantity_line(line: StubLine) -> bool:
    """True when the amount is a quantity of units multiplied by a rate per unit."""
    return line["minutes"] is None and line["rateCents"] is not None and line.get("quantityMilli") is not None


def is_supplemental_line(line: StubLine) -> bool:
    """True for an earning line taxed at the flat supplemental rate."""
    return line["kind"] == "earning" and line.get("supplemental") is True


def default_supplemental(label: str) -> bool:
    """Whether a new line with this label starts out as supplemental pay: only "Bonus" does."""
    return js_trim(label).lower() == "bonus"


def line_amount(line: StubLine) -> Cents:
    """The amount a line should carry: time x rate for hourly lines, quantity x rate for per-unit
    lines, the typed amount otherwise."""
    if line["minutes"] is not None and line["rateCents"] is not None:
        return pay_for_minutes(line["minutes"], line["rateCents"])
    if is_quantity_line(line):
        return pay_for_quantity(line["quantityMilli"], line["rateCents"])  # type: ignore[typeddict-item, arg-type]
    assert_cents(line["amountCents"])
    return line["amountCents"]


def with_computed_amount(line: StubLine) -> StubLine:
    """Returns the line with its amount brought in step with its time and rate."""
    return {**line, "amountCents": line_amount(line)}


def calc_stub(lines: Sequence[StubLine]) -> StubTotals:
    earnings = [line for line in lines if line["kind"] == "earning"]
    deductions = [line for line in lines if line["kind"] == "deduction"]
    gross = sum_cents([line_amount(line) for line in earnings])
    deducted = sum_cents([line_amount(line) for line in deductions])
    total_minutes = sum((line["minutes"] or 0) for line in earnings if is_hourly_line(line))
    return {
        "grossCents": gross,
        "deductionsCents": deducted,
        "netCents": gross - deducted,
        "totalMinutes": total_minutes,
    }


# What JavaScript's String.prototype.trim and the regex class \s treat as white
# space. Python's str.strip() and \s differ at the edges (they include U+001C-1F
# and U+0085 and leave out U+FEFF), which would make the two sides disagree on
# whether two labels are the same line.
_JS_SPACE = "\t\n\x0b\x0c\r \xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_JS_SPACES = re.compile(f"[{_JS_SPACE}]+")
_JS_TRIM = re.compile(f"^[{_JS_SPACE}]+|[{_JS_SPACE}]+$")


def js_trim(text: str) -> str:
    return _JS_TRIM.sub("", text)


def line_key(kind: str, label: str) -> str:
    """Lines are matched across stubs by kind and label, ignoring case and spacing."""
    return f"{kind}:{_JS_SPACES.sub(' ', js_trim(label).lower())}"
