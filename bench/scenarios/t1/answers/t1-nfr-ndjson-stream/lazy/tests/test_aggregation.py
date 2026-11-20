import unittest

from logjob.aggregation import aggregate, _percentile
from logjob.models import Record


class AggregationTests(unittest.TestCase):
    def test_groups_and_counts_server_errors(self):
        result = aggregate([
            Record("/a", 10, 200),
            Record("/a", 30, 503),
            Record("/b", 8, 404),
        ])
        self.assertEqual(result["/a"]["count"], 2)
        self.assertEqual(result["/a"]["error_count"], 1)
        self.assertEqual(result["/b"]["p50_ms"], 8)

    def test_single_value_has_both_percentiles(self):
        result = aggregate([Record("/a", 12, 200)])
        self.assertEqual(result["/a"]["p50_ms"], 12)
        self.assertEqual(result["/a"]["p95_ms"], 12)

    def test_percentile_nearest_rank(self):
        values = [5, 15, 50, 100]
        self.assertEqual(_percentile(values, 0.50), 15)
        self.assertEqual(_percentile(values, 0.95), 100)
