"""Interest calculations and posting helpers."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from .ledger import Ledger
from .models import Transaction

_CENT = Decimal("1") / Decimal("100")
_YEAR = 365
_SYSTEM_FLOAT = "1000000.00"


def _to_cents(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def _system_account(ledger: Ledger, name: str) -> str:
    if name not in ledger.accounts:
        ledger.create_account(name, _SYSTEM_FLOAT)
    return name


def calculate_interest(balance: Decimal, annual_rate: Decimal | str, days: int) -> Decimal:
    """Return simple interest rounded to cents using half-up rounding."""
    if days < 0:
        raise ValueError("days cannot be negative")
    rate = Decimal(str(annual_rate))
    if rate < 0:
        raise ValueError("annual rate cannot be negative")
    return _to_cents(balance * rate * days / _YEAR)


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
    if not amount:
        return None
    if amount > 0:
        source, target = _system_account(ledger, "INTEREST_EXPENSE"), account
    else:
        source, target = account, _system_account(ledger, "INTEREST_INCOME")
    return ledger.post(transaction_id, source, target, abs(amount), at, "Interest accrual")
