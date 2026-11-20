import json
from pathlib import Path

from .models import Record


def _record(value):
    if not isinstance(value, dict):
        return None
    endpoint = value.get("endpoint")
    latency = value.get("latency_ms")
    status = value.get("status")
    if (not isinstance(endpoint, str) or not endpoint or
            isinstance(latency, bool) or not isinstance(latency, int) or latency < 0 or
            isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599):
        return None
    return Record(endpoint, latency, status)


def read_records(path):
    """Read all usable records from a plain text export."""
    records = []
    with open(Path(path), "r", encoding="utf-8") as source:
        for line in source:
            try:
                value = json.loads(line)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            record = _record(value)
            if record is not None:
                records.append(record)
    return records
