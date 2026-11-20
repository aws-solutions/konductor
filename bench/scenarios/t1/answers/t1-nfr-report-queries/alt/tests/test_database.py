import unittest
import sqlite3
import tempfile
from pathlib import Path
from reportjob.database import ReportDatabase
from helpers import sample_database


class DatabaseTests(unittest.TestCase):
    def test_customers_and_orders(self):
        directory, path = sample_database()
        self.addCleanup(directory.cleanup)
        database = ReportDatabase(path)
        self.assertEqual(len(database.customers_with_orders("2024-01")), 3)
        self.assertEqual(database.orders_for_customer(1, "2024-01")[0][0], 1001)

    def test_accepts_external_connection(self):
        directory, path = sample_database()
        self.addCleanup(directory.cleanup)
        with sqlite3.connect(path) as conn:
            database = ReportDatabase(connection=conn)
            rows = list(database.iter_report_rows("2024-01"))
            self.assertEqual(len(rows), 4)

    def test_connection_parameter_required(self):
        with self.assertRaises(ValueError):
            ReportDatabase()
