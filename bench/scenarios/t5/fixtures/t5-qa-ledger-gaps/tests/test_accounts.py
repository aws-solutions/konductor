import unittest
from decimal import Decimal

from ledger import Ledger, LedgerError


class AccountTests(unittest.TestCase):
    def test_accounts_keep_limits(self):
        ledger = Ledger()
        account = ledger.create_account("cash", "25.00")
        self.assertEqual(account.name, "cash")
        self.assertEqual(account.overdraft_limit, Decimal("25.00"))
        self.assertEqual(ledger.balance("cash"), Decimal("0.00"))

    def test_duplicate_and_bad_limits_are_rejected(self):
        ledger = Ledger()
        ledger.create_account("cash")
        with self.assertRaises(LedgerError):
            ledger.create_account("cash")
        with self.assertRaises(ValueError):
            ledger.create_account("bad", "-1")
