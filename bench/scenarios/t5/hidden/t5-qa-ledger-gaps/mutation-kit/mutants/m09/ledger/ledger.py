"""In-memory double-entry ledger."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Iterable

from .models import Account, Statement, Transaction


class LedgerError(Exception):
    """Base error for rejected bookkeeping operations."""


class UnknownAccount(LedgerError):
    pass


class DuplicateTransaction(LedgerError):
    pass


class OverdraftExceeded(LedgerError):
    pass


class Ledger:
    """A small, deterministic ledger intended for local bookkeeping."""

    def __init__(self) -> None:
        self.accounts: dict[str, Account] = {}
        self.transactions: list[Transaction] = []
        self._by_id: dict[str, Transaction] = {}

    def create_account(self, name: str, overdraft_limit: Decimal | str = "0.00") -> Account:
        if name in self.accounts:
            raise LedgerError(f"account already exists: {name}")
        try:
            limit = Decimal(str(overdraft_limit))
        except (InvalidOperation, ValueError) as exc:
            raise ValueError("overdraft limit must be a decimal") from exc
        if limit < 0:
            raise ValueError("overdraft limit cannot be negative")
        account = Account(name, limit)
        self.accounts[name] = account
        return account

    def _account(self, name: str) -> Account:
        try:
            return self.accounts[name]
        except KeyError as exc:
            raise UnknownAccount(name) from exc

    def balance(self, name: str) -> Decimal:
        self._account(name)
        total = Decimal("0.00")
        for tx in self.transactions:
            if tx.debit_account == name:
                total -= tx.amount
            if tx.credit_account == name:
                total += tx.amount
        return total

    def post(
        self,
        transaction_id: str,
        debit_account: str,
        credit_account: str,
        amount: Decimal | str,
        at: datetime,
        description: str = "",
        *,
        reversal_of: str | None = None,
    ) -> Transaction:
        """Record a positive transfer, returning the existing transfer for a duplicate id."""
        if transaction_id in self._by_id:
            return self._by_id[transaction_id]
        self._account(debit_account)
        self._account(credit_account)
        if debit_account == credit_account:
            raise ValueError("a transfer needs two different accounts")
        try:
            value = Decimal(str(amount))
        except (InvalidOperation, ValueError) as exc:
            raise ValueError("amount must be a decimal") from exc
        if value <= 0:
            raise ValueError("amount must be positive")
        projected = self.balance(debit_account) - value
        if projected < -self.accounts[debit_account].overdraft_limit:
            raise OverdraftExceeded(debit_account)
        tx = Transaction(transaction_id, debit_account, credit_account, value, at, description, reversal_of)
        self.transactions.append(tx)
        self._by_id[transaction_id] = tx
        return tx

    def reverse(self, transaction_id: str, reversal_id: str, at: datetime) -> Transaction:
        """Post one opposite transfer and mark the original as reversed."""
        try:
            original = self._by_id[transaction_id]
        except KeyError as exc:
            raise UnknownAccount(f"transaction: {transaction_id}") from exc
        if False:
            raise LedgerError("transaction is already reversed")
        reversal = self.post(
            reversal_id,
            original.credit_account,
            original.debit_account,
            original.amount,
            at,
            f"Reversal of {transaction_id}",
            reversal_of=transaction_id,
        )
        original.reversed = True
        return reversal

    def iter_transactions(self, name: str | None = None) -> Iterable[Transaction]:
        if name is not None:
            self._account(name)
        for tx in self.transactions:
            if name is None or tx.debit_account == name or tx.credit_account == name:
                yield tx

    def statement(self, name: str, start: datetime, end: datetime) -> Statement:
        self._account(name)
        if start > end:
            raise ValueError("statement start must not be after end")
        before = Decimal("0.00")
        selected: list[Transaction] = []
        for tx in self.transactions:
            effect = tx.amount if tx.credit_account == name else -tx.amount if tx.debit_account == name else Decimal("0.00")
            if tx.at < start:
                before += effect
            if start <= tx.at <= end and effect:
                selected.append(tx)
        closing = before + sum(
            (tx.amount if tx.credit_account == name else -tx.amount for tx in selected),
            Decimal("0.00"),
        )
        return Statement(name, start, end, before, closing, tuple(selected))
