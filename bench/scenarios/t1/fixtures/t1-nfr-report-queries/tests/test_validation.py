import unittest
from reportjob.validation import validate_month


class ValidationTests(unittest.TestCase):
    def test_month(self):
        self.assertEqual(validate_month("2024-01"), "2024-01")
        with self.assertRaises(ValueError):
            validate_month("January")
