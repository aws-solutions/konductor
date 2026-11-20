"""Streaming reader for NDJSON log files with validation."""

import gzip
import json
from pathlib import Path
from typing import Iterator, Tuple, Optional

from .models import Record


def _validate_and_create_record(value) -> Optional[Record]:
    """Validate a parsed JSON value and create a Record if valid.
    
    A valid record must be a dict with:
    - endpoint: non-empty string
    - latency_ms: integer in range [0, 60000]
    - status: integer in range [100, 599]
    """
    if not isinstance(value, dict):
        return None
    
    endpoint = value.get("endpoint")
    latency = value.get("latency_ms")
    status = value.get("status")
    
    # Validate endpoint: must be non-empty string
    if not isinstance(endpoint, str) or not endpoint:
        return None
    
    # Validate latency_ms: must be integer (not bool) in valid range
    if isinstance(latency, bool) or not isinstance(latency, int):
        return None
    if latency < 0 or latency > 60000:
        return None
    
    # Validate status: must be integer (not bool) in valid HTTP range
    if isinstance(status, bool) or not isinstance(status, int):
        return None
    if status < 100 or status > 599:
        return None
    
    return Record(endpoint, latency, status)


def stream_records(path) -> Iterator[Tuple[Optional[Record], bool]]:
    """Stream records from an NDJSON file, yielding (record, is_malformed) tuples.
    
    Handles both plain .ndjson and .ndjson.gz files.
    Blank lines count as malformed lines.
    """
    path = Path(path)
    
    # Detect gzip from extension (handles .ndjson.gz)
    if str(path).endswith(".gz"):
        opener = gzip.open
    else:
        opener = open
    
    with opener(path, "rt", encoding="utf-8") as source:
        for line in source:
            stripped = line.strip()
            # Blank lines count as malformed
            if not stripped:
                yield (None, True)
                continue
            
            try:
                value = json.loads(stripped)
            except (json.JSONDecodeError, UnicodeDecodeError):
                # Invalid JSON is malformed
                yield (None, True)
                continue
            
            record = _validate_and_create_record(value)
            if record is not None:
                yield (record, False)
            else:
                # Valid JSON but invalid record structure
                yield (None, True)


def read_records(path):
    """Read all usable records from a plain text or gzipped NDJSON export.
    
    This is kept for backwards compatibility but streams internally.
    """
    records = []
    for record, _ in stream_records(path):
        if record is not None:
            records.append(record)
    return records
