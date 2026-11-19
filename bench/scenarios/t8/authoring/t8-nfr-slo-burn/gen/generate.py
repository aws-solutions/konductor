#!/usr/bin/env python3
"""Create the sampled traffic and operational logs for the payments API fixture."""
from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixture"
SEED = 20250314
rng = random.Random(SEED)
START = datetime(2025, 4, 1, tzinfo=timezone.utc)
MINUTES = 28 * 24 * 60
BAD_DATE = datetime(2025, 4, 14, tzinfo=timezone.utc).date()


def ensure_dirs() -> None:
    for name in ("data", "logs", "deploys"):
        (ROOT / name).mkdir(parents=True, exist_ok=True)


def write_metrics() -> None:
    rows = [
        ("payments_api_requests_total", "counter", "traffic_class,status_class", "All API requests accepted by the edge"),
        ("payments_api_requests_success_total", "counter", "traffic_class", "Requests completed with a 2xx response"),
        ("payments_api_requests_good_total", "counter", "traffic_class", "Requests completed with a 2xx or 4xx response"),
        ("payments_api_requests_client_error_total", "counter", "traffic_class", "Requests completed with a 4xx response"),
        ("payments_api_requests_server_error_total", "counter", "traffic_class", "Requests completed with a 5xx response"),
        ("payments_api_request_duration_ms_count", "counter", "traffic_class", "Requests included in the API latency histogram"),
        ("payments_api_request_duration_ms_under_800_total", "counter", "traffic_class", "Requests at or below 800 milliseconds"),
        ("payments_api_request_duration_ms_under_1200_total", "counter", "traffic_class", "Requests at or below 1200 milliseconds"),
        ("payments_api_request_duration_ms_bucket", "histogram", "traffic_class,le", "API request duration histogram buckets"),
        ("payments_api_cpu_utilization_ratio", "gauge", "service", "Process CPU utilization ratio"),
        ("payments_api_memory_working_set_bytes", "gauge", "service", "Working set memory"),
        ("payments_api_dependency_pool_in_use", "gauge", "service", "Card-network connection pool slots in use"),
        ("payments_api_dependency_pool_wait_total", "counter", "service", "Requests that waited for a card-network connection"),
        ("payments_api_retry_total", "counter", "service", "Retries issued to the card-network client"),
        ("payments_api_healthcheck_total", "counter", "traffic_class", "Load-balancer and health-check requests"),
        ("payments_api_synthetic_total", "counter", "traffic_class", "Synthetic checkout probes"),
    ]
    with (ROOT / "metrics" / "catalogue.csv").open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(("metric", "kind", "labels", "meaning"))
        writer.writerows(rows)


def traffic_row(stamp: datetime, traffic: str, minute_index: int) -> dict[str, int | str]:
    day = stamp.date()
    bad = day == BAD_DATE
    hour = stamp.hour
    wave = 1.0 + 0.16 * (1 + ((hour - 12) % 24) / 24.0)
    if traffic == "real_user":
        total = int(820 * wave + rng.randint(-45, 45))
        failure_rate = 0.00014
        if bad:
            failure_rate = 0.0105 if 15 <= hour <= 15 else 0.0062
        server_errors = max(0, int(total * failure_rate + rng.random() * 0.8))
        client_errors = max(0, int(total * 0.0016 + rng.random() * 1.2))
        success = max(0, total - server_errors - client_errors)
        if bad and 15 <= hour <= 15:
            slow_share = 0.22
        elif bad:
            slow_share = 0.055
        else:
            slow_share = 0.011 + (0.004 if hour in (8, 9, 17, 18) else 0)
        over_800 = int(total * slow_share + rng.random() * 1.5)
        under_100 = int((total - over_800) * 0.58)
        between_100_300 = int((total - over_800) * 0.34)
        between_300_800 = total - over_800 - under_100 - between_100_300
    elif traffic == "synthetic":
        total = int(3200 + rng.randint(-120, 120))
        server_errors = 0
        client_errors = int(total * 0.0003)
        success = total - client_errors
        over_800 = int(total * (0.0006 if not bad else 0.0012))
        under_100 = int((total - over_800) * 0.84)
        between_100_300 = int((total - over_800) * 0.15)
        between_300_800 = total - over_800 - under_100 - between_100_300
    else:
        total = int(180 + rng.randint(-15, 15))
        server_errors = 0
        client_errors = 0
        success = total
        over_800 = 0
        under_100 = total
        between_100_300 = 0
        between_300_800 = 0
    return {
        "timestamp": stamp.isoformat().replace("+00:00", "Z"),
        "traffic_class": traffic,
        "total_requests": total,
        "status_2xx": success,
        "status_4xx": client_errors,
        "status_5xx": server_errors,
        "latency_le_100ms": under_100,
        "latency_101_300ms": between_100_300,
        "latency_301_800ms": between_300_800,
        "latency_801_1200ms": int(over_800 * 0.60),
        "latency_1201_2000ms": int(over_800 * 0.35),
        "latency_gt_2000ms": over_800 - int(over_800 * 0.60) - int(over_800 * 0.35),
    }


def write_traffic() -> None:
    path = ROOT / "data" / "request-minute.csv"
    fields = ["timestamp", "traffic_class", "total_requests", "status_2xx", "status_4xx", "status_5xx", "latency_le_100ms", "latency_101_300ms", "latency_301_800ms", "latency_801_1200ms", "latency_1201_2000ms", "latency_gt_2000ms"]
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for i in range(MINUTES):
            stamp = START + timedelta(minutes=i)
            for traffic in ("real_user", "synthetic", "health_check"):
                writer.writerow(traffic_row(stamp, traffic, i))


def iso(stamp: datetime) -> str:
    return stamp.isoformat().replace("+00:00", "Z")


def write_deploys() -> None:
    rows = [
        ("2025-04-02T09:20:00Z", "payments-api", "release-2025.04.02.1", "routine dependency client refresh", "owner=checkout"),
        ("2025-04-07T16:10:00Z", "payments-api", "release-2025.04.07.2", "add card authorization retry telemetry", "owner=checkout"),
        ("2025-04-12T11:05:00Z", "payments-worker", "release-2025.04.12.1", "batch reconciliation tuning", "owner=ledger"),
        ("2025-04-14T14:54:00Z", "payments-api", "release-2025.04.14.3", "pool_max 64 to 24; client timeout settings", "owner=checkout"),
        ("2025-04-14T16:02:00Z", "payments-api", "release-2025.04.14.4", "restore prior client settings", "owner=checkout"),
        ("2025-04-18T10:30:00Z", "payments-api", "release-2025.04.18.1", "structured request logging", "owner=checkout"),
        ("2025-04-23T13:40:00Z", "payments-worker", "release-2025.04.23.2", "settlement retry backoff", "owner=ledger"),
        ("2025-04-27T08:15:00Z", "payments-api", "release-2025.04.27.1", "dependency client patch update", "owner=checkout"),
    ]
    with (ROOT / "deploys" / "history.csv").open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(("time", "service", "release", "summary", "labels"))
        writer.writerows(rows)


def api_line(stamp: datetime, seq: int) -> str:
    bad = stamp.date() == BAD_DATE and 15 <= stamp.hour <= 15
    req = f"req-{stamp.strftime('%m%d%H%M')}-{seq:05d}"
    if seq % 17 == 0:
        return f"{iso(stamp)} INFO payments-api request_id={req} route=/healthz traffic=health_check status=200 latency_ms={12 + seq % 9}"
    if seq % 23 == 0:
        return f"{iso(stamp)} WARN payments-api request_id={req} route=/v1/charge retry=1 reason=upstream_reset status=502 latency_ms={680 + seq % 260}"
    if bad and seq % 7 == 0:
        return f"{iso(stamp)} ERROR payments-api request_id={req} route=/v1/charge dependency=card-network pool_wait_ms={2100 + seq % 800} status=504 latency_ms={2600 + seq % 1000}"
    if seq % 31 == 0:
        return f"{iso(stamp)} WARN payments-api request_id={req} route=/v1/charge status=200 latency_ms={840 + seq % 140} cache=miss"
    return f"{iso(stamp)} INFO payments-api request_id={req} route=/v1/charge status=200 latency_ms={95 + seq % 390}"


def dependency_line(stamp: datetime, seq: int) -> str:
    bad = stamp.date() == BAD_DATE and 15 <= stamp.hour <= 15
    req = f"dep-{stamp.strftime('%m%d%H%M')}-{seq:04d}"
    if bad and seq % 5 == 0:
        return f"{iso(stamp)} WARN card-client request_id={req} operation=authorize pool=in_use waiters={4 + seq % 7} wait_ms={900 + seq % 700} upstream=card-network"
    if seq % 19 == 0:
        return f"{iso(stamp)} INFO card-client request_id={req} operation=authorize retry=1 reason=transient_reset upstream=card-network"
    return f"{iso(stamp)} INFO card-client request_id={req} operation=authorize pool=in_use wait_ms={seq % 35} upstream=card-network"


def worker_line(stamp: datetime, seq: int) -> str:
    if seq % 13 == 0:
        return f"{iso(stamp)} WARN payments-worker job=reconciliation retry=1 reason=ledger_rate_limit duration_ms={700 + seq % 500}"
    if seq % 29 == 0:
        return f"{iso(stamp)} INFO payments-worker job=settlement batch={seq % 80:02d} records={80 + seq % 40} duration_ms={120 + seq % 300}"
    return f"{iso(stamp)} INFO payments-worker job=settlement batch={seq % 80:02d} records={40 + seq % 80} duration_ms={70 + seq % 180}"


def write_logs() -> None:
    specs = [
        ("payments-api.log", 1750, api_line, 3),
        ("card-client.log", 750, dependency_line, 7),
        ("payments-worker.log", 500, worker_line, 11),
    ]
    for name, count, maker, stride in specs:
        path = ROOT / "logs" / name
        with path.open("w") as f:
            for i in range(count):
                minute = (i * stride * 17) % MINUTES
                stamp = START + timedelta(minutes=minute, seconds=(i * 13) % 60)
                f.write(maker(stamp, i + 1) + "\n")


def main() -> None:
    ensure_dirs()
    (ROOT / "metrics").mkdir(parents=True, exist_ok=True)
    write_metrics()
    write_traffic()
    write_deploys()
    write_logs()


if __name__ == "__main__":
    main()
