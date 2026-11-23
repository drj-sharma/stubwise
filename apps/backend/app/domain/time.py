"""Port of packages/domain/src/time.ts. Worked time is whole minutes, never decimal hours."""

from __future__ import annotations

from .money import Cents, assert_cents, div_round_half_up, is_integer

Minutes = int

DEFAULT_OVERTIME_MULTIPLIER_PCT = 150
"""Overtime multiplier in hundredths: 150 means 1.5 times the regular rate."""


def _assert_minutes(value: object) -> None:
    if not is_integer(value) or value < 0:  # type: ignore[operator]
        raise ValueError(f"Expected whole minutes of zero or more, got {value!r}")


def to_minutes(hours: int, minutes: int) -> Minutes:
    if not is_integer(hours) or not is_integer(minutes) or hours < 0 or minutes < 0:
        raise ValueError("Hours and minutes must be whole numbers of zero or more")
    return hours * 60 + minutes


def from_minutes(total: Minutes) -> tuple[int, int]:
    """(hours, minutes)."""
    _assert_minutes(total)
    return divmod(total, 60)


def format_duration(total: Minutes) -> str:
    """'76 h 45 min'"""
    hours, minutes = from_minutes(total)
    return f"{hours} h {minutes:02d} min"


def format_clock(total: Minutes) -> str:
    """'76:45', the compact form used on the printed stub."""
    hours, minutes = from_minutes(total)
    return f"{hours}:{minutes:02d}"


def pay_for_minutes(minutes: Minutes, hourly_rate_cents: Cents) -> Cents:
    """Pay for worked minutes at an hourly rate, rounded once at the end."""
    _assert_minutes(minutes)
    assert_cents(hourly_rate_cents)
    return div_round_half_up(minutes * hourly_rate_cents, 60)


def pay_for_quantity(quantity_milli: int, rate_cents: Cents) -> Cents:
    """Pay for a quantity of units (whole thousandths of a unit) at a rate per unit, rounded once at the end."""
    if not is_integer(quantity_milli) or quantity_milli < 0:
        raise ValueError(f"Expected a quantity in whole thousandths of zero or more, got {quantity_milli!r}")
    assert_cents(rate_cents)
    return div_round_half_up(quantity_milli * rate_cents, 1000)


def overtime_rate_cents(hourly_rate_cents: Cents, multiplier_pct: int = DEFAULT_OVERTIME_MULTIPLIER_PCT) -> Cents:
    assert_cents(hourly_rate_cents)
    if not is_integer(multiplier_pct) or multiplier_pct < 100:
        raise ValueError("Overtime multiplier must be a whole percentage of 100 or more")
    return div_round_half_up(hourly_rate_cents * multiplier_pct, 100)
