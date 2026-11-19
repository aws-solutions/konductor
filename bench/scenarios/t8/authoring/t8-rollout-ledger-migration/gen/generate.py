#!/usr/bin/env python3
"""Create the data exports used by the ledger release folder."""
from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixture"
RNG = random.Random(271828)

METRICS = [
    ("ledger_v3_request_rate", "requests", "Requests reaching ledger-api per second"),
    ("ledger_request_latency_p50_ms", "ms", "Ledger request latency, p50"),
    ("ledger_request_latency_p95_ms", "ms", "Ledger request latency, p95"),
    ("ledger_request_latency_p99_ms", "ms", "Ledger request latency, p99"),
    ("ledger_write_error_rate", "percent", "Ledger writes returning an error"),
    ("ledger_read_error_rate", "percent", "Ledger reads returning an error"),
    ("ledger_v3_5xx_rate", "percent", "HTTP 5xx responses from the ledger path"),
    ("ledger_null_legacy_rows", "rows", "Rows with a null legacy settlement code"),
    ("ledger_settlement_code_backfill_rate", "rows_per_minute", "Backfill updates per minute"),
    ("ledger_db_pool_wait_ms", "ms", "Time waiting for a database connection"),
    ("ledger_db_query_latency_p95_ms", "ms", "Database query latency, p95"),
    ("ledger_replica_lag_seconds", "seconds", "Replica replay lag"),
    ("ledger_dead_letter_rate", "percent", "Requests sent to the dead-letter queue"),
    ("ledger_retry_rate", "percent", "Ledger requests retried by the client"),
    ("ledger_idempotency_conflict_rate", "percent", "Idempotency conflicts per request"),
    ("payment_authorizer_error_rate", "percent", "Authorizer errors returned to payments"),
    ("payment_webhook_delay_seconds", "seconds", "Webhook delivery delay"),
    ("ledger_worker_queue_depth", "items", "Unprocessed ledger worker items"),
    ("ledger_worker_processing_rate", "items_per_second", "Ledger worker throughput"),
    ("ledger_cache_hit_rate", "percent", "Ledger cache hit ratio"),
    ("ledger_schema_version", "version", "Schema version observed by the service"),
    ("ledger_connection_errors", "errors", "Database connection errors"),
    ("ledger_request_timeout_rate", "percent", "Ledger requests exceeding the timeout"),
    ("ledger_reconciliation_gap_count", "rows", "Rows awaiting reconciliation"),
    ("ledger_audit_append_error_rate", "percent", "Audit append failures"),
    ("ledger_lock_wait_ms", "ms", "Time waiting on a ledger row lock"),
    ("ledger_read_only_fallback_rate", "percent", "Reads served by the fallback path"),
    ("ledger_api_up", "boolean", "Ledger API health state"),
    ("ledger_worker_up", "boolean", "Ledger worker health state"),
]


def write_metrics() -> None:
    path = ROOT / "metrics" / "metrics-catalogue.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        out = csv.writer(fh)
        out.writerow(["metric_name", "unit", "description"])
        out.writerows(METRICS)


def write_deploy_history() -> None:
    path = ROOT / "history" / "deploy-history.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    services = ["ledger-api", "ledger-worker", "payment-authorizer", "reconciliation"]
    outcomes = ["success", "success", "success", "success", "rolled_back"]
    start = datetime(2025, 10, 1, 9, 5, tzinfo=timezone.utc)
    with path.open("w", newline="", encoding="utf-8") as fh:
        out = csv.writer(fh)
        out.writerow(["deploy_id", "service", "version", "started_utc", "duration_min", "outcome", "hosts"])
        for i in range(22):
            service = services[i % len(services)]
            version = f"2.{8 + i // 5}.{i % 5}"
            started = start + timedelta(days=i, hours=(i * 3) % 7)
            duration = {"ledger-api": 17 + (i % 4) * 3, "ledger-worker": 21 + (i % 3) * 4,
                        "payment-authorizer": 13 + (i % 5) * 2, "reconciliation": 26 + (i % 4) * 3}[service]
            outcome = outcomes[i % len(outcomes)]
            hosts = 12 if service in {"ledger-api", "payment-authorizer"} else 3
            out.writerow([f"dep-{20251001 + i:08d}", service, version,
                          started.isoformat().replace("+00:00", "Z"), duration, outcome, hosts])


def log_line(ts: datetime, service: str, level: str, request_id: str, message: str) -> str:
    return f'{ts.isoformat().replace("+00:00", "Z")} level={level} service={service} request_id={request_id} {message}'


def write_logs() -> None:
    path = ROOT / "logs" / "ledger-canary.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    services = ["ledger-api", "ledger-worker", "payment-authorizer", "reconciliation", "db-proxy"]
    messages = [
        'route=health status=200 duration_ms=4',
        'route=post_entry status=200 duration_ms=38',
        'route=get_entry status=200 duration_ms=17',
        'route=settle status=200 duration_ms=72',
        'event=retry dependency=payment-authorizer attempt=2 backoff_ms=120',
        'event=connection_pool wait_ms=19 active=8 idle=4',
        'event=replica_check lag_seconds=1.2',
        'event=slow_request route=reconcile duration_ms=642 threshold_ms=500',
        'event=queue_poll items=14 duration_ms=31',
        'event=webhook delivery=delayed delay_seconds=9',
        'event=cache miss=true key=account-profile',
        'event=config_refresh result=unchanged',
    ]
    start = datetime(2025, 11, 3, 0, 0, tzinfo=timezone.utc)
    lines: list[str] = []
    for i in range(1800):
        ts = start + timedelta(seconds=i * 48)
        service = services[(i * 7 + 2) % len(services)]
        level = "WARN" if i % 47 == 0 or i % 83 == 0 else "INFO"
        req = f"rq-{RNG.randrange(100000, 999999):06d}"
        message = messages[(i * 11 + 3) % len(messages)]
        lines.append(log_line(ts, service, level, req, message))

    # A short, realistic canary episode is embedded in otherwise routine traffic.
    incident = [
        log_line(datetime(2025, 11, 3, 10, 14, 12, tzinfo=timezone.utc), "ledger-api", "WARN", "rq-731401",
                 'version=v3 cohort=canary route=settle status=409 reason=retryable_write'),
        log_line(datetime(2025, 11, 3, 10, 14, 19, tzinfo=timezone.utc), "ledger-api", "ERROR", "rq-731402",
                 'version=v3 cohort=canary route=settle status=500 error=not_null_violation column=settlement_code value=NULL'),
        log_line(datetime(2025, 11, 3, 10, 14, 25, tzinfo=timezone.utc), "ledger-api", "ERROR", "rq-731403",
                 'version=v3 cohort=canary route=settle status=500 error=legacy_field_required column=settlement_code value=NULL'),
        log_line(datetime(2025, 11, 3, 10, 14, 31, tzinfo=timezone.utc), "ledger-worker", "WARN", "rq-731404",
                 'version=v3 cohort=canary event=retry reason=ledger_write_failed column=settlement_code'),
        log_line(datetime(2025, 11, 3, 10, 15, 2, tzinfo=timezone.utc), "db-proxy", "WARN", "rq-731405",
                 'event=connection_pool wait_ms=211 active=12 idle=0 route=settle'),
        log_line(datetime(2025, 11, 3, 10, 15, 8, tzinfo=timezone.utc), "ledger-api", "ERROR", "rq-731406",
                 'version=v3 cohort=canary route=settle status=500 error=not_null_violation column=settlement_code value=NULL'),
        log_line(datetime(2025, 11, 3, 10, 16, 11, tzinfo=timezone.utc), "ledger-api", "INFO", "rq-731407",
                 'version=v3 cohort=canary action=traffic_paused reason=ledger_write_error_rate_above_gate'),
        log_line(datetime(2025, 11, 3, 10, 17, 3, tzinfo=timezone.utc), "ledger-api", "INFO", "rq-731408",
                 'version=v2 cohort=stable route=settle status=200 note=old_pool_healthy'),
    ]
    # Replace lines around a fixed point so the injected event has stable, discoverable line numbers.
    insertion = 620
    lines[insertion:insertion] = incident
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    write_metrics()
    write_deploy_history()
    write_logs()
