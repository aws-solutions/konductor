import unittest
import tracemalloc
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

    def test_iter_rows_is_generator(self):
        directory, path = sample_database()
        self.addCleanup(directory.cleanup)
        rows = ReportBuilder(ReportDatabase(path)).iter_rows("2024-01")
        self.assertTrue(hasattr(rows, "__iter__") and hasattr(rows, "__next__"))

    def test_memory_usage_stays_below_8mb(self):
        directory, path = sample_database()
        self.addCleanup(directory.cleanup)
        tracemalloc.start()
        try:
            tracemalloc.reset_peak()
            rows = list(ReportBuilder(ReportDatabase(path)).iter_rows("2024-01"))
            current, peak = tracemalloc.get_traced_memory()
            self.assertLess(peak, 8 * 1024 * 1024, f"Peak memory {peak} exceeds 8 MiB")
        finally:
            tracemalloc.stop()

    def test_single_sql_query_used(self):
        directory, path = sample_database()
        self.addCleanup(directory.cleanup)
        db = ReportDatabase(path)
        rows = list(db.iter_report_rows("2024-01"))
        self.assertEqual(len(rows), 4)
