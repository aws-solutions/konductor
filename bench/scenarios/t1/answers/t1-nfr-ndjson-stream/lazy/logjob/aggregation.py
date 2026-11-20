import math

from .reader import read_records


def _percentile(values, fraction):
    """Calculate percentile using nearest rank method."""
    if not values:
        return 0
    ordered = sorted(values)
    rank = max(1, math.ceil(fraction * len(ordered)))
    return ordered[rank - 1]


def aggregate(records):
    groups = {}
    for record in records:
        group = groups.setdefault(record.endpoint, {"latencies": [], "error_count": 0})
        group["latencies"].append(record.latency_ms)
        if record.status >= 500:
            group["error_count"] += 1
    endpoints = {}
    for endpoint in sorted(groups):
        group = groups[endpoint]
        endpoints[endpoint] = {
            "count": len(group["latencies"]),
            "error_count": group["error_count"],
            "p50_ms": _percentile(group["latencies"], 0.50),
            "p95_ms": _percentile(group["latencies"], 0.95),
        }
    return endpoints


def analyze(path):
    records = read_records(path)
    return {"total_records": len(records), "malformed_lines": 0, "endpoints": aggregate(records)}
