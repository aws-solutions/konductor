from array import array
from math import ceil

from .reader import MAX_LATENCY_MS, iter_records


class _EndpointStats:
    __slots__ = ("count", "error_count", "histogram")

    def __init__(self):
        self.count = 0
        self.error_count = 0
        self.histogram = array("Q", [0]) * (MAX_LATENCY_MS + 1)

    def observe(self, latency, status):
        self.count += 1
        if status >= 500:
            self.error_count += 1
        self.histogram[latency] += 1

    def percentile(self, fraction):
        rank = max(1, ceil(fraction * self.count))
        seen = 0
        for latency, count in enumerate(self.histogram):
            seen += count
            if seen >= rank:
                return latency
        raise RuntimeError("histogram did not contain the requested rank")


def _summary(stats):
    endpoints = {}
    for endpoint in sorted(stats):
        group = stats[endpoint]
        endpoints[endpoint] = {
            "count": group.count,
            "error_count": group.error_count,
            "p50_ms": group.percentile(0.50),
            "p95_ms": group.percentile(0.95),
        }
    return endpoints


def analyze(path):
    """Aggregate one plain or gzip-compressed NDJSON file in one pass."""
    stats = {}
    total_records = 0
    malformed_lines = 0
    for record in iter_records(path):
        if record is None:
            malformed_lines += 1
            continue
        total_records += 1
        group = stats.get(record.endpoint)
        if group is None:
            group = stats.setdefault(record.endpoint, _EndpointStats())
        group.observe(record.latency_ms, record.status)
    return {
        "total_records": total_records,
        "malformed_lines": malformed_lines,
        "endpoints": _summary(stats),
    }


def aggregate(records):
    """Aggregate an iterable of already validated records for compatibility."""
    stats = {}
    for record in records:
        group = stats.get(record.endpoint)
        if group is None:
            group = stats.setdefault(record.endpoint, _EndpointStats())
        group.observe(record.latency_ms, record.status)
    return _summary(stats)
