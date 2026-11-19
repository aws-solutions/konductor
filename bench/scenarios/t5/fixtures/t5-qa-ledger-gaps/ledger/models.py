"""Data structures shared by the bookkeeping package."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass(frozen=True)
class Account:
    """An account and the amount it may go below zero."""

    name: str
    overdraft_limit: Decimal = Decimal("0.00")


@dataclass
class Transaction:
    """One balanced transfer between two accounts."""

    transaction_id: str
    debit_account: str
    credit_account: str
    amount: Decimal
    at: datetime
    description: str = ""
    reversal_of: str | None = None
    reversed: bool = False


@dataclass(frozen=True)
class Statement:
    """A statement includes both endpoints of its requested period."""

    account: str
    start: datetime
    end: datetime
    opening_balance: Decimal
    closing_balance: Decimal
    transactions: tuple[Transaction, ...]
