import csv
import io
import unittest
from datetime import datetime

from ledger import Ledger
from ledger.export import write_csv


class ExportTests(unittest.TestCase):
    def test_csv_contains_header_and_rows(self):
        ledger = Ledger()
        ledger.create_account("cash")
        ledger.create_account("bank", "1000.00")
        ledger.post("deposit", "bank", "cash", "12.50", datetime(2024, 1, 1), "cash in")
        statement = ledger.statement("cash", datetime(2024, 1, 1), datetime(2024, 1, 2))
        output = io.StringIO()
        write_csv(statement, output)
        rows = list(csv.reader(io.StringIO(output.getvalue())))
        self.assertEqual(rows[0][0], "transaction_id")
        self.assertEqual(rows[1][0], "deposit")
        self.assertEqual(rows[1][4], "12.50")
