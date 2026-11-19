import unittest
from datetime import datetime
from decimal import Decimal

from ledger import Ledger, apply_monthly_fee


class FeeTests(unittest.TestCase):
    def test_fee_is_charged_to_account(self):
        ledger = Ledger()
        ledger.create_account("checking")
        ledger.create_account("fund", "1000.00")
        ledger.post("deposit", "fund", "checking", "20.00", datetime(2024, 1, 1))
        apply_monthly_fee(ledger, "checking", "2.00", "fee-jan", datetime(2024, 1, 31))
        self.assertEqual(ledger.balance("checking"), Decimal("18.00"))
        self.assertEqual(ledger.balance("FEE_INCOME"), Decimal("2.00"))

    def test_fee_amount_must_be_positive(self):
        ledger = Ledger()
        ledger.create_account("checking")
        with self.assertRaises(ValueError):
            apply_monthly_fee(ledger, "checking", "0", "fee", datetime(2024, 1, 1))
