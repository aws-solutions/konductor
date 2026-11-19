#!/usr/bin/env python3
"""Generate deterministic production evidence for the order-sync fixture."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import csv
import json
import random

ROOT = Path(__file__).resolve().parents[1] / "fixture"
OUT = ROOT / "ops"
RNG = random.Random(18473)
UTC = timezone.utc
START = datetime(2025, 3, 18, tzinfo=UTC)


def stamp(value):
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, separators=(",", ":")) + "\n")


def worker_logs():
    rows = []
    for index in range(1920):
        at = START + timedelta(seconds=index * 45)
        service = ["order-sync", "queue-consumer", "partner-health"][index % 3]
        request_id = f"req-{index + 1:06d}"
        if service == "order-sync":
            if index % 113 == 0:
                rows.append({"ts": stamp(at), "level": "warn", "service": service, "requestId": request_id, "event": "slow_request", "status": 201, "durationMs": 640 + index % 90})
            else:
                rows.append({"ts": stamp(at), "level": "info", "service": service, "requestId": request_id, "event": "order_sent", "status": 201, "durationMs": 38 + (index * 17) % 91})
        elif service == "queue-consumer":
            if index % 149 == 0:
                rows.append({"ts": stamp(at), "level": "warn", "service": service, "event": "poll_lag", "received": index % 5, "depth": 18 + (index * 11) % 64})
            else:
                rows.append({"ts": stamp(at), "level": "info", "service": service, "event": "queue_poll", "received": index % 5, "depth": 18 + (index * 11) % 64})
        else:
            rows.append({"ts": stamp(at), "level": "info", "service": service, "event": "health_probe", "status": 200, "durationMs": 22 + index % 29})
    incident_start = START + timedelta(hours=2, minutes=12)
    for minute in range(55):
        base = incident_start + timedelta(minutes=minute)
        for batch in range(19 if minute < 45 else 12):
            request_id = f"inc-{minute:02d}-{batch:03d}"
            primary = base + timedelta(seconds=batch * 3)
            status = 429 if (minute + batch) % 4 == 0 else 503
            retry_after = "2" if status == 429 else "3"
            rows.append({"ts": stamp(primary), "level": "warn", "service": "order-sync", "requestId": request_id, "event": "partner_response", "attempt": 1, "status": status, "retryAfter": retry_after, "durationMs": 812 + (batch * 41) % 690})
            for attempt in range(2, 5):
                # The close timestamps are the evidence; the client should have spaced these calls.
                retry_at = primary + timedelta(milliseconds=attempt - 1)
                rows.append({"ts": stamp(retry_at), "level": "warn", "service": "order-sync", "requestId": request_id, "event": "partner_response", "attempt": attempt, "status": status, "retryAfter": retry_after, "durationMs": 3 + attempt})
        rows.append({"ts": stamp(base + timedelta(seconds=59)), "level": "info", "service": "queue-consumer", "event": "queue_depth", "depth": 240 + minute * 27})
    rows.sort(key=lambda row: row["ts"])
    write_jsonl(OUT / "logs" / "worker-2025-03-18.log", rows)


def partner_logs():
    rows = []
    for index in range(900):
        at = START + timedelta(seconds=index * 96)
        if datetime(2025, 3, 18, 2, 12, tzinfo=UTC) <= at < datetime(2025, 3, 18, 3, 7, tzinfo=UTC):
            status = 429 if index % 5 == 0 else 503
            rows.append({"ts": stamp(at), "level": "warn", "service": "partner-gateway", "event": "upstream_reply", "route": "/v1/orders", "status": status, "active": 412 + index % 37})
        else:
            rows.append({"ts": stamp(at), "level": "info", "service": "partner-gateway", "event": "upstream_reply", "route": "/v1/orders", "status": 201, "active": 104 + index % 31})
    write_jsonl(OUT / "logs" / "partner-gateway-2025-03-18.log", rows)


def audit_logs():
    rows = []
    for index in range(700):
        at = START + timedelta(seconds=index * 123)
        rows.append({"ts": stamp(at), "level": "info" if index % 17 else "debug", "service": "ops-audit", "event": ["config_read", "lease_renewed", "metric_flush"][index % 3], "node": f"sync-{1 + index % 6}"})
    write_jsonl(OUT / "logs" / "ops-audit-2025-03-18.log", rows)


def metrics():
    path = OUT / "metrics" / "partner-minute.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["timestamp", "partner_requests", "http_429", "http_503", "retries", "queue_depth", "rate_limiter_waits", "circuit_open"]
    incident_start = 132
    incident_end = 187
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for minute in range(1440):
            at = START + timedelta(minutes=minute)
            if incident_start <= minute <= incident_end:
                requests = 86 + (minute * 7) % 35
                bad429 = requests // 7
                bad503 = requests // 4
                retries = bad429 + bad503 + 8
                depth = 240 + (minute - incident_start) * 27
                waits = 0
                open_state = 1 if minute >= 137 else 0
            else:
                requests = 31 + (minute * 5) % 28
                bad429 = 0 if minute % 97 else 1
                bad503 = 0 if minute % 131 else 1
                retries = bad429 + bad503
                depth = 12 + (minute * 13) % 78
                waits = 1 if minute % 43 == 0 else 0
                open_state = 0
            writer.writerow({"timestamp": stamp(at), "partner_requests": requests, "http_429": bad429, "http_503": bad503, "retries": retries, "queue_depth": depth, "rate_limiter_waits": waits, "circuit_open": open_state})


def queue_metrics():
    path = OUT / "metrics" / "queue-minute.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["timestamp", "enqueued", "completed", "depth"])
        for minute in range(1440):
            at = START + timedelta(minutes=minute)
            incident = 132 <= minute <= 187
            enqueued = 35 + minute % 13 + (70 if incident else 0)
            completed = 34 + (minute * 3) % 12 - (40 if incident else 0)
            depth = 20 + minute % 40 + (max(0, minute - 131) * 25 if incident else 0)
            writer.writerow([stamp(at), enqueued, max(0, completed), depth])


if __name__ == "__main__":
    worker_logs()
    partner_logs()
    audit_logs()
    metrics()
    queue_metrics()
