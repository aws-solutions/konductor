#!/usr/bin/env python3
"""Create the routine operational data kept with the example repository."""
from __future__ import annotations

import csv
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixture"
RANDOM = random.Random(731904)
SERVICES = [
    "api-gateway",
    "billing-worker",
    "catalog",
    "email-dispatch",
    "inventory",
    "media-proxy",
    "orders",
    "search-indexer",
    "user-profile",
]
REQUEST_IDS = [f"req-{RANDOM.getrandbits(48):012x}" for _ in range(4200)]


def timestamp(start: datetime, seconds: int) -> str:
    return (start + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")


def make_logs() -> None:
    start = datetime(2025, 2, 14, 0, 0, tzinfo=timezone.utc)
    lines: list[str] = []
    for index in range(3600):
        service = SERVICES[index % len(SERVICES)]
        request_id = REQUEST_IDS[index]
        stamp = timestamp(start, index * 24)
        roll = RANDOM.random()
        if index % 19 == 0:
            line = f"{stamp} WARN service={service} request_id={request_id} retry=1 upstream=profile-store reason=deadline_exceeded"
        elif index % 47 == 0:
            line = f"{stamp} WARN service={service} request_id={request_id} healthcheck=dependency latency_ms={180 + index % 90} status=degraded"
        elif index % 83 == 0:
            line = f"{stamp} ERROR service={service} request_id={request_id} operation=refresh-cache error=temporary_backend_failure retryable=true"
        elif index % 31 == 0:
            line = f"{stamp} INFO service={service} request_id={request_id} route=/v1/items latency_ms={420 + index % 160} status=200 slow_request=true"
        elif roll < 0.08:
            line = f"{stamp} INFO service={service} request_id={request_id} event=healthcheck status=200 latency_ms={12 + index % 21}"
        else:
            line = f"{stamp} INFO service={service} request_id={request_id} operation=request_complete status=200 latency_ms={8 + index % 74}"
        lines.append(line)
    path = ROOT / "logs" / "platform.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def make_metrics() -> None:
    start = datetime(2025, 2, 14, 0, 0, tzinfo=timezone.utc)
    path = ROOT / "data" / "request-metrics.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["timestamp", "service", "requests", "errors", "p95_ms", "cpu_percent"])
        for minute in range(1440):
            for offset, service in enumerate(SERVICES[::2]):
                requests = 120 + (minute * 7 + offset * 23) % 410
                errors = (minute + offset * 3) % 5
                p95 = 38 + (minute * 11 + offset * 17) % 190
                cpu = 18.0 + ((minute * 13 + offset * 9) % 520) / 10
                writer.writerow([timestamp(start, minute * 60), service, requests, errors, p95, f"{cpu:.1f}"])


def make_deploy_history() -> None:
    start = datetime(2025, 1, 2, 9, 30, tzinfo=timezone.utc)
    path = ROOT / "data" / "deploy-history.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    environments = ["development", "staging", "production"]
    with path.open("w", encoding="utf-8") as handle:
        for index in range(144):
            service = SERVICES[index % len(SERVICES)]
            record = {
                "at": timestamp(start, index * 8173),
                "service": service,
                "environment": environments[index % len(environments)],
                "version": f"2025.{1 + index // 45}.{index % 18}",
                "duration_seconds": 42 + (index * 13) % 185,
                "status": "completed" if index % 23 else "rolled_back",
                "operator": ["mira", "devon", "sanjay", "lena"][index % 4],
            }
            handle.write(json.dumps(record, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    make_logs()
    make_metrics()
    make_deploy_history()
