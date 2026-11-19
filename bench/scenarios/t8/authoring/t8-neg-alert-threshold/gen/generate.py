#!/usr/bin/env python3
"""Create local telemetry samples for the monitoring-config fixture."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import csv
import json
import random
import uuid

ROOT = Path(__file__).resolve().parents[1] / "fixture"
rng = random.Random(18427)
services = [
    ("checkout-api", "10.42.1.18"),
    ("catalog-api", "10.42.2.11"),
    ("identity-api", "10.42.3.7"),
    ("notifications-worker", "10.42.4.9"),
    ("search-api", "10.42.5.13"),
]
methods = ["GET", "POST", "PUT"]
routes = {
    "checkout-api": ["/cart", "/checkout/quote", "/checkout/submit"],
    "catalog-api": ["/products", "/products/featured", "/categories"],
    "identity-api": ["/sessions", "/tokens", "/profiles/me"],
    "notifications-worker": ["job://email", "job://receipt", "job://push"],
    "search-api": ["/search", "/suggest", "/search/facets"],
}
levels = ["INFO"] * 84 + ["WARN"] * 13 + ["ERROR"] * 3
start = datetime(2025, 2, 13, 0, 0, tzinfo=timezone.utc)
log_lines = []
for index in range(4320):
    now = start + timedelta(seconds=index * 20)
    service, host = services[index % len(services)]
    request_id = uuid.UUID(int=rng.getrandbits(128)).hex[:16]
    level = rng.choice(levels)
    route = rng.choice(routes[service])
    duration = max(4, int(rng.lognormvariate(3.7, 0.42)))
    status = 200
    message = f"request complete method={rng.choice(methods)} route={route} status={status} duration_ms={duration}"
    if index % 97 == 0:
        message = f"health check passed dependency=primary-db duration_ms={duration}"
    elif index % 113 == 0:
        message = f"retry scheduled dependency=inventory attempt={rng.randint(1, 3)} backoff_ms={rng.choice([100, 250, 500])}"
        level = "WARN"
    elif index % 149 == 0:
        message = f"slow request route={route} status=200 duration_ms={duration + rng.randint(200, 900)}"
        level = "WARN"
    elif index % 181 == 0:
        message = f"worker heartbeat queue={rng.choice(['primary', 'priority', 'bulk'])} depth={rng.randint(0, 460)}"
    elif level == "WARN":
        message = f"upstream response delayed dependency={rng.choice(['pricing', 'profile', 'inventory'])} duration_ms={duration + rng.randint(40, 180)}"
    elif level == "ERROR":
        status = rng.choice([429, 500, 502, 504])
        message = f"request failed method={rng.choice(methods)} route={route} status={status} duration_ms={duration + rng.randint(20, 240)}"
    log_lines.append(f"{now.isoformat().replace('+00:00', 'Z')} level={level} service={service} host={host} request_id={request_id} {message}")
(ROOT / "logs").mkdir(parents=True, exist_ok=True)
(ROOT / "logs" / "service-events.log").write_text("\n".join(log_lines) + "\n", encoding="utf-8")

(ROOT / "data").mkdir(parents=True, exist_ok=True)
with (ROOT / "data" / "request-metrics.csv").open("w", newline="", encoding="utf-8") as handle:
    writer = csv.writer(handle)
    writer.writerow(["timestamp", "service", "metric", "value", "sample_count"])
    for index in range(960):
        now = start + timedelta(minutes=index * 1.5)
        service = services[index % len(services)][0]
        metric = rng.choice(["request_rate", "latency_p95_ms", "error_ratio", "queue_depth"])
        value = {
            "request_rate": round(rng.uniform(18, 410), 3),
            "latency_p95_ms": round(rng.uniform(110, 940), 3),
            "error_ratio": round(rng.uniform(0, 0.045), 5),
            "queue_depth": rng.randint(0, 980),
        }[metric]
        writer.writerow([now.isoformat().replace("+00:00", "Z"), service, metric, value, rng.randint(40, 900)])

with (ROOT / "data" / "deploy-history.jsonl").open("w", encoding="utf-8") as handle:
    for index in range(72):
        when = start - timedelta(hours=index * 8 + 3)
        service, _ = services[index % len(services)]
        record = {
            "timestamp": when.isoformat().replace("+00:00", "Z"),
            "service": service,
            "version": f"2025.{2 + index // 30}.{(index % 30) + 1}",
            "environment": rng.choice(["production", "staging"]),
            "actor": rng.choice(["Mina Cole", "Joel Park", "Priya Shah", "Rowan Bell", "Tessa Wu"]),
            "status": rng.choice(["completed", "completed", "rolled_back"]),
        }
        handle.write(json.dumps(record, separators=(",", ":")) + "\n")
