import unittest
from datetime import datetime
from decimal import Decimal

from ledger import Ledger
from ledger.statement import render_text, statement_total


class StatementTests(unittest.TestCase):
    def test_statement_has_period_movement(self):
        ledger = Ledger()
        ledger.create_account("cash")
        ledger.create_account("bank", "1000.00")
        ledger.post("before", "bank", "cash", "10.00", datetime(2024, 1, 1, 9))
        ledger.post("inside", "bank", "cash", "5.00", datetime(2024, 1, 15, 12), "transfer")
        statement = ledger.statement("cash", datetime(2024, 1, 10), datetime(2024, 1, 20))
        self.assertEqual(statement.opening_balance, Decimal("10.00"))
        self.assertEqual(statement.closing_balance, Decimal("15.00"))
        self.assertEqual(statement_total(statement), Decimal("5.00"))
        self.assertIn("transfer", render_text(statement))

    def test_invalid_period_is_rejected(self):
        ledger = Ledger()
        ledger.create_account("cash")
        with self.assertRaises(ValueError):
            ledger.statement("cash", datetime(2024, 2, 1), datetime(2024, 1, 1))
