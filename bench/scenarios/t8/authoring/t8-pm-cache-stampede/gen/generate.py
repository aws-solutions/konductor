#!/usr/bin/env python3
"""Generate the catalogue service's routine logs and minute metrics."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import random

ROOT = Path(__file__).resolve().parents[1] / "fixture"
RNG = random.Random(41127)
START = datetime(2025, 3, 18, 12, 0, tzinfo=timezone.utc)
MINUTES = 360

for rel in ("logs", "metrics", "deploy"):
    (ROOT / rel).mkdir(parents=True, exist_ok=True)


def stamp(dt: datetime, seconds: int = 0) -> str:
    return (dt + timedelta(seconds=seconds)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def req_id(i: int, suffix: int) -> str:
    return f"req-{i:06d}-{suffix:02x}"


def incident_minute(i: int) -> int | None:
    if 192 <= i <= 195 or 222 <= i <= 225 or 252 <= i <= 255:
        return i
    return None

# Minute-level measurements. The twelve elevated minutes are the customer-visible windows.
metric_rows = ["time,cache_hit_ratio,db_queries_per_second,db_cpu_percent,page_errors"]
error_spikes = {192: 420, 193: 390, 194: 300, 195: 210,
                222: 420, 223: 390, 224: 300, 225: 210,
                252: 420, 253: 390, 254: 300, 255: 210}
for i in range(MINUTES):
    dt = START + timedelta(minutes=i)
    if i in error_spikes:
        hit, qps, cpu, errors = 0.18, 486, 99.2, error_spikes[i]
    elif i == 262:  # first clean minute after the mitigation rollout
        hit, qps, cpu, errors = 0.94, 105, 47.8, 3
    elif i == 260:
        hit, qps, cpu, errors = 0.82, 170, 68.4, 18
    elif i == 261:
        hit, qps, cpu, errors = 0.90, 124, 55.1, 7
    else:
        hit = round(0.91 + RNG.uniform(-0.018, 0.018), 3)
        qps = round(98 + RNG.uniform(-8, 8), 1)
        cpu = round(43 + RNG.uniform(-5, 7), 1)
        errors = RNG.randint(0, 7)
    metric_rows.append(f"{stamp(dt)},{hit:.3f},{qps:.1f},{cpu:.1f},{errors}")
(ROOT / "metrics/catalog-minute.csv").write_text("\n".join(metric_rows) + "\n", encoding="utf-8")

# API traffic and health logging, with one explicit line at the beginning of each failure window.
api = []
cache = []
db = []
worker = []
for i in range(MINUTES):
    dt = START + timedelta(minutes=i)
    rid = req_id(i, RNG.randrange(16, 255))
    api.append(f"{stamp(dt, 3)} INFO api.catalog request_id={rid} route=/health status=200 latency_ms={RNG.randint(2, 9)}")
    api.append(f"{stamp(dt, 11)} INFO api.catalog request_id={rid} route=/v2/products status=200 cache=hit latency_ms={RNG.randint(8, 24)}")
    api.append(f"{stamp(dt, 29)} INFO api.catalog request_id={req_id(i, 7)} route=/v2/categories status=200 cache=hit latency_ms={RNG.randint(5, 18)}")
    if i % 37 == 0:
        api.append(f"{stamp(dt, 44)} WARN api.catalog request_id={req_id(i, 9)} route=/v2/products status=200 cache=miss latency_ms={RNG.randint(180, 440)} retry=0")
    if i in (192, 222, 252):
        api.append(f"{stamp(dt, 61)} WARN api.catalog request_id={req_id(i, 91)} route=/v2/products cache=miss burst=all-workers pending_db_requests=486")
        api.append(f"{stamp(dt, 74)} ERROR api.catalog request_id={req_id(i, 92)} route=/v2/products status=503 error=database_connection_timeout pool_wait_ms=2000")
    elif i in error_spikes:
        api.append(f"{stamp(dt, 60)} WARN api.catalog request_id={req_id(i, 91)} route=/v2/products status=503 error=database_connection_timeout retry=1")
    elif i == 262:
        api.append(f"{stamp(dt, 18)} INFO api.catalog recovery_check status=200 cache=hit error_rate=0.2pct")
    # routine client and dependency noise
    if i % 53 == 8:
        api.append(f"{stamp(dt, 52)} INFO api.catalog dependency=pricing timeout_ms=800 retries=1 outcome=success")
    if i % 61 == 17:
        api.append(f"{stamp(dt, 57)} WARN api.catalog route=/v2/search status=499 client_cancelled=true")

    cache.append(f"{stamp(dt, 7)} INFO cache-gateway node=cache-{(i % 3) + 1} op=health status=ok latency_ms={RNG.randint(1, 4)}")
    cache.append(f"{stamp(dt, 18)} INFO cache-gateway node=cache-{(i % 3) + 1} keys={RNG.randint(38200, 38600)} hit_ratio={0.91 + RNG.uniform(-.02, .02):.3f} evictions={RNG.randint(0, 4)}")
    cache.append(f"{stamp(dt, 39)} DEBUG cache-gateway node=cache-{(i % 3) + 1} op=refresh key_group={RNG.choice(['featured','seasonal','standard','regional'])} duration_ms={RNG.randint(11, 75)}")
    if i in (192, 222, 252):
        cache.append(f"{stamp(dt, 0)} WARN cache-gateway node=cache-{(i % 3) + 1} expiration wave expired_keys=38194 refill_requests=486 ttl_seconds=1800")
    if i in error_spikes:
        cache.append(f"{stamp(dt, 26)} WARN cache-gateway node=cache-{(i % 3) + 1} refill_queue depth={RNG.randint(420, 500)} status=backpressure")
    if i % 79 == 21:
        cache.append(f"{stamp(dt, 49)} WARN cache-gateway node=cache-2 replication_lag_ms={RNG.randint(80, 190)} action=retry")
    if i == 260:
        cache.append(f"{stamp(dt, 12)} INFO cache-gateway ttl_policy=updated jitter_seconds=120 refill_queue=normal")

    db.append(f"{stamp(dt, 5)} INFO catalog-db replica=read-1 health=ok connections={RNG.randint(36, 58)} cpu_pct={RNG.randint(38, 55)} query_ms={RNG.randint(3, 12)}")
    db.append(f"{stamp(dt, 22)} INFO catalog-db replica=read-1 query=product_lookup rows={RNG.randint(1, 4)} duration_ms={RNG.randint(4, 19)}")
    db.append(f"{stamp(dt, 41)} DEBUG catalog-db pool idle={RNG.randint(8, 24)} active={RNG.randint(18, 42)} waiters=0")
    if i == 30:
        db.append(f"{stamp(dt, 14)} WARN catalog-db primary query=analytics_rollup job=reporting-daily duration_ms=12840 cpu_pct=82 outcome=completed")
    if i == 31:
        db.append(f"{stamp(dt, 16)} INFO catalog-db primary query=analytics_rollup job=reporting-daily rows=28401 duration_ms=13110 outcome=completed")
    if i in (192, 222, 252):
        db.append(f"{stamp(dt, 2)} ERROR catalog-db primary connection_limit_reached active_connections=240 max_connections=240 waiters=486")
        db.append(f"{stamp(dt, 9)} WARN catalog-db replica=read-1 cpu_pct=99.2 query_queue=486 replication_lag_ms=1840")
    elif i in error_spikes:
        db.append(f"{stamp(dt, 6)} WARN catalog-db primary connection_pool waiters={RNG.randint(240, 480)} active_connections=240")
    elif i == 262:
        db.append(f"{stamp(dt, 8)} INFO catalog-db replica=read-1 recovery connections=49 cpu_pct=47.8 waiters=0")
    if i % 67 == 13:
        db.append(f"{stamp(dt, 48)} WARN catalog-db replica=read-1 replication_lag_ms={RNG.randint(90, 240)} action=monitor")

    worker.append(f"{stamp(dt, 13)} INFO catalog-worker job=inventory-sync batch={RNG.randint(80, 120)} duration_ms={RNG.randint(180, 420)} result=ok")
    worker.append(f"{stamp(dt, 35)} INFO catalog-worker queue=price-updates depth={RNG.randint(0, 14)} acked={RNG.randint(50, 120)}")
    if i % 71 == 4:
        worker.append(f"{stamp(dt, 58)} WARN catalog-worker job=search-index retry=1 reason=upstream_429 result=ok")

(ROOT / "logs/api.log").write_text("\n".join(api) + "\n", encoding="utf-8")
(ROOT / "logs/cache.log").write_text("\n".join(cache) + "\n", encoding="utf-8")
(ROOT / "logs/db.log").write_text("\n".join(db) + "\n", encoding="utf-8")
(ROOT / "logs/worker.log").write_text("\n".join(worker) + "\n", encoding="utf-8")

# A compact operational history, including unrelated routine releases and the cache rollout.
deploys = [
    {"time": "2025-03-18T12:14:00.000Z", "service": "catalog-api", "version": "2025.03.18-1", "status": "succeeded", "operator": "Nora Ives"},
    {"time": "2025-03-18T13:05:00.000Z", "service": "catalog-worker", "version": "2025.03.18-2", "status": "succeeded", "operator": "Jules Park"},
    {"time": "2025-03-18T11:40:00.000Z", "service": "catalog-api", "version": "2025.03.18-3", "status": "succeeded", "operator": "Samir Holt", "note": "dependency timeout adjustment"},
    {"time": "2025-03-18T14:42:00.000Z", "service": "cache-gateway", "version": "2025.03.18-4", "status": "succeeded", "operator": "Maya Chen", "note": "policy reload; warmup completed keys=38400"},
    {"time": "2025-03-18T16:19:00.000Z", "service": "cache-gateway", "version": "2025.03.18-5", "status": "succeeded", "operator": "Maya Chen", "note": "policy update staged"},
    {"time": "2025-03-18T16:22:00.000Z", "service": "catalog-api", "version": "2025.03.18-6", "status": "succeeded", "operator": "Nora Ives", "note": "connection backoff"},
]
(ROOT / "deploy/deploy-history.jsonl").write_text("\n".join(json.dumps(x, separators=(",", ":")) for x in deploys) + "\n", encoding="utf-8")
