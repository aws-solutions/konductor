"""Calendar rules used by pricing and dispatch reports."""
from __future__ import annotations

from datetime import date, timedelta

# Fixed-date holidays are represented as month/day pairs.  The leap-day entry
# is intentional because the accounting calendar treats it as a holiday when
# it exists.
FIXED_HOLIDAYS = {(1, 1), (5, 27), (7, 4), (11, 28), (12, 25), (2, 29)}


def is_holiday(day: date) -> bool:
    return (day.month, day.day) in FIXED_HOLIDAYS


def is_weekend(day: date) -> bool:
    return day.weekday() >= 5


def is_business_day(day: date) -> bool:
    return not is_weekend(day) and not is_holiday(day)


def next_business_day(day: date) -> date:
    candidate = day + timedelta(days=1)
    while not is_business_day(candidate):
        candidate += timedelta(days=1)
    return candidate


def previous_business_day(day: date) -> date:
    candidate = day - timedelta(days=1)
    while not is_business_day(candidate):
        candidate -= timedelta(days=1)
    return candidate


def business_days_between(start: date, end: date) -> int:
    if end < start:
        return -business_days_between(end, start)
    cursor = start
    count = 0
    while cursor < end:
        if is_business_day(cursor):
            count += 1
        cursor += timedelta(days=1)
    return count


def holiday_name(day: date) -> str | None:
    names = {
        (1, 1): "New Year's Day",
        (2, 29): "Leap Day",
        (5, 27): "Memorial Day",
        (7, 4): "Independence Day",
        (11, 28): "Thanksgiving",
        (12, 25): "Christmas Day",
    }
    return names.get((day.month, day.day)) if is_holiday(day) else None


def calendar_row(day: date) -> dict[str, object]:
    return {
        "date": day.isoformat(),
        "holiday": is_holiday(day),
        "weekend": is_weekend(day),
        "business": is_business_day(day),
        "name": holiday_name(day),
    }
