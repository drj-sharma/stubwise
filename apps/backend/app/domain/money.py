"""Port of packages/domain/src/money.ts. Money is always an integer number of cents."""

from __future__ import annotations

import re

Cents = int

MAX_SAFE_INTEGER = 2**53 - 1
"""JavaScript's Number.MAX_SAFE_INTEGER. The app cannot represent larger amounts exactly, so neither may we."""


def is_safe_integer(value: object) -> bool:
    # bool is an int in Python but not a number of cents.
    return isinstance(value, int) and not isinstance(value, bool) and abs(value) <= MAX_SAFE_INTEGER


def assert_cents(value: object) -> None:
    if not is_safe_integer(value):
        raise ValueError(f"Expected a whole number of cents, got {value!r}")


def div_round_half_up(numerator: int, divisor: int) -> int:
    """Integer division rounded half away from zero. ``divisor`` must be positive."""
    if not is_integer(numerator) or not is_integer(divisor) or divisor <= 0:
        raise ValueError("div_round_half_up needs an integer numerator and a positive integer divisor")
    sign = -1 if numerator < 0 else 1
    quotient, remainder = divmod(abs(numerator), divisor)
    return sign * (quotient + 1 if remainder * 2 >= divisor else quotient)


def is_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def format_cents(cents: Cents) -> str:
    """'$1,615.71'. Negative amounts read '-$427.29'."""
    assert_cents(cents)
    dollars, rest = divmod(abs(cents), 100)
    return f"{'-' if cents < 0 else ''}${dollars:,}.{rest:02d}"


def parse_dollars(text: str) -> Cents | None:
    """Reads what a person types: '1842', '1,842.5', '$75.00'. None when the text is not an amount.

    More than two decimals is rejected rather than silently rounded.
    """
    cleaned = re.sub(r"[$,\s]", "", text)
    if not re.fullmatch(r"[0-9]+(\.[0-9]{0,2})?", cleaned):
        return None
    whole, _, fraction = cleaned.partition(".")
    cents = int(whole) * 100 + int(fraction.ljust(2, "0"))
    return cents if cents <= MAX_SAFE_INTEGER else None


def sum_cents(values: list[Cents]) -> Cents:
    total = 0
    for value in values:
        assert_cents(value)
        total += value
    return total
