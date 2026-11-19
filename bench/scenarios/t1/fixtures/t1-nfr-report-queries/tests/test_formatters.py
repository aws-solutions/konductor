import tempfile
import unittest
from pathlib import Path
from reportjob.formatters import write_csv, write_json


class FormatterTests(unittest.TestCase):
    def test_writers(self):
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "out.csv"
            json_path = Path(directory) / "out.json"
            rows = [{"customer_id": 1, "customer_name": "A", "email": "a@x", "order_id": 2, "order_date": "2024-01-01", "total_cents": 3}]
            write_csv(rows, csv_path)
            write_json(rows, json_path)
            self.assertIn("customer_name", csv_path.read_text())
            self.assertIn('"order_id":2', json_path.read_text())
