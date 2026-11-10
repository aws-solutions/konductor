import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pricing  # noqa: E402
import report  # noqa: E402


class PricingTest(unittest.TestCase):
    def test_member_light_parcel_ships_free(self):
        self.assertEqual(pricing.shipping_fee(2, True, True), 0)

    def test_heavy_express(self):
        self.assertEqual(pricing.shipping_fee(30, True, False), 40)

    def test_default_discount(self):
        self.assertEqual(pricing.apply_discount(100), 90)

    def test_format_usd(self):
        self.assertEqual(pricing.format_usd(1234567.5), "$1,234,567.50")

    def test_format_eur(self):
        self.assertEqual(pricing.format_eur(1000), "EUR 1,000.00")


class ReportTest(unittest.TestCase):
    def test_summarize(self):
        orders = [
            {"id": "a", "status": "paid", "amount": 20000, "country": "DE"},
            {"id": "b", "status": "paid", "amount": 50, "country": "US"},
            {"id": "c", "status": "refunded", "amount": 30},
            None,
        ]
        self.assertEqual(report.summarize(orders), {"paid": 20050, "refunded": 30, "flagged": ["a"]})


if __name__ == "__main__":
    unittest.main()
