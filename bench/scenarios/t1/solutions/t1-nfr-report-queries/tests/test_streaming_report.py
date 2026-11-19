import inspect
import sqlite3
import unittest
from reportjob.database import ReportDatabase
from reportjob.report import ReportBuilder


class StreamingReportTests(unittest.TestCase):
    def test_report_rows_are_a_generator(self):
        with sqlite3.connect(":memory:") as connection:
            connection.executescript("CREATE TABLE customers(id INTEGER, name TEXT, email TEXT); CREATE TABLE orders(id INTEGER, customer_id INTEGER, order_date TEXT, total_cents INTEGER);")
            rows = ReportBuilder(ReportDatabase(":memory:", connection=connection)).iter_rows("2024-01")
            self.assertTrue(inspect.isgenerator(rows))
