#!/usr/bin/env python3
"""Create the generated operational data for the wallet launch fixture."""
from __future__ import annotations

import csv
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED = 7319
ROOT = Path(__file__).resolve().parents[1] / "fixture"
UTC = timezone.utc
START = datetime(2026, 6, 8, 0, 0, tzinfo=UTC)
REGIONS = ("noria", "solmere", "kestrel", "veyra")
SERVICES = ("wallet-session", "edge-api", "partner-adapter")


def iso(t: datetime) -> str:
    return t.isoformat(timespec="seconds").replace("+00:00", "Z")


def request_id(rng: random.Random, n: int) -> str:
    return f"req-{n:08x}-{rng.randrange(0x10000):04x}"


def write_logs(rng: random.Random) -> None:
    log_dir = ROOT / "ops" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    counters = {name: 0 for name in SERVICES}
    templates = {
        "wallet-session": [
            "INFO request {rid} region={region} route=/v1/session status=200 latency_ms={latency}",
            "INFO health check dependency=ledger status=ok latency_ms={latency}",
            "WARN retrying dependency=partner-adapter attempt={attempt} backoff_ms={backoff} request={rid}",
            "INFO request {rid} region={region} route=/v1/token status=200 latency_ms={latency}",
            "WARN slow request {rid} region={region} route=/v1/session latency_ms={slow}",
        ],
        "edge-api": [
            "INFO request {rid} region={region} route=/wallet status=200 latency_ms={latency}",
            "INFO health check dependency=wallet-session status=ok latency_ms={latency}",
            "WARN upstream retry region={region} attempt={attempt} request={rid}",
            "INFO request {rid} region={region} route=/wallet status=204 latency_ms={latency}",
            "WARN slow request {rid} region={region} route=/wallet latency_ms={slow}",
        ],
        "partner-adapter": [
            "INFO request {rid} region={region} bank=Northstar status=200 latency_ms={latency}",
            "INFO health check dependency=northstar-bank status=ok latency_ms={latency}",
            "WARN retrying bank call attempt={attempt} backoff_ms={backoff} request={rid}",
            "INFO request {rid} region={region} route=/certification status=200 latency_ms={latency}",
            "WARN slow request {rid} region={region} latency_ms={slow}",
        ],
    }
    for service in SERVICES:
        lines: list[str] = []
        n = 0
        for minute in range(24 * 60):
            t = START + timedelta(minutes=minute)
            for _ in range(2 if service == "wallet-session" else 1):
                n += 1
                region = REGIONS[(minute + n) % len(REGIONS)]
                rid = request_id(rng, n + len(service) * 1000)
                template = templates[service][rng.randrange(len(templates[service]))]
                line = template.format(
                    rid=rid,
                    region=region,
                    latency=rng.randint(8, 75),
                    slow=rng.randint(850, 1900),
                    attempt=rng.randint(1, 3),
                    backoff=rng.choice((100, 250, 500, 1000)),
                )
                lines.append(f"{iso(t)} service={service} {line}")
                # A few deterministic operational signals are mixed into the normal day.
                if service == "wallet-session" and minute in (97, 98, 99, 100):
                    lines.append(
                        f"{iso(t)} service={service} WARN request={rid} region={region} "
                        "connection pool exhausted active=80 max=80 waiters=19"
                    )
                if service == "wallet-session" and minute in (98, 101):
                    lines.append(
                        f"{iso(t)} service={service} WARN retry storm dependency=ledger "
                        f"request={rid} attempts=4 reason=pool-unavailable"
                    )
                if service == "wallet-session" and minute % 211 == 0:
                    lines.append(
                        f"{iso(t)} service={service} WARN partner TLS handshake certificate "
                        "renewal-window=30d request=" + rid
                    )
        # Keep the generated files comfortably above the requested log volume.
        (log_dir / f"{service}.log").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_metrics(rng: random.Random) -> None:
    metric_dir = ROOT / "ops" / "metrics"
    metric_dir.mkdir(parents=True, exist_ok=True)
    metric_names = {
        "wallet-session": ["wallet_error_rate_pct", "connection_pool_utilization_pct", "schema_compatibility_pct"],
        "edge-api": ["api_ready_pct", "residency_violation_count", "contract_success_rate_pct"],
        "partner-adapter": ["partner_certification_ok", "support_staff_coverage_pct"],
    }
    for service, names in metric_names.items():
        with (metric_dir / f"{service}.csv").open("w", newline="", encoding="utf-8") as fh:
            out = csv.writer(fh)
            out.writerow(["timestamp", "region", "metric", "value"])
            for i in range(480):
                t = START + timedelta(minutes=3 * i)
                region = REGIONS[i % len(REGIONS)]
                for metric in names:
                    if metric == "wallet_error_rate_pct":
                        value = round(0.18 + rng.random() * 0.16, 3)
                    elif metric == "connection_pool_utilization_pct":
                        value = round(54 + rng.random() * 17, 2)
                    elif metric == "schema_compatibility_pct":
                        value = round(99.96 + rng.random() * 0.035, 3)
                    elif metric == "api_ready_pct":
                        value = round(99.2 + rng.random() * 0.7, 3)
                    elif metric == "residency_violation_count":
                        value = 0
                    elif metric == "contract_success_rate_pct":
                        value = round(99.65 + rng.random() * 0.28, 3)
                    elif metric == "partner_certification_ok":
                        value = 1
                    else:
                        value = round(87 + rng.random() * 9, 2)
                    out.writerow([iso(t), region, metric, value])


def write_deploy_history(rng: random.Random) -> None:
    records = []
    versions = [
        ("2026-06-07T16:00:00Z", "edge-api", "2026.06.07.4", "routine latency tuning"),
        ("2026-06-08T07:30:00Z", "wallet-session", "2026.06.08.2", "session persistence preparation"),
        ("2026-06-08T08:00:00Z", "partner-adapter", "2026.06.08.1", "bank header compatibility"),
        ("2026-06-09T11:00:00Z", "edge-api", "2026.06.09.1", "regional routing table"),
    ]
    for stamp, service, version, note in versions:
        records.append({"at": stamp, "service": service, "version": version, "region": rng.choice(REGIONS), "note": note})
    (ROOT / "ops" / "deploy-history.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    rng = random.Random(SEED)
    write_logs(rng)
    write_metrics(rng)
    write_deploy_history(rng)


if __name__ == "__main__":
    main()
