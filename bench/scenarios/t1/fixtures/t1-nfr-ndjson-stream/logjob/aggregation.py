import math

from .reader import read_records


def _percentile(values, fraction):
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


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
    return {"total_records": len(records), "endpoints": aggregate(records)}
