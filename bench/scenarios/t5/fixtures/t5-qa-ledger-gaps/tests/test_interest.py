import unittest
from datetime import datetime
from decimal import Decimal

from ledger import Ledger, accrue_interest, calculate_interest


class InterestTests(unittest.TestCase):
    def test_full_year_interest_is_posted(self):
        ledger = Ledger()
        ledger.create_account("savings", "1000.00")
        ledger.create_account("fund", "1000.00")
        ledger.post("deposit", "fund", "savings", "100.00", datetime(2024, 1, 1))
        tx = accrue_interest(ledger, "savings", "0.01", 365, "interest-1", datetime(2025, 1, 1))
        self.assertIsNotNone(tx)
        self.assertEqual(ledger.balance("savings"), Decimal("101.00"))

    def test_zero_days_produces_no_entry(self):
        ledger = Ledger()
        ledger.create_account("savings", "1000.00")
        self.assertIsNone(accrue_interest(ledger, "savings", "0.10", 0, "none", datetime(2024, 1, 1)))

    def test_calculation_is_decimal(self):
        self.assertEqual(calculate_interest(Decimal("100"), "0.01", 365), Decimal("1.00"))
