import unittest
from reportjob.database import ReportDatabase
from reportjob.report import ReportBuilder
from helpers import sample_database


class ReportTests(unittest.TestCase):
    def test_january_rows(self):
        directory, path = sample_database()
        self.addCleanup(directory.cleanup)
        rows = ReportBuilder(ReportDatabase(path)).build("2024-01")
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0]["customer_name"], "Ada Lovelace")

    def test_empty_month(self):
        directory, path = sample_database()
        self.addCleanup(directory.cleanup)
        self.assertEqual(ReportBuilder(ReportDatabase(path)).build("2025-01"), [])

    def test_iter_rows_is_iterator(self):
        directory, path = sample_database()
        self.addCleanup(directory.cleanup)
        rows = ReportBuilder(ReportDatabase(path)).iter_rows("2024-01")
        self.assertTrue(hasattr(rows, "__iter__") and hasattr(rows, "__next__"))
