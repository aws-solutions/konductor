"""Recurring account charges."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation

from .ledger import Ledger
from .models import Transaction


def apply_monthly_fee(
    ledger: Ledger,
    account: str,
    fee: Decimal | str,
    transaction_id: str,
    at: datetime,
) -> Transaction:
    """Charge a positive fee to an account and credit the fee income account."""
    try:
        value = Decimal(str(fee))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("fee must be a decimal") from exc
    if value <= 0:
        raise ValueError("fee must be positive")
    income = "FEE_INCOME"
    if income not in ledger.accounts:
        ledger.create_account(income, "1000000.00")
    return ledger.post(transaction_id, account, income, value, at, "Monthly account fee")
