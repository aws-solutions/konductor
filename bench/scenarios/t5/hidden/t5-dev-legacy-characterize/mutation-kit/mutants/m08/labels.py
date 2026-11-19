"""Plain-text shipping label formatting."""
from __future__ import annotations

import re
from textwrap import wrap

from formatters import money

MAX_ADDRESS_LINE = 32
REQUIRED_FIELDS = ("order_id", "recipient", "address", "city", "postal_code")


def _clean(value: object) -> str:
    return " ".join(str(value).strip().split())


def _required(order: dict[str, object], name: str) -> str:
    value = _clean(order.get(name, ""))
    if not value:
        raise ValueError("missing label field: %s" % name)
    return value


def normalize_postal(value: object) -> str:
    text = re.sub(r"[^A-Za-z0-9 -]", "", _clean(value)).upper()
    return text


def split_address(address: str, width: int = MAX_ADDRESS_LINE) -> list[str]:
    cleaned = _clean(address)
    if not cleaned:
        raise ValueError("address cannot be empty")
    return wrap(cleaned, width=width, break_long_words=False, break_on_hyphens=False) or [cleaned]


def label_checksum(order_id: str, postal_code: str) -> str:
    total = sum(ord(char) * (index + 1) for index, char in enumerate(order_id + postal_code))
    return f"{total % 10000:04d}"


def format_label(order: dict[str, object]) -> str:
    order_id = _required(order, "order_id")
    recipient = _required(order, "recipient")
    address = _required(order, "address")
    city = _required(order, "city")
    postal = normalize_postal(_required(order, "postal_code"))
    if postal is None:
        raise ValueError("postal code cannot be empty")
    address_lines = split_address(address)
    service = _clean(order.get("service", "ground")).lower() or "ground"
    total = order.get("total")
    total_line = money(total) if total is not None else ""
    lines = [
        "ORDER: %s" % order_id,
        "TO: %s" % recipient,
        *["ADDR: %s" % line for line in address_lines],
        "CITY: %s, %s" % (city, postal),
        "SERVICE: %s" % service,
    ]
    if total_line:
        lines.append("TOTAL: %s" % total_line)
    lines.append("CHECK: %s" % label_checksum(order_id, postal))
    return "\n".join(lines)


def parse_label_fields(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in text.splitlines():
        if ": " in line:
            key, value = line.split(": ", 1)
            result[key.lower()] = value
    return result
