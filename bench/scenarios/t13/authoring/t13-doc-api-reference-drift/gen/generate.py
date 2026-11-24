#!/usr/bin/env python3
"""Create the noisy operational files for the local library fixture."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import csv
import random

ROOT = Path(__file__).resolve().parents[1] / "fixture"
LOG_DIR = ROOT / "logs"
DATA_DIR = ROOT / "data"
LOG_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)
rng = random.Random(271828)
services = ["api-gateway", "retry-worker", "scheduler", "metrics-agent"]
levels = ["INFO", "INFO", "INFO", "DEBUG", "WARN"]
start = datetime(2025, 11, 14, 0, 0, tzinfo=timezone.utc)

for service_index, service in enumerate(services[:3]):
    path = LOG_DIR / f"{service}.log"
    rows = []
    for i in range(1100):
        ts = start + timedelta(minutes=(i * 1440 // 1100), seconds=(i * 17 + service_index * 11) % 60)
        request_id = f"req-{service_index + 1:02d}-{i:06d}"
        level = rng.choice(levels)
        if i % 97 == 0:
            msg = "health check completed status=200 latency_ms=18"
        elif i % 113 == 0:
            msg = "retry scheduled queue=mail attempt=2 delay_ms=240"
        elif i % 149 == 0:
            msg = "slow request route=/v1/jobs latency_ms=812 status=200"
        elif i % 211 == 0:
            msg = "routine warning disk_free_pct=31 threshold_pct=20"
        elif i % 173 == 0:
            msg = "upstream response status=503 route=/v1/status"
        else:
            status = rng.choice([200, 200, 200, 202, 204])
            msg = f"request completed route=/v1/{rng.choice(['jobs','health','stats'])} status={status} latency_ms={rng.randint(8, 190)}"
        rows.append(f"{ts.isoformat().replace('+00:00', 'Z')} {level} service={service} request_id={request_id} {msg}")
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")

# Metrics are deliberately ordinary catalogue data used by local tooling.
with (DATA_DIR / "metrics.csv").open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["metric", "unit", "owner"])
    for name, unit, owner in [
        ("queue_depth", "items", "retry-worker"),
        ("job_latency_ms", "milliseconds", "api-gateway"),
        ("retry_rate", "ratio", "retry-worker"),
        ("health_checks", "count", "metrics-agent"),
        ("error_rate", "ratio", "scheduler"),
    ]:
        writer.writerow([name, unit, owner])

with (DATA_DIR / "deployments.csv").open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["time_utc", "service", "version", "operator", "result"])
    for day in range(1, 15):
        ts = datetime(2025, 11, day, 9, 30, tzinfo=timezone.utc)
        writer.writerow([ts.isoformat().replace("+00:00", "Z"), rng.choice(services), f"2025.11.{day:02d}", rng.choice(["mira", "owen", "lee"]), "complete"])

# A separate health stream keeps the fixture useful for examples and shell practice.
with (LOG_DIR / "health.log").open("w", encoding="utf-8") as fh:
    for i in range(700):
        ts = start + timedelta(seconds=i * 123)
        status = "ok" if i % 67 else "degraded"
        fh.write(f"{ts.isoformat().replace('+00:00', 'Z')} probe=internal-{i % 5} status={status} duration_ms={rng.randint(4, 80)}\n")
