import unittest
from reportjob.database import ReportDatabase
from helpers import sample_database


class DatabaseTests(unittest.TestCase):
    def test_customers_and_orders(self):
        directory, path = sample_database()
        self.addCleanup(directory.cleanup)
        database = ReportDatabase(path)
        self.assertEqual(len(database.customers_with_orders("2024-01")), 3)
        self.assertEqual(database.orders_for_customer(1, "2024-01")[0][0], 1001)
