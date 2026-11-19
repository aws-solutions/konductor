"""Cron-like calendar rules and next-run calculation."""

from __future__ import annotations

import calendar
from datetime import datetime, timedelta


class CronField:
    """Parse one inclusive numeric calendar field."""

    def __init__(self, expression: str, minimum: int, maximum: int):
        self.expression = expression
        self.minimum = minimum
        self.maximum = maximum
        self.values = frozenset(self._parse(expression))
        if not self.values:
            raise ValueError("a cron field cannot be empty")

    def _parse(self, expression: str) -> set[int]:
        result: set[int] = set()
        for token in expression.split(","):
            token = token.strip()
            if not token:
                raise ValueError("empty cron list item")
            if "/" in token:
                base, step_text = token.split("/", 1)
                try:
                    step = int(step_text)
                except ValueError as exc:
                    raise ValueError("step must be an integer") from exc
                if step <= 0:
                    raise ValueError("step must be positive")
            else:
                base, step = token, 1

            if base == "*":
                start, end = self.minimum, self.maximum
            elif "-" in base:
                left, right = base.split("-", 1)
                start, end = int(left), int(right)
            else:
                start = end = int(base)
                if step != 1:
                    end = self.maximum

            if start < self.minimum or end > self.maximum or start > end:
                raise ValueError(f"value outside {self.minimum}-{self.maximum}: {token}")
            if "-" in base:
                result.update(range(start, end + 1, step))
            else:
                result.update(range(start, end + 1, step))
        return result

    def __contains__(self, value: int) -> bool:
        return value in self.values


class Schedule:
    """A five-field rule: minute hour day-of-month month weekday."""

    def __init__(self, expression: str):
        fields = expression.split()
        if len(fields) != 5:
            raise ValueError("a schedule needs five fields")
        self.expression = expression
        self.minute = CronField(fields[0], 0, 59)
        self.hour = CronField(fields[1], 0, 23)
        self.day = CronField(fields[2], 1, 31)
        self.month = CronField(fields[3], 1, 12)
        self.weekday = CronField(fields[4], 0, 6)

    def matches(self, value: datetime) -> bool:
        return (
            value.minute in self.minute
            and value.hour in self.hour
            and value.day in self.day
            and value.month in self.month
            and value.weekday() in self.weekday
        )

    @staticmethod
    def _next_month(value: datetime) -> datetime:
        if value.month == 12:
            return value.replace(year=value.year + 1, month=1, day=1, hour=0, minute=0)
        return value.replace(month=value.month + 1, day=1, hour=0, minute=0)

    def _first_allowed_month(self, value: datetime) -> datetime:
        candidate = value
        for _ in range(13):
            if candidate.month in self.month:
                return candidate.replace(day=1, hour=0, minute=0)
            candidate = self._next_month(candidate)
        raise RuntimeError("no allowed month")

    def next_run(self, after: datetime) -> datetime:
        """Return the first matching minute strictly after ``after``."""
        candidate = after.replace(second=0, microsecond=0, tzinfo=None)
        if candidate <= after:
            candidate += timedelta(minutes=1)

        for _ in range(3665):
            if candidate.month not in self.month:
                candidate = self._first_allowed_month(candidate)
                continue

            last_day = calendar.monthrange(candidate.year, candidate.month)[1]
            if candidate.day > last_day:
                candidate = self._next_month(candidate)
                continue
            if candidate.day not in self.day or candidate.weekday() not in self.weekday:
                candidate = (candidate + timedelta(days=1)).replace(hour=0, minute=0)
                continue
            if candidate.hour not in self.hour:
                candidate = (candidate + timedelta(hours=1)).replace(minute=0)
                continue

            if candidate.minute not in self.minute:
                later = [minute for minute in self.minute.values if minute > candidate.minute]
                if later:
                    candidate = candidate.replace(minute=min(later))
                else:
                    candidate = (candidate + timedelta(hours=1)).replace(minute=0)
                continue
            return candidate

        raise ValueError("schedule has no occurrence in the search horizon")
