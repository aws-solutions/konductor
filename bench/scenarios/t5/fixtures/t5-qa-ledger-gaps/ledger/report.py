"""Small reporting conveniences kept separate from ledger storage."""
from __future__ import annotations

from collections import Counter
from decimal import Decimal

from .models import Statement


def summarize(statement: Statement) -> dict[str, Decimal | int]:
    credits = sum((tx.amount for tx in statement.transactions if tx.credit_account == statement.account), Decimal("0.00"))
    debits = sum((tx.amount for tx in statement.transactions if tx.debit_account == statement.account), Decimal("0.00"))
    return {"credits": credits, "debits": debits, "count": len(statement.transactions)}


def descriptions(statement: Statement) -> dict[str, int]:
    return dict(Counter(tx.description for tx in statement.transactions))
