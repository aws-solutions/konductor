import gzip
import json
from contextlib import contextmanager
from pathlib import Path

from .models import Record

MAX_LATENCY_MS = 60000


def _record(value):
    if not isinstance(value, dict):
        return None
    endpoint = value.get("endpoint")
    latency = value.get("latency_ms")
    status = value.get("status")
    if (not isinstance(endpoint, str) or not endpoint or
            isinstance(latency, bool) or not isinstance(latency, int) or not 0 <= latency <= MAX_LATENCY_MS or
            isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599):
        return None
    return Record(endpoint, latency, status)


@contextmanager
def _open_input(path):
    path = Path(path)
    if path.name.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as source:
            yield source
    else:
        with open(path, "r", encoding="utf-8") as source:
            yield source


def iter_records(path):
    """Yield a Record for each valid line and None for each malformed line."""
    with _open_input(path) as source:
        for line in source:
            try:
                value = json.loads(line)
            except (json.JSONDecodeError, UnicodeDecodeError):
                yield None
                continue
            yield _record(value)


def read_records(path):
    """Compatibility helper for callers that need a list of valid records."""
    return [record for record in iter_records(path) if record is not None]
