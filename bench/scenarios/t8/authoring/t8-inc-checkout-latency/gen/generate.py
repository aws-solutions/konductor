#!/usr/bin/env python3
"""Generate a synthetic day of checkout operations data."""
from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED = 41827
ROOT = Path(__file__).resolve().parents[1] / "fixture"
DAY = datetime(2026, 3, 17, tzinfo=timezone.utc)
RNG = random.Random(SEED)


def iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def rid(prefix: str, minute: int, n: int) -> str:
    return f"{prefix}-{minute:04d}-{n:03d}"


def write_lines(rel: str, lines: list[str]) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def request_shape(minute: int) -> tuple[int, int, int, int, int]:
    hour = minute // 60
    if 17 <= hour <= 19:
        rate = 110 + RNG.randint(-8, 10)
    elif 11 <= hour <= 14:
        rate = 78 + RNG.randint(-8, 8)
    else:
        rate = 48 + RNG.randint(-6, 6)
    incident = 1084 <= minute <= 1123  # 18:04 through 18:43 UTC
    if not incident and minute == 1083:
        return rate, 92, 710, 0, 0
    if incident:
        p50 = 260 + (minute - 1084) * 7 + RNG.randint(-12, 12)
        p99 = 2400 + ((minute - 1084) % 7) * 180 + RNG.randint(-80, 100)
        failures = 7 + (minute % 5) * 2
        waiters = 18 + ((minute - 1084) % 9) * 7
        cpu = 47 + ((minute - 1084) % 6)
        if minute >= 1113:
            p50 -= 90
            p99 -= 600
            waiters -= 6
            failures = max(2, failures - 3)
        return rate, p50, p99, failures, max(0, waiters)
    if minute in (1124, 1125, 1126):
        return rate, 125, 510, 1 if minute == 1124 else 0, 2 if minute == 1124 else 0
    return rate, 82 + RNG.randint(-8, 11), 330 + RNG.randint(-35, 45), 0, 0


def generate_metrics() -> None:
    path = ROOT / "metrics/checkout-minute.csv"
    with path.open("w", newline="", encoding="utf-8") as f:
        out = csv.writer(f)
        out.writerow(["timestamp", "request_rate_rpm", "p50_ms", "p99_ms", "five_xx", "pool_waiters", "checkout_cpu_pct"])
        for minute in range(1440):
            rate, p50, p99, failures, waiters = request_shape(minute)
            cpu = 22 + (minute // 60) % 5 + RNG.randint(0, 5)
            if 1084 <= minute <= 1123:
                cpu = 46 + (minute % 8)
            out.writerow([iso(DAY + timedelta(minutes=minute)), rate, p50, p99, failures, waiters, cpu])


def generate_deploys() -> None:
    rows = [
        ["timestamp", "service", "release", "operator", "change_scope", "result"],
        ["2026-03-17T02:15:00Z", "inventory-service", "inv-2026.03.17.1", "mira", "index statistics refresh", "complete"],
        ["2026-03-17T09:40:00Z", "payments-adapter", "pay-2026.03.17.2", "tomas", "retry budget labels", "complete"],
        ["2026-03-17T17:44:00Z", "checkout-api", "chk-2026.03.17.7", "rhea", "email template copy and receipt placeholders", "complete"],
        ["2026-03-17T21:10:00Z", "inventory-service", "inv-2026.03.17.2", "mira", "warehouse holiday calendar", "complete"],
        ["2026-03-16T16:55:00Z", "checkout-api", "chk-2026.03.16.4", "rhea", "address validation text", "complete"],
    ]
    with (ROOT / "deploy/deploy-history.csv").open("w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)


def generate_checkout_log() -> None:
    lines: list[str] = []
    for minute in range(1440):
        t = DAY + timedelta(minutes=minute)
        stamp = iso(t)
        lines.append(f"{stamp} INFO checkout-api request_id={rid('chk', minute, 0)} route=GET /health status=200 latency_ms={18 + minute % 9}")
        if minute % 47 == 0:
            lines.append(f"{stamp} WARN checkout-api gc pause observed pause_ms={112 + minute % 31} generation=young")
        if minute % 83 == 0:
            lines.append(f"{stamp} INFO checkout-api receipt renderer template_cache=warm rendered_ms={31 + minute % 17}")
        if minute == 1083:
            lines.append(f"{stamp} WARN checkout-api request_id={rid('chk', minute, 1)} route=POST /checkout latency_ms=1087 db_wait_ms=904 status=200")
        if 1084 <= minute <= 1123:
            failures = request_shape(minute)[3]
            waiters = request_shape(minute)[4]
            lines.append(f"{stamp} WARN checkout-api db pool waiters={waiters} acquire_timeout_ms=800 request_id={rid('chk', minute, 1)}")
            lines.append(f"{stamp} ERROR checkout-api request_id={rid('chk', minute, 2)} route=POST /checkout error=connection_acquire_timeout db_wait_ms=800 status=503")
            lines.append(f"{stamp} INFO checkout-api retry scheduled request_id={rid('chk', minute, 3)} attempt=2 backoff_ms={150 + minute % 90}")
            if minute % 4 == 0:
                lines.append(f"{stamp} WARN checkout-api slow request_id={rid('chk', minute, 4)} route=POST /checkout latency_ms={2800 + minute % 400} status=200")
        elif minute in (1124, 1125):
            lines.append(f"{stamp} WARN checkout-api pool waiters={2 if minute == 1124 else 0} request_id={rid('chk', minute, 1)} latency_ms={610 if minute == 1124 else 120} status=200")
        else:
            lines.append(f"{stamp} INFO checkout-api request_id={rid('chk', minute, 1)} route=POST /checkout latency_ms={74 + minute % 45} status=200")
        if minute % 61 == 0:
            lines.append(f"{stamp} INFO checkout-api dependency payments-adapter status=ok latency_ms={45 + minute % 16}")
    write_lines("logs/checkout-api.log", lines)


def generate_payments_log() -> None:
    lines: list[str] = []
    for minute in range(1440):
        t = DAY + timedelta(minutes=minute)
        stamp = iso(t)
        lines.append(f"{stamp} INFO payments-adapter health provider=card-gateway status=200 latency_ms={39 + minute % 14}")
        if minute % 6 == 0:
            lines.append(f"{stamp} INFO payments-adapter auth request_id={rid('pay', minute, 1)} provider=card-gateway status=approved latency_ms={88 + minute % 27}")
        if minute % 71 == 0:
            lines.append(f"{stamp} WARN payments-adapter provider retry request_id={rid('pay', minute, 2)} attempt=1 reason=upstream_429")
        if 1084 <= minute <= 1123 and minute % 8 == 0:
            lines.append(f"{stamp} INFO payments-adapter no inbound checkout request request_id={rid('pay', minute, 3)} reason=checkout_acquire_timeout")
    write_lines("logs/payments-adapter.log", lines)


def generate_inventory_log() -> None:
    lines: list[str] = []
    for minute in range(1440):
        t = DAY + timedelta(minutes=minute)
        stamp = iso(t)
        lines.append(f"{stamp} INFO inventory-service health status=200 latency_ms={22 + minute % 13}")
        if minute % 5 == 0:
            lines.append(f"{stamp} INFO inventory-service reservation request_id={rid('inv', minute, 1)} sku=sku-{minute % 19:02d} status=reserved latency_ms={63 + minute % 21}")
        if minute % 97 == 0:
            lines.append(f"{stamp} WARN inventory-service cache refresh delayed_ms={180 + minute % 70} status=recovered")
    write_lines("logs/inventory-service.log", lines)


def generate_pooler_log() -> None:
    lines: list[str] = []
    for minute in range(1440):
        t = DAY + timedelta(minutes=minute)
        stamp = iso(t)
        lines.append(f"{stamp} INFO db-pooler health active=18 idle=22 checkout_clients=7 postgres=healthy")
        if minute % 59 == 0:
            lines.append(f"{stamp} WARN db-pooler client idle timeout count={1 + minute % 3} action=close")
        if minute == 1062:
            lines.append(f"{stamp} INFO db-pooler config reload accepted scope=checkout client_pool_size=12 previous=40 source=remote-config")
        if minute == 1063:
            lines.append(f"{stamp} INFO db-pooler pool state checkout configured=12 active=12 idle=0 postgres_connections=40")
        if minute == 1083:
            lines.append(f"{stamp} WARN db-pooler checkout queue depth=9 oldest_wait_ms=901 client_pool_size=12")
        if 1084 <= minute <= 1123:
            waiters = request_shape(minute)[4]
            lines.append(f"{stamp} ERROR db-pooler checkout client connection limit reached pool=checkout limit=12 waiters={waiters} action=queue")
            if minute % 3 == 0:
                lines.append(f"{stamp} WARN db-pooler acquire timeout pool=checkout timeout_ms=800 refused={3 + minute % 6}")
        if minute == 1121:
            lines.append(f"{stamp} INFO db-pooler admin command received command=restart reason=queue_depth operator=oncall")
        if minute == 1122:
            lines.append(f"{stamp} INFO db-pooler started pid=8841 client_pool_size=40 source=last_known_good")
        if minute == 1123:
            lines.append(f"{stamp} INFO db-pooler pool recovered checkout configured=40 active=19 idle=21 waiters=0")
    write_lines("logs/pooler.log", lines)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    generate_metrics()
    generate_deploys()
    generate_checkout_log()
    generate_payments_log()
    generate_inventory_log()
    generate_pooler_log()


if __name__ == "__main__":
    main()
