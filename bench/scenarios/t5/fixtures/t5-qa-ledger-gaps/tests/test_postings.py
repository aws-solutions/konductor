import unittest
from datetime import datetime
from decimal import Decimal

from ledger import Ledger, OverdraftExceeded


class PostingTests(unittest.TestCase):
    def setUp(self):
        self.ledger = Ledger()
        self.ledger.create_account("checking", "10.00")
        self.ledger.create_account("savings", "1000.00")

    def test_transfer_updates_both_balances(self):
        self.ledger.post("opening", "savings", "checking", "40.00", datetime(2024, 1, 2), "opening funds")
        self.assertEqual(self.ledger.balance("checking"), Decimal("40.00"))
        self.assertEqual(self.ledger.balance("savings"), Decimal("-40.00"))
        self.assertEqual(len(list(self.ledger.iter_transactions("checking"))), 1)

    def test_rejects_excessive_debit(self):
        with self.assertRaises(OverdraftExceeded):
            self.ledger.post("too-much", "checking", "savings", "10.01", datetime(2024, 1, 2))

    def test_reversal_restores_balance(self):
        self.ledger.post("sale", "savings", "checking", "7.00", datetime(2024, 1, 2))
        self.ledger.reverse("sale", "sale-reversal", datetime(2024, 1, 3))
        self.assertEqual(self.ledger.balance("checking"), Decimal("0.00"))
        self.assertEqual(len(self.ledger.transactions), 2)
