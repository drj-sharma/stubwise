"""Port of packages/domain/src/payPeriod.ts.

A date is a plain 'YYYY-MM-DD' string so it never shifts with a time zone.
A pay period is ``{"start": ..., "end": ...}``.
"""

from __future__ import annotations

import calendar
import re
from datetime import date, timedelta
from typing import Literal, TypedDict, get_args

IsoDate = str
PaySchedule = Literal["weekly", "biweekly", "semimonthly", "monthly"]
PAY_SCHEDULES: tuple[PaySchedule, ...] = get_args(PaySchedule)


class PayPeriod(TypedDict):
    start: IsoDate
    end: IsoDate


_ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def is_iso_date(value: object) -> bool:
    if not isinstance(value, str) or not _ISO_DATE.fullmatch(value):
        return False
    year, month, day = _split(value)
    # Year 0000 passes the TypeScript check; Python's date cannot hold it. No pay date is that old.
    return year >= 1 and 1 <= month <= 12 and 1 <= day <= days_in_month(year, month)


def days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def add_days(day: IsoDate, days: int) -> IsoDate:
    return (_date(day) + timedelta(days=days)).isoformat()


def diff_days(start: IsoDate, end: IsoDate) -> int:
    """Whole days from ``start`` to ``end``; negative when ``end`` is earlier."""
    return (_date(end) - _date(start)).days


def year_of(day: IsoDate) -> int:
    return _split(day)[0]


def next_period(period: PayPeriod, schedule: PaySchedule) -> PayPeriod:
    """The period that follows ``period`` on the given schedule."""
    _assert_period(period)
    if schedule == "weekly":
        return {"start": add_days(period["start"], 7), "end": add_days(period["end"], 7)}
    if schedule == "biweekly":
        return {"start": add_days(period["start"], 14), "end": add_days(period["end"], 14)}
    if schedule == "semimonthly":
        year, month, day = _split(period["start"])
        if day <= 15:
            return {"start": _join(year, month, 16), "end": _join(year, month, days_in_month(year, month))}
        next_year, next_month = _month_after(year, month)
        return {"start": _join(next_year, next_month, 1), "end": _join(next_year, next_month, 15)}
    if schedule == "monthly":
        start = add_days(period["end"], 1)
        year, month, day = _split(start)
        next_year, next_month = _month_after(year, month)
        # One calendar month later, minus a day. A period starting on the 1st
        # therefore ends on the last day of that month, February included.
        same_day_next_month = _join(next_year, next_month, min(day, days_in_month(next_year, next_month)))
        return {"start": start, "end": add_days(same_day_next_month, -1)}
    raise ValueError(f"Unknown pay schedule {schedule!r}")


def next_pay_date(previous: PayPeriod, previous_pay_date: IsoDate, following: PayPeriod) -> IsoDate:
    """Keeps the same gap between period end and pay date as the previous stub had."""
    return add_days(following["end"], diff_days(previous["end"], previous_pay_date))


def period_containing(today: IsoDate, schedule: PaySchedule) -> PayPeriod:
    """A sensible first period for a worker with no stubs yet: the one containing ``today``."""
    year, month, day = _split(today)
    if schedule == "weekly":
        monday = add_days(today, -_monday_offset(today))
        return {"start": monday, "end": add_days(monday, 6)}
    if schedule == "biweekly":
        monday = add_days(today, -_monday_offset(today) - 7)
        return {"start": monday, "end": add_days(monday, 13)}
    if schedule == "semimonthly":
        if day <= 15:
            return {"start": _join(year, month, 1), "end": _join(year, month, 15)}
        return {"start": _join(year, month, 16), "end": _join(year, month, days_in_month(year, month))}
    if schedule == "monthly":
        return {"start": _join(year, month, 1), "end": _join(year, month, days_in_month(year, month))}
    raise ValueError(f"Unknown pay schedule {schedule!r}")


def current_period(
    latest: PayPeriod | None, schedule: PaySchedule, today: IsoDate, first_pay_date: IsoDate | None = None
) -> PayPeriod:
    """The pay period the business is in right now.

    With stubs on record it follows on from the latest one, so a business whose
    two-week cycle starts on a Wednesday keeps that cycle; with none it falls
    back to the calendar.
    """
    if not latest:
        if first_pay_date:
            return next_payday(first_pay_date, schedule, today)["period"]
        return period_containing(today, schedule)
    period = latest
    # Bounded: after a long gap, stop walking and realign to the calendar.
    for _ in range(60):
        if not period["end"] < today:
            break
        period = next_period(period, schedule)
    return period_containing(today, schedule) if period["end"] < today else period


class Payday(TypedDict):
    period: PayPeriod
    payDate: IsoDate


def period_for_pay_date(pay_date: IsoDate, schedule: PaySchedule) -> PayPeriod:
    """The pay period a pay day pays for: the latest whole period that ended before it.

    Weeks run Monday to Sunday, so a Friday pay day pays the week before.
    """
    year, month, day = _split(pay_date)
    prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
    if schedule in ("weekly", "biweekly"):
        # The Sunday before the pay day (a week earlier when the pay day is itself a Sunday).
        weekday = (_date(pay_date).weekday() + 1) % 7  # 0 = Sunday
        end = add_days(pay_date, -(7 if weekday == 0 else weekday))
        return {"start": add_days(end, -6 if schedule == "weekly" else -13), "end": end}
    if schedule == "semimonthly":
        if day > 15:
            return {"start": _join(year, month, 1), "end": _join(year, month, 15)}
        return {
            "start": _join(prev_year, prev_month, 16),
            "end": _join(prev_year, prev_month, days_in_month(prev_year, prev_month)),
        }
    if schedule == "monthly":
        return {
            "start": _join(prev_year, prev_month, 1),
            "end": _join(prev_year, prev_month, days_in_month(prev_year, prev_month)),
        }
    raise ValueError(f"Unknown pay schedule {schedule!r}")


def next_payday(first_pay_date: IsoDate, schedule: PaySchedule, today: IsoDate) -> Payday:
    """The first pay day on or after ``today``, counting on from the business's first pay day."""
    anchor: Payday = {"period": period_for_pay_date(first_pay_date, schedule), "payDate": first_pay_date}
    return upcoming_paydays(anchor, schedule, today, 1)[0]


def upcoming_paydays(anchor: Payday, schedule: PaySchedule, today: IsoDate, count: int) -> list[Payday]:
    """The next ``count`` pay days from ``today`` on (today included), walking on from a known one.

    Bounded: after a very long gap the last walked pay day is used.
    """
    current = anchor
    for _ in range(600):
        if not current["payDate"] < today:
            break
        current = _advance_payday(current, schedule)
    result: list[Payday] = []
    for _ in range(count):
        result.append(current)
        current = _advance_payday(current, schedule)
    return result


def _advance_payday(payday: Payday, schedule: PaySchedule) -> Payday:
    period = next_period(payday["period"], schedule)
    return {"period": period, "payDate": next_pay_date(payday["period"], payday["payDate"], period)}


def default_pay_date(period: PayPeriod) -> IsoDate:
    """Default pay date for a first stub: the Friday after the period ends."""
    weekday = (_date(period["end"]).weekday() + 1) % 7  # JavaScript's getUTCDay: 0 = Sunday
    days_until_friday = ((5 - weekday + 7) % 7) or 7
    return add_days(period["end"], days_until_friday)


def _monday_offset(day: IsoDate) -> int:
    return _date(day).weekday()  # Monday = 0, which is (getUTCDay() + 6) % 7


def _assert_period(period: PayPeriod) -> None:
    if not is_iso_date(period["start"]) or not is_iso_date(period["end"]):
        raise ValueError("Pay period dates must be YYYY-MM-DD")
    if period["end"] < period["start"]:
        raise ValueError("Pay period ends before it starts")


def _month_after(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _split(day: IsoDate) -> tuple[int, int, int]:
    year, month, dom = day.split("-")
    return int(year), int(month), int(dom)


def _join(year: int, month: int, day: int) -> IsoDate:
    return f"{year:04d}-{month:02d}-{day:02d}"


def _date(day: IsoDate) -> date:
    return date(*_split(day))
