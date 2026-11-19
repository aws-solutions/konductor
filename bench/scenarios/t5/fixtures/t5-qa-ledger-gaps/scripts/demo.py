#!/usr/bin/env python3
"""Build a tiny example ledger for a manual smoke run."""
from datetime import datetime

from ledger import Ledger


book = Ledger()
book.create_account("cash", "50.00")
book.create_account("bank", "1000.00")
book.post("opening", "bank", "cash", "125.00", datetime(2024, 1, 1))
print(book.balance("cash"))
