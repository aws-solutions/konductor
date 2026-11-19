# Pocket Ledger

Pocket Ledger is a small standard-library bookkeeping library. It keeps balanced transfers in memory and can produce a period statement or CSV export.

## Quick start

```python
from datetime import datetime
from ledger import Ledger

book = Ledger()
book.create_account("cash", "50.00")
book.create_account("bank", "1000.00")
book.post("opening", "bank", "cash", "125.00", datetime(2024, 1, 1))
print(book.balance("cash"))
```

Amounts are `Decimal` values or decimal strings. A debit reduces an account and a credit increases it. Posting the same transaction id again returns the original transaction without adding another row. Statement endpoints are included.

Run the tests from the project root:

```text
python3 -m unittest discover -s tests
```

The command line preview is available with `python3 -m ledger.cli cash --start 2024-01-01T00:00:00 --end 2024-01-31T23:59:59`.
