import unittest

from logjob.aggregation import aggregate_from_stream, EndpointStats
from logjob.models import Record


class TestEndpointStats(unittest.TestCase):
    def test_single_value_percentiles(self):
        stats = EndpointStats()
        stats.add(12, 200)
        self.assertEqual(stats.count, 1)
        self.assertEqual(stats.to_dict()["p50_ms"], 12)
        self.assertEqual(stats.to_dict()["p95_ms"], 12)
    
    def test_multiple_values(self):
        stats = EndpointStats()
        stats.add(10, 200)
        stats.add(20, 200)
        stats.add(30, 500)
        stats.add(40, 200)
        
        result = stats.to_dict()
        self.assertEqual(result["count"], 4)
        self.assertEqual(result["error_count"], 1)
        self.assertEqual(result["p50_ms"], 20)
        self.assertEqual(result["p95_ms"], 40)


class TestPercentileCalculation(unittest.TestCase):
    def test_percentile_with_four_values(self):
        # Values: 5, 15, 50, 100
        stats = EndpointStats()
        stats.add(5, 200)
        stats.add(15, 200)
        stats.add(50, 200)
        stats.add(100, 200)
        
        # rank(0.50 * 4) = ceil(2) = 2 -> value at rank 2 is 15
        self.assertEqual(stats.to_dict()["p50_ms"], 15)
        # rank(0.95 * 4) = ceil(3.8) = 4 -> value at rank 4 is 100
        self.assertEqual(stats.to_dict()["p95_ms"], 100)
    
    def test_percentile_duplicates(self):
        stats = EndpointStats()
        stats.add(10, 200)
        stats.add(10, 200)
        stats.add(20, 200)
        
        # rank(0.50 * 3) = ceil(1.5) = 2 -> value at rank 2 is 10
        self.assertEqual(stats.to_dict()["p50_ms"], 10)
        # rank(0.95 * 3) = ceil(2.85) = 3 -> value at rank 3 is 20
        self.assertEqual(stats.to_dict()["p95_ms"], 20)


class TestAggregateFromStream(unittest.TestCase):
    def test_groups_and_counts(self):
        records = [
            (Record("/a", 10, 200), False),
            (Record("/a", 30, 503), False),
            (Record("/b", 8, 404), False),
        ]
        total, malformed, endpoints = aggregate_from_stream(iter(records))
        
        self.assertEqual(total, 3)
        self.assertEqual(malformed, 0)
        self.assertEqual(endpoints["/a"]["count"], 2)
        self.assertEqual(endpoints["/a"]["error_count"], 1)
        self.assertEqual(endpoints["/b"]["count"], 1)
        self.assertEqual(endpoints["/b"]["p50_ms"], 8)
    
    def test_malformed_counting(self):
        records = [
            (Record("/a", 10, 200), False),
            (None, True),
            (Record("/a", 30, 503), False),
            (None, True),
        ]
        total, malformed, endpoints = aggregate_from_stream(iter(records))
        
        self.assertEqual(total, 2)
        self.assertEqual(malformed, 2)


if __name__ == "__main__":
    unittest.main()
