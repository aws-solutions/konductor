import unittest

from rates import calculate_rate, compare_services, summarize


class RateSmokeTests(unittest.TestCase):
    def test_basic_quote_has_expected_shape(self):
        result = calculate_rate(1, 0.5)
        self.assertEqual(result.zone, 1)
        self.assertEqual(result.weight_band, "letter")
        self.assertEqual(result.service, "ground")
        self.assertGreater(result.total, 0)
        self.assertEqual(result.currency, "USD")

    def test_service_prices_are_ordered(self):
        prices = compare_services(2, 2)
        self.assertLess(prices["ground"].total, prices["priority"].total)
        self.assertLess(prices["priority"].total, prices["overnight"].total)

    def test_summary_for_empty_input(self):
        self.assertEqual(summarize([]), {"count": 0.0, "total": 0.0, "average": 0.0})


if __name__ == "__main__":
    unittest.main()
