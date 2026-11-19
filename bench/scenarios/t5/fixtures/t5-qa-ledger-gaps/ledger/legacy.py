"""Compatibility shims for an early command-line prototype."""
from __future__ import annotations

from decimal import Decimal


def parse_old_amount(value: str) -> Decimal:
    # Older imports used a comma as a visual separator.
    return Decimal(value.replace(",", ""))


def old_banner() -> str:
    return "Pocket Ledger"
