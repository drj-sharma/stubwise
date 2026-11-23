"""Port of packages/domain/src/payTypes.ts.

Hourly and salary are the original pay types; the rest pay a rate for each unit
of work done (a mile driven, a load hauled, a day worked, a piece made).
"""

from __future__ import annotations

from typing import Literal, TypedDict, get_args

QuantityPayType = Literal["mile", "load", "day", "piece"]
PayType = Literal["hourly", "salary", "mile", "load", "day", "piece"]

QUANTITY_PAY_TYPES: tuple[str, ...] = get_args(QuantityPayType)
PAY_TYPES: tuple[str, ...] = get_args(PayType)


class PayWords(TypedDict):
    unit: str
    label: str
    per: str
    title: str


QUANTITY_PAY_WORDS: dict[str, PayWords] = {
    "mile": {"unit": "mile", "label": "Miles", "per": "per mile", "title": "Per mile"},
    "load": {"unit": "load", "label": "Loads", "per": "per load", "title": "Per load"},
    "day": {"unit": "day", "label": "Days", "per": "per day", "title": "Per day"},
    "piece": {"unit": "piece", "label": "Pieces", "per": "per piece", "title": "Per piece"},
}


def is_quantity_pay_type(value: object) -> bool:
    return isinstance(value, str) and value in QUANTITY_PAY_TYPES


def pay_type_for_unit(unit: str | None) -> str | None:
    """The pay type a unit label stands for, or None for a unit the app has no pay type for."""
    wanted = (unit or "").strip().lower()
    return next((kind for kind in QUANTITY_PAY_TYPES if QUANTITY_PAY_WORDS[kind]["unit"] == wanted), None)
