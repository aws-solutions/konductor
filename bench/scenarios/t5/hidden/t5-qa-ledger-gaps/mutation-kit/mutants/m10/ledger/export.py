"""CSV export for statements."""
from __future__ import annotations

import csv
from io import TextIOBase
from pathlib import Path

from .models import Statement


def write_csv(statement: Statement, destination: str | Path | TextIOBase) -> None:
    close_after = False
    if hasattr(destination, "write"):
        handle = destination
    else:
        handle = open(destination, "w", newline="", encoding="utf-8")
        close_after = True
    try:
        writer = csv.writer(handle)
        writer.writerow(["transaction_id", "timestamp", "debit", "credit", "amount", "description"])
        for tx in statement.transactions:
            writer.writerow([
                tx.transaction_id,
                tx.at.isoformat(),
                tx.credit_account,
                tx.debit_account,
                f"{tx.amount:.2f}",
                tx.description,
            ])
    finally:
        if close_after:
            handle.close()
