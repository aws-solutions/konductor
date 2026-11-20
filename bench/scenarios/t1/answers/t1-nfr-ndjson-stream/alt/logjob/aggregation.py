"""Memory-efficient aggregation with histogram-based percentiles."""

import math
from typing import Dict, Any

from .reader import stream_records


# Maximum latency value we track (for histogram sizing)
MAX_LATENCY = 60000


class LatencyHistogram:
    """Histogram for computing exact percentiles without storing all values.
    
    Uses counting sort approach: since latencies are bounded integers [0, 60000],
    we can track counts per latency value and compute exact nearest-rank percentiles.
    Uses a list for memory efficiency instead of dict.
    """
    
    def __init__(self):
        # List of counts for each possible latency value (0-60000 inclusive)
        self.counts = [0] * (MAX_LATENCY + 1)
        self.total: int = 0
    
    def add(self, value: int) -> None:
        """Add a latency value to the histogram."""
        self.counts[value] += 1
        self.total += 1
    
    def percentile(self, fraction: float) -> int:
        """Compute exact percentile using nearest-rank method.
        
        Uses formula: rank = max(1, ceil(fraction * n))
        Returns the value at that rank (1-indexed).
        """
        if self.total == 0:
            return 0
        
        rank = max(1, math.ceil(fraction * self.total))
        
        # Walk through histogram to find the value at rank
        cumulative = 0
        for value, count in enumerate(self.counts):
            cumulative += count
            if cumulative >= rank:
                return value
        
        # Should not reach here if data is consistent
        return MAX_LATENCY


class EndpointStats:
    """Statistics collector for a single endpoint."""
    
    def __init__(self):
        self.latency_histogram = LatencyHistogram()
        self.error_count: int = 0
    
    def add(self, latency_ms: int, status: int) -> None:
        """Add a record's latency and status."""
        self.latency_histogram.add(latency_ms)
        if status >= 500:
            self.error_count += 1
    
    @property
    def count(self) -> int:
        return self.latency_histogram.total
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "count": self.count,
            "error_count": self.error_count,
            "p50_ms": self.latency_histogram.percentile(0.50),
            "p95_ms": self.latency_histogram.percentile(0.95),
        }


def aggregate_from_stream(records_iter) -> tuple:
    """Aggregate statistics from a stream of (record, is_malformed) tuples.
    
    Returns (total_records, malformed_count, endpoints_dict).
    Memory-efficient: does not store individual records.
    """
    endpoints: Dict[str, EndpointStats] = {}
    total_records = 0
    malformed_count = 0
    
    for record, is_malformed in records_iter:
        if is_malformed:
            malformed_count += 1
        elif record is not None:
            total_records += 1
            if record.endpoint not in endpoints:
                endpoints[record.endpoint] = EndpointStats()
            endpoints[record.endpoint].add(record.latency_ms, record.status)
    
    # Build sorted output dict
    endpoints_dict = {}
    for endpoint_name in sorted(endpoints.keys()):
        endpoints_dict[endpoint_name] = endpoints[endpoint_name].to_dict()
    
    return total_records, malformed_count, endpoints_dict


def analyze(path):
    """Analyze an NDJSON log file and return summary statistics.
    
    Returns a dict with:
    - total_records: count of valid lines processed
    - malformed_lines: count of invalid lines skipped
    - endpoints: per-endpoint statistics (count, error_count, p50_ms, p95_ms)
    """
    total_records, malformed_count, endpoints = aggregate_from_stream(
        stream_records(path)
    )
    
    return {
        "total_records": total_records,
        "malformed_lines": malformed_count,
        "endpoints": endpoints,
    }
