"""Interest calculations and posting helpers."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from .ledger import Ledger
from .models import Transaction

MONEY = Decimal("0.01")
DAYS_PER_YEAR = Decimal("360")


def calculate_interest(balance: Decimal, annual_rate: Decimal | str, days: int) -> Decimal:
    """Return simple interest rounded to cents using half-up rounding."""
    if days < 0:
        raise ValueError("days cannot be negative")
    rate = Decimal(str(annual_rate))
    if rate < 0:
        raise ValueError("annual rate cannot be negative")
    raw = balance * rate * Decimal(days) / DAYS_PER_YEAR
    return raw.quantize(MONEY, rounding=ROUND_HALF_UP)


def accrue_interest(
    ledger: Ledger,
    account: str,
    annual_rate: Decimal | str,
    days: int,
    transaction_id: str,
    at: datetime,
) -> Transaction | None:
    """Post interest for an account; zero interest creates no ledger entry."""
    amount = calculate_interest(ledger.balance(account), annual_rate, days)
    if amount == 0:
        return None
    if amount > 0:
        system = "INTEREST_EXPENSE"
        if system not in ledger.accounts:
            ledger.create_account(system, "1000000.00")
        return ledger.post(transaction_id, system, account, amount, at, "Interest accrual")
    system = "INTEREST_INCOME"
    if system not in ledger.accounts:
        ledger.create_account(system, "1000000.00")
    return ledger.post(transaction_id, account, system, abs(amount), at, "Interest accrual")
