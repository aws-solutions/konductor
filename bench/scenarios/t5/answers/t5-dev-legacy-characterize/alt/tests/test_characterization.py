# Changes for this request; see the commit message for the reasoning.
import unittest
from datetime import date

from calendar_rules import is_holiday, next_business_day
from cli import main
from formatters import money
from labels import format_label
from rates import RateCalculator, RateRequest, calculate_rate


class LegacyRateCharacterizationTests(unittest.TestCase):
    def test_weight_band_includes_exact_upper_edge(self):
        result = calculate_rate(1, 1.0)
        self.assertEqual(result.weight_band, "letter")
        self.assertEqual(result.total, 4.59)

    def test_unknown_zone_uses_the_fallback_zone(self):
        result = calculate_rate(99, 2.0)
        self.assertEqual(result.zone, 5)
        self.assertEqual(result.total, 13.72)

    def test_fuel_is_combined_before_the_final_round(self):
        result = calculate_rate(1, 5.01, "priority")
        self.assertEqual(result.base, 13.16)
        self.assertEqual(result.fuel, 1.05)
        self.assertEqual(result.total, 14.22)

    def test_leap_day_is_a_holiday_for_pricing(self):
        leap_day = date(2024, 2, 29)
        ordinary_day = date(2024, 3, 1)
        self.assertTrue(is_holiday(leap_day))
        self.assertEqual(calculate_rate(2, 2, ship_date=leap_day).total, 13.18)
        self.assertEqual(calculate_rate(2, 2, ship_date=ordinary_day).total, 9.18)

    def test_zero_weight_is_valid_but_negative_weight_is_not(self):
        self.assertEqual(calculate_rate(1, 0).total, 4.59)
        with self.assertRaises(ValueError):
            calculate_rate(1, -0.01)

    def test_reusable_calculator_resets_surcharge_labels(self):
        calculator = RateCalculator()
        calculator.quote(RateRequest(1, 2, residential=True, remote=True))
        self.assertEqual(calculator.last_surcharges(), ("residential", "remote", "fuel"))
        calculator.quote(RateRequest(1, 2))
        self.assertEqual(calculator.last_surcharges(), ("fuel",))

    def test_next_business_day_moves_one_working_day(self):
        self.assertEqual(next_business_day(date(2024, 1, 2)), date(2024, 1, 3))

    def test_empty_normalized_postal_code_is_rejected(self):
        order = {
            "order_id": "A1",
            "recipient": "A Person",
            "address": "1 Main Street",
            "city": "Austin",
            "postal_code": "!!!",
        }
        with self.assertRaises(ValueError):
            format_label(order)

    def test_cli_returns_error_status_for_bad_weight(self):
        self.assertEqual(main(["rate", "--zone", "1", "--weight", "-1"]), 2)

    def test_money_uses_half_up_for_a_half_cent(self):
        self.assertEqual(money(1.005), "$1.01")


if __name__ == "__main__":
    unittest.main()
