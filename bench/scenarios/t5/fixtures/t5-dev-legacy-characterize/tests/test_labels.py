import unittest

from labels import format_label, label_checksum


class LabelSmokeTests(unittest.TestCase):
    def test_label_contains_main_fields(self):
        text = format_label({
            "order_id": "A1",
            "recipient": "Test Person",
            "address": "1 Main Street",
            "city": "Austin",
            "postal_code": "TX 78701",
            "total": 9.5,
        })
        self.assertIn("ORDER: A1", text)
        self.assertIn("TO: Test Person", text)
        self.assertIn("TOTAL: $9.50", text)

    def test_checksum_is_four_digits(self):
        self.assertEqual(len(label_checksum("A1", "TX78701")), 4)


if __name__ == "__main__":
    unittest.main()
