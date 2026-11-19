"""Output formatters."""

import csv
import json
import sys
from collections.abc import Iterable
from pathlib import Path

FIELDS = ("customer_id", "customer_name", "email", "order_id", "order_date", "total_cents")


def _open_output(output: str | Path):
    if str(output) == "-":
        return sys.stdout, False
    return open(output, "w", encoding="utf-8", newline=""), True


def write_csv(rows: Iterable[dict[str, object]], output: str | Path) -> None:
    stream, should_close = _open_output(output)
    try:
        writer = csv.DictWriter(stream, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(list(rows))
    finally:
        if should_close:
            stream.close()


def write_json(rows: Iterable[dict[str, object]], output: str | Path) -> None:
    stream, should_close = _open_output(output)
    try:
        json.dump(list(rows), stream, ensure_ascii=False, separators=(",", ":"))
        stream.write("\n")
    finally:
        if should_close:
            stream.close()
