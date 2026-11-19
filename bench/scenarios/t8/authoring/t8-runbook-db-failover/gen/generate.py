#!/usr/bin/env python3
"""Create the generated operational history for the orders database fixture."""
from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED = 20250318
ROOT = Path(__file__).resolve().parent.parent / "fixture"
UTC = timezone.utc
START = datetime(2025, 3, 18, 0, 0, tzinfo=UTC)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def write_lines(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def make_api(rng: random.Random) -> list[str]:
    routes = ["/v1/orders", "/v1/orders/{id}", "/v1/health", "/v1/orders/search"]
    lines: list[str] = []
    for i in range(900):
        t = START + timedelta(seconds=i * 96 + rng.randrange(0, 40))
        req = f"req-{i:06d}"
        route = routes[i % len(routes)]
        status = 200
        duration = rng.randint(8, 180)
        level = "INFO"
        detail = f"route={route} status={status} duration_ms={duration}"
        if i % 83 == 0:
            level = "WARN"
            detail = f"route={route} status=200 duration_ms={rng.randint(500, 1400)} retry=1 backoff_ms=250"
        if i % 137 == 0:
            level = "WARN"
            detail = f"route={route} status=503 duration_ms={rng.randint(900, 1800)} retry=2 backoff_ms=500"
        # A busy application pool is visible during the event, but remains below its limit.
        if 79 <= i <= 86:
            level = "WARN" if i != 82 else "ERROR"
            detail = f"route=/v1/orders status={'503' if i == 82 else '200'} duration_ms={900 + i * 17} retry={i - 78} pool_in_use={31 + (i % 7)} pool_max=40"
        lines.append(f"{iso(t)} {level} service=orders-api request_id={req} {detail}")
    return lines


def make_replicator(rng: random.Random) -> list[str]:
    lines: list[str] = []
    for i in range(900):
        t = START + timedelta(seconds=i * 96 + rng.randrange(0, 35))
        if i == 78:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 4, 48, tzinfo=UTC))} INFO service=quorum-replicator event=health_check primary=orders-db-a status=ok")
            continue
        if i == 79:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 7, 0, tzinfo=UTC))} WARN service=quorum-replicator node=orders-db-a metric=storage_io_await_ms value=1840 device=nvme0n1 threshold=50")
            continue
        if i == 80:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 7, 36, tzinfo=UTC))} WARN service=quorum-replicator node=orders-db-a event=commit_latency value_ms=1960 wait_class=storage")
            continue
        if i == 81:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 8, 12, tzinfo=UTC))} WARN service=quorum-replicator replica=orders-db-b metric=replication_lag_seconds value=27")
            continue
        if i == 82:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 8, 48, tzinfo=UTC))} INFO service=quorum-replicator replica=orders-db-b event=apply_caught_up replication_lag_seconds=19")
            continue
        if i == 83:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 9, 24, tzinfo=UTC))} WARN service=quorum-replicator node=orders-db-a event=health_check status=degraded write_latency_ms=2210")
            continue
        if i == 84:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 10, 0, tzinfo=UTC))} INFO service=quorum-replicator replica=orders-db-c event=backup_delay delay_seconds=900 role=delayed_replica")
            continue
        if i == 85:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 10, 36, tzinfo=UTC))} INFO service=quorum-replicator primary=orders-db-a event=client_errors_hint error=connection_pool_timeout")
            continue
        if i % 71 == 0:
            lines.append(f"{iso(t)} WARN service=quorum-replicator node=orders-db-b event=retry peer=orders-db-a attempt=2 reason=heartbeat_jitter")
        elif i % 113 == 0:
            lines.append(f"{iso(t)} WARN service=quorum-replicator node=orders-db-a event=slow_request duration_ms={rng.randint(700, 1400)} request_id=req-{i:06d}")
        else:
            node = "orders-db-a" if i % 3 else "orders-db-b"
            lines.append(f"{iso(t)} INFO service=quorum-replicator node={node} event=health_check status=ok heartbeat_ms={rng.randint(4, 40)}")
    return lines


def make_db(rng: random.Random) -> list[str]:
    lines: list[str] = []
    for i in range(900):
        t = START + timedelta(seconds=i * 96 + rng.randrange(0, 30))
        if i == 79:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 7, 18, tzinfo=UTC))} WARN service=orders-db node=orders-db-a event=io_wait device=nvme0n1 await_ms=1840 queue_depth=32")
            continue
        if i == 80:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 7, 54, tzinfo=UTC))} ERROR service=orders-db node=orders-db-a event=write_timeout timeout_ms=2000 transaction=order_insert")
            continue
        if i == 81:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 8, 30, tzinfo=UTC))} WARN service=orders-db node=orders-db-a event=checkpoint delayed_by_ms=1730")
            continue
        if i == 82:
            lines.append(f"{iso(datetime(2025, 3, 18, 2, 9, 6, tzinfo=UTC))} INFO service=orders-db node=orders-db-b event=replay position=882104 lag_seconds=19")
            continue
        if i % 67 == 0:
            lines.append(f"{iso(t)} WARN service=orders-db node=orders-db-a event=slow_query duration_ms={rng.randint(600, 1500)} query=order_lookup")
        elif i % 101 == 0:
            lines.append(f"{iso(t)} WARN service=orders-db node=orders-db-b event=replay_retry reason=network_jitter attempt=1")
        else:
            node = "orders-db-a" if i % 4 else "orders-db-b"
            lines.append(f"{iso(t)} INFO service=orders-db node={node} event=health_check status=ok connections={rng.randint(10, 29)}")
    return lines


def write_metrics(rng: random.Random) -> None:
    path = ROOT / "data" / "metrics.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["time_utc", "metric", "node", "value", "unit"])
        for i in range(360):
            t = START + timedelta(minutes=4 * i)
            node = "orders-db-a" if i % 2 else "orders-db-b"
            if i in (32, 33):
                node = "orders-db-a"
            lag = 4 + rng.randrange(0, 18)
            await_ms = 7 + rng.randrange(0, 24)
            pool = 12 + rng.randrange(0, 20)
            if i == 32:
                await_ms = 1840
            if i == 33:
                await_ms = 1960
            if i == 34:
                lag = 27
            w.writerow([iso(t), "replication_lag_seconds", node, lag, "seconds"])
            w.writerow([iso(t), "storage_io_await_ms", node, await_ms, "milliseconds"])
            w.writerow([iso(t), "db_connection_pool_in_use", node, pool, "connections"])


def write_deploys() -> None:
    path = ROOT / "data" / "deploy-history.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        ["time_utc", "service", "version", "change", "operator", "result"],
        ["2025-03-17T19:20:00Z", "orders-api", "4.17.3", "routine dependency refresh", "release-bot", "complete"],
        ["2025-03-18T01:55:00Z", "orders-api", "4.18.0", "retry budget and request timeout tuning", "release-bot", "complete"],
        ["2025-03-18T02:12:00Z", "orders-api", "4.18.0", "deployment paused during incident", "release-bot", "paused"],
        ["2025-03-18T03:20:00Z", "orders-api", "4.18.1", "rollback of timeout tuning", "release-bot", "complete"],
        ["2025-03-18T06:10:00Z", "orders-api", "4.18.2", "normal release train", "release-bot", "complete"],
    ]
    path.write_text("\n".join(",".join(row) for row in rows) + "\n", encoding="utf-8")


def main() -> None:
    rng = random.Random(SEED)
    (ROOT / "logs").mkdir(parents=True, exist_ok=True)
    write_lines(ROOT / "logs" / "orders-api.log", make_api(rng))
    write_lines(ROOT / "logs" / "quorum-replicator.log", make_replicator(rng))
    write_lines(ROOT / "logs" / "orders-db.log", make_db(rng))
    write_metrics(rng)
    write_deploys()


if __name__ == "__main__":
    main()
