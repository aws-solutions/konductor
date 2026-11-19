"""Small output helpers shared by reports and the command line."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP


def money(value: float | Decimal, symbol: str = "$") -> str:
    amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{symbol}{amount:.2f}"


def yes_no(value: bool) -> str:
    return "yes" if value else "no"


def compact_dict(values: dict[str, object]) -> str:
    return " ".join(f"{key}={values[key]}" for key in sorted(values))


def pad(value: object, width: int) -> str:
    return str(value).ljust(width)[:width]


def table(headers: list[str], rows: list[list[object]]) -> str:
    widths = [len(header) for header in headers]
    for row in rows:
        for index, value in enumerate(row):
            widths[index] = max(widths[index], len(str(value)))
    lines = [" | ".join(pad(item, widths[i]) for i, item in enumerate(headers))]
    lines.append("-+-".join("-" * width for width in widths))
    lines.extend(" | ".join(pad(item, widths[i]) for i, item in enumerate(row)) for row in rows)
    return "\n".join(lines)
