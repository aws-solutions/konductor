"""Statement formatting helpers."""
from __future__ import annotations

from decimal import Decimal

from .models import Statement


def statement_total(statement: Statement) -> Decimal:
    """Return the movement shown on a statement."""
    return statement.closing_balance - statement.opening_balance


def render_text(statement: Statement) -> str:
    lines = [
        f"Account: {statement.account}",
        f"Period: {statement.start.isoformat()} to {statement.end.isoformat()}",
        f"Opening balance: {statement.opening_balance:.2f}",
    ]
    for tx in statement.transactions:
        direction = "debit" if tx.debit_account == statement.account else "credit"
        lines.append(f"{tx.at.isoformat()} {direction} {tx.amount:.2f} {tx.description}".rstrip())
    lines.append(f"Closing balance: {statement.closing_balance:.2f}")
    return "\n".join(lines)
