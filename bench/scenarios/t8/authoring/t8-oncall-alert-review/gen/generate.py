#!/usr/bin/env python3
"""Create the monitoring workspace used by the alert review exercise."""
from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixture"
RNG = random.Random(7314)
START = datetime(2025, 2, 1, tzinfo=timezone.utc)


def write_text(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text.rstrip() + "\n", encoding="utf-8")


def write_csv(path: str, fields: list[str], rows: list[dict[str, object]]) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_catalogue() -> None:
    rows = [
        ("http_requests_total", "counter", "requests", "edge", "Completed requests by route and status", "active"),
        ("http_request_error_rate", "gauge", "ratio", "edge", "Five-minute share of requests returning 5xx", "active"),
        ("http_request_duration_p95_ms", "gauge", "milliseconds", "edge", "95th percentile request duration", "active"),
        ("process_cpu_utilization", "gauge", "ratio", "platform", "Process CPU utilization across API pods", "active"),
        ("db_pool_in_use_ratio", "gauge", "ratio", "data", "Connections in use divided by pool capacity", "active"),
        ("db_pool_wait_seconds", "gauge", "seconds", "data", "Time callers wait for a database connection", "active"),
        ("worker_queue_depth", "gauge", "messages", "jobs", "Messages waiting for a worker", "active"),
        ("worker_queue_age_seconds", "gauge", "seconds", "jobs", "Age of the oldest queued message", "active"),
        ("worker_error_rate", "gauge", "ratio", "jobs", "Share of worker jobs ending in error", "active"),
        ("cache_hit_ratio", "gauge", "ratio", "edge", "Share of cache lookups served locally", "active"),
        ("auth_login_failure_rate", "gauge", "ratio", "identity", "Failed login attempts per login attempt", "active"),
        ("payment_provider_latency_ms", "gauge", "milliseconds", "billing", "Provider response latency", "active"),
        ("search_index_lag_seconds", "gauge", "seconds", "search", "Difference between source and indexed event time", "active"),
        ("disk_free_ratio", "gauge", "ratio", "platform", "Free space on a service volume", "active"),
        ("deployment_failure_total", "counter", "deployments", "release", "Deployments that did not reach healthy state", "active"),
        ("tls_cert_days_remaining", "gauge", "days", "platform", "Days until an edge certificate expires", "active"),
        ("upstream_healthcheck_failures", "gauge", "checks", "edge", "Failed synthetic checks to the public API", "active"),
        ("request_timeout_rate", "gauge", "ratio", "edge", "Requests exceeding the configured client timeout", "active"),
        ("legacy_db_connection_count", "gauge", "connections", "data", "Retained for historical dashboard imports", "retired"),
    ]
    write_csv("catalogue/metrics.csv", ["name", "type", "unit", "owner", "description", "status"], [dict(zip(["name", "type", "unit", "owner", "description", "status"], row)) for row in rows])


def make_deploys() -> None:
    rows = [
        {"deploy_id": "rel-250201.1", "started": "2025-02-01T09:20:00Z", "service": "web-api", "version": "2025.02.01.1", "result": "success", "actor": "nora"},
        {"deploy_id": "rel-250207.2", "started": "2025-02-07T16:10:00Z", "service": "job-runner", "version": "2025.02.07.2", "result": "success", "actor": "devin"},
        {"deploy_id": "rel-250209.1", "started": "2025-02-09T12:40:00Z", "service": "search-indexer", "version": "2025.02.09.1", "result": "success", "actor": "rhea"},
        {"deploy_id": "rel-251402.1", "started": "2025-02-14T08:05:00Z", "service": "billing-worker", "version": "2025.02.14.1", "result": "success", "actor": "nora"},
        {"deploy_id": "rel-251803.3", "started": "2025-02-18T14:03:00Z", "service": "web-api", "version": "2025.02.18.3", "result": "rollback", "actor": "devin"},
        {"deploy_id": "rel-252004.1", "started": "2025-02-20T11:30:00Z", "service": "web-api", "version": "2025.02.20.1", "result": "success", "actor": "rhea"},
        {"deploy_id": "rel-252605.1", "started": "2025-02-26T17:45:00Z", "service": "billing-worker", "version": "2025.02.26.1", "result": "success", "actor": "devin"},
        {"deploy_id": "rel-253101.2", "started": "2025-03-01T10:15:00Z", "service": "web-api", "version": "2025.03.01.2", "result": "success", "actor": "nora"},
    ]
    write_csv("deploys/deploy-history.csv", list(rows[0]), rows)


def make_incidents() -> None:
    rows = [
        {"incident_id": "INC-250204", "opened": "2025-02-04T19:12:00Z", "closed": "2025-02-04T19:39:00Z", "service": "web-api", "severity": "SEV-3", "summary": "Elevated cache misses increased response latency", "cause": "A cache shard restarted during scheduled maintenance", "owner": "Mira"},
        {"incident_id": "INC-250211", "opened": "2025-02-11T06:28:00Z", "closed": "2025-02-11T07:16:00Z", "service": "job-runner", "severity": "SEV-2", "summary": "Aging background work delayed exports", "cause": "A provider retry storm filled the worker queue", "owner": "Jon"},
        {"incident_id": "INC-250218", "opened": "2025-02-18T14:11:00Z", "closed": "2025-02-18T14:35:00Z", "service": "web-api", "severity": "SEV-1", "summary": "Checkout and project pages returned errors", "cause": "API database connection pool waiters timed out after the afternoon release", "owner": "Priya"},
        {"incident_id": "INC-250226", "opened": "2025-02-26T17:51:00Z", "closed": "2025-02-26T18:22:00Z", "service": "billing-worker", "severity": "SEV-3", "summary": "Some invoices waited on a slow provider", "cause": "The payment provider exceeded its normal response budget", "owner": "Mira"},
    ]
    write_csv("incidents/incidents.csv", list(rows[0]), rows)


def make_alert_history() -> None:
    rows: list[dict[str, str]] = []
    people = ["Mira", "Jon", "Priya", "Devin", "Rhea"]

    def add(name: str, start: datetime, minutes: int, ack: str, incident: str = "") -> None:
        rows.append({"alert": name, "start": iso(start), "end": iso(start + timedelta(minutes=minutes)), "acked by": ack, "linked incident": incident})

    # The recurring entries are intentionally interspersed with real incidents in the month.
    for day in range(30):
        d = START + timedelta(days=day)
        if day < 29:
            add("ApiLatencyP95", d.replace(hour=18, minute=2) + timedelta(minutes=(day * 7) % 19), 9 + (day % 5), people[day % len(people)])
        if day % 2 == 0:
            add("ApiCpuSaturation", d.replace(hour=10, minute=17) + timedelta(minutes=day % 11), 11, people[(day + 1) % len(people)])
        if day % 3 == 0:
            add("RequestTimeoutRate", d.replace(hour=12, minute=35) + timedelta(minutes=day % 8), 8 + day % 4, people[(day + 2) % len(people)])
        if day in (1, 8, 15, 22, 29):
            add("QueueDepthSpike", d.replace(hour=3, minute=24), 1 + day % 3, people[(day + 3) % len(people)])
        if day % 4 == 0:
            add("ApiNoTraffic", d.replace(hour=2, minute=11), 23, people[day % len(people)])
        if day in (3, 10, 17, 24):
            add("QueueAgeHigh", d.replace(hour=6, minute=40), 14, people[(day + 1) % len(people)], "INC-250211" if day == 10 else "")

    for i in range(42 - 6):
        d = START + timedelta(days=(i * 3) % 29, hours=(i * 5) % 18)
        add("ApiNoTraffic", d.replace(hour=1 + (i % 4), minute=5 + (i % 12)), 16 + i % 9, people[(i + 2) % len(people)])

    add("ApiHigh5xxRate", datetime(2025, 2, 18, 14, 11, tzinfo=timezone.utc), 24, "Priya", "INC-250218")
    add("HealthCheckDown", datetime(2025, 2, 18, 14, 12, tzinfo=timezone.utc), 22, "Priya", "INC-250218")
    add("WorkerErrorRate", datetime(2025, 2, 18, 14, 14, tzinfo=timezone.utc), 18, "Priya", "INC-250218")
    add("Api5xxBurst", datetime(2025, 2, 18, 14, 11, tzinfo=timezone.utc), 24, "Priya", "INC-250218")
    add("CacheHitRateLow", datetime(2025, 2, 4, 19, 12, tzinfo=timezone.utc), 27, "Mira", "INC-250204")
    add("PaymentProviderLatency", datetime(2025, 2, 26, 17, 51, tzinfo=timezone.utc), 31, "Mira", "INC-250226")
    add("SearchIndexLag", datetime(2025, 2, 11, 6, 29, tzinfo=timezone.utc), 41, "Jon", "INC-250211")
    add("DeploymentFailure", datetime(2025, 2, 18, 14, 4, tzinfo=timezone.utc), 3, "Devin", "INC-250218")
    add("DiskSpaceLow", datetime(2025, 2, 7, 4, 20, tzinfo=timezone.utc), 18, "Rhea")
    add("TLSCertificateExpiry", datetime(2025, 2, 9, 12, 44, tzinfo=timezone.utc), 12, "Rhea")
    # The retired metric has no valid firing in this period, so it is absent from history.
    rows.sort(key=lambda row: row["start"])
    write_csv("history/alert-firings.csv", ["alert", "start", "end", "acked by", "linked incident"], rows)


def make_logs() -> None:
    api: list[str] = []
    worker: list[str] = []
    request_id = 100000
    routes = ["/v1/projects", "/v1/checkout", "/v1/search", "/healthz", "/v1/profile"]
    statuses = [(200, 78), (201, 8), (204, 5), (400, 4), (404, 2), (429, 1), (500, 1), (502, 1)]
    for day in range(30):
        date = START + timedelta(days=day)
        for i in range(92):
            minute = (i * 15 + RNG.randrange(0, 9)) % (24 * 60)
            dt = date + timedelta(minutes=minute, seconds=RNG.randrange(0, 60))
            rid = f"req-{request_id:07d}"
            request_id += 1
            route = RNG.choice(routes)
            status = RNG.choices([x[0] for x in statuses], weights=[x[1] for x in statuses])[0]
            duration = RNG.randrange(18, 280) if route != "/v1/search" else RNG.randrange(80, 620)
            api.append(f"{iso(dt)} INFO api-gateway request_id={rid} method=GET route={route} status={status} duration_ms={duration} cpu={RNG.uniform(0.22, 0.69):.2f}")
            if i % 17 == 0:
                api.append(f"{iso(dt + timedelta(seconds=3))} WARN api-gateway request_id={rid} retry=upstream attempt=1 backoff_ms={RNG.choice([50, 100, 250])} result=accepted")
            if i % 23 == 0:
                api.append(f"{iso(dt + timedelta(seconds=7))} INFO api-gateway check=healthz status=200 duration_ms={RNG.randrange(9, 35)}")
        for i in range(31):
            minute = (i * 47 + RNG.randrange(0, 20)) % (24 * 60)
            dt = date + timedelta(minutes=minute, seconds=RNG.randrange(0, 60))
            job = RNG.choice(["invoice-sync", "email-digest", "search-refresh", "usage-rollup"])
            state = RNG.choices(["done", "retrying", "skipped"], weights=[82, 12, 6])[0]
            worker.append(f"{iso(dt)} {RNG.choice(['INFO', 'INFO', 'WARN'])} job-runner job={job} state={state} queue_depth={RNG.randrange(8, 180)} age_seconds={RNG.randrange(2, 420)}")

    # Incident evidence is mixed into the same ordinary service stream.
    special = [
        "2025-02-18T14:03:11Z INFO api-gateway deploy version=2025.02.18.3 status=started request_id=req-9000101",
        "2025-02-18T14:11:02Z WARN api-gateway request_id=req-9000144 route=/v1/checkout error=database connection pool wait timeout wait_seconds=2.50",
        "2025-02-18T14:12:08Z ERROR api-gateway request_id=req-9000157 route=/v1/projects status=503 error=database connection pool exhausted",
        "2025-02-18T14:13:19Z WARN api-gateway metric=db_pool_in_use_ratio value=1.00 pool_capacity=80",
        "2025-02-18T14:14:06Z WARN api-gateway metric=db_pool_wait_seconds value=3.20 threshold=1.00",
        "2025-02-18T14:16:41Z INFO api-gateway metric=process_cpu_utilization value=0.41 requests_failed=high",
        "2025-02-18T14:31:07Z INFO api-gateway deploy version=2025.02.18.3 status=rolled_back",
        "2025-02-18T14:34:42Z INFO api-gateway request_id=req-9000320 route=/v1/checkout status=200 duration_ms=184",
        "2025-02-26T17:52:13Z WARN api-gateway retry=upstream provider=paygate attempt=2 result=timeout",
    ]
    api.extend(special)
    api.sort()
    worker.sort()
    write_text("logs/api-gateway.log", "\n".join(api))
    write_text("logs/job-runner.log", "\n".join(worker))


def make_static_files() -> None:
    write_text("README.md", """# Mossvale monitoring workspace

This folder contains the production alert definitions and the evidence used during the February 2025 on-call rotation for Mossvale, a web product for collaborative project work.

- `alerts/alert-rules.yml` is the deployed alert configuration.
- `catalogue/metrics.csv` is the current metric catalogue.
- `history/alert-firings.csv` contains alert starts and ends for the review window.
- `incidents/incidents.csv` is the incident register for the same month.
- `logs/` contains sampled service logs in UTC.
- `docs/` and `runbooks/` contain the notes available to the on-call engineer.

The CSV files use a header row. Times in operational records are UTC ISO 8601 strings. Alert names are case-sensitive in the rules file.""")
    write_text("alerts/alert-rules.yml", """groups:
  - name: northstar-edge
    service: web-api
    rules:
      - name: ApiHigh5xxRate
        expr: http_request_error_rate > 0.05
        for: 5m
        severity: page
        route: web-primary
        runbook: runbooks/api-errors.md
        owner: edge
      - name: ApiLatencyP95
        expr: http_request_duration_p95_ms > 850
        for: 5m
        severity: page
        route: web-primary
        runbook: runbooks/api-latency.md
        owner: edge
      - name: ApiCpuSaturation
        expr: process_cpu_utilization > 0.82
        for: 0m
        severity: page
        route: web-primary
        runbook: runbooks/api-latency.md
        owner: platform
      - name: Api5xxBurst
        expr: http_request_error_rate > 0.05
        for: 5m
        severity: page
        route: web-primary
        runbook: runbooks/api-errors.md
        owner: edge
      - name: ApiNoTraffic
        expr: http_requests_total == 0
        for: 0m
        severity: page
        route: web-primary
        runbook: ""
        owner: edge
      - name: RequestTimeoutRate
        expr: request_timeout_rate > 0.015
        for: 2m
        severity: page
        route: web-primary
        runbook: runbooks/api-latency.md
        owner: edge
      - name: HealthCheckDown
        expr: upstream_healthcheck_failures > 2
        for: 2m
        severity: page
        route: web-primary
        runbook: runbooks/health-checks.md
        owner: edge
      - name: LoginFailureSpike
        expr: auth_login_failure_rate > 0.20
        for: 10m
        severity: ticket
        route: identity-queue
        runbook: runbooks/login-failures.md
        owner: identity
      - name: PaymentProviderLatency
        expr: payment_provider_latency_ms > 1800
        for: 10m
        severity: ticket
        route: billing-queue
        runbook: runbooks/payment-provider.md
        owner: billing

  - name: northstar-data
    service: data-plane
    rules:
      - name: DbConnectionPoolExhaustion
        expr: db_pool_used_ratio > 0.90
        for: 3m
        severity: page
        route: data-primary
        runbook: runbooks/db-connections.md
        owner: data
      - name: QueueDepthSpike
        expr: worker_queue_depth > 500
        for: 0m
        severity: page
        route: jobs-primary
        runbook: runbooks/queue-backlog.md
        owner: jobs
      - name: QueueAgeHigh
        expr: worker_queue_age_seconds > 900
        for: 10m
        severity: page
        route: jobs-primary
        runbook: runbooks/queue-backlog.md
        owner: jobs
      - name: WorkerErrorRate
        expr: worker_error_rate > 0.08
        for: 10m
        severity: page
        route: jobs-primary
        runbook: runbooks/worker-errors.md
        owner: jobs
      - name: CacheHitRateLow
        expr: cache_hit_ratio < 0.70
        for: 15m
        severity: ticket
        route: edge-queue
        runbook: runbooks/cache.md
        owner: edge
      - name: SearchIndexLag
        expr: search_index_lag_seconds > 1200
        for: 15m
        severity: ticket
        route: search-queue
        runbook: runbooks/search-lag.md
        owner: search
      - name: DiskSpaceLow
        expr: disk_free_ratio < 0.15
        for: 15m
        severity: ticket
        route: platform-queue
        runbook: runbooks/disk-space.md
        owner: platform
      - name: DeploymentFailure
        expr: deployment_failure_total > 0
        for: 0m
        severity: page
        route: release-primary
        runbook: runbooks/deploy-failure.md
        owner: release
      - name: TLSCertificateExpiry
        expr: tls_cert_days_remaining < 21
        for: 1h
        severity: ticket
        route: platform-queue
        runbook: runbooks/certificates.md
        owner: platform
""")
    write_text("docs/oncall-handoff.md", """# February on-call handoff

The rotation covered the web API, background jobs, identity, search, and billing queues. Keep an eye on the handoff channel for provider maintenance windows. The primary rotation was Mira, Jon, Priya, Devin, and Rhea; the secondary was the platform team.

The API has a regular evening traffic peak. Health checks and request errors are the fastest signals when a user-facing path is unavailable. Background work can remain busy after the customer-facing path recovers, so check both queue age and queue depth.

During the month, responders often acknowledged alerts before opening the incident register. The history export records the acknowledger, not the reason for the acknowledgement.

Handoff date: 2025-03-03T09:00:00Z
""")
    write_text("docs/alert-tuning-notes.md", """# Alert review notes

This is an old working note from the February rotation. It is not a source of truth for thresholds. Compare alert behavior with the metrics catalogue, alert history, incident register, and service logs before changing a rule.

The release team asked for a review that considers customer impact, alert frequency, duration, ownership, and the available runbook. A ticket is still useful for work that needs follow-up but does not need an immediate page.

Last edited: 2025-02-12 by Rhea
""")
    write_text("runbooks/index.md", """# Runbook index

| topic | path | owner |
| --- | --- | --- |
| API errors | runbooks/api-errors.md | edge |
| API latency | runbooks/api-latency.md | edge |
| database connections | runbooks/db-connections.md | data |
| health checks | runbooks/health-checks.md | edge |
| queue backlog | runbooks/queue-backlog.md | jobs |
| worker errors | runbooks/worker-errors.md | jobs |
| payment provider | runbooks/payment-provider.md | billing |
| search lag | runbooks/search-lag.md | search |
| cache | runbooks/cache.md | edge |
| disk space | runbooks/disk-space.md | platform |
| deploy failure | runbooks/deploy-failure.md | release |
| certificates | runbooks/certificates.md | platform |
| login failures | runbooks/login-failures.md | identity |
""")
    write_text("runbooks/api-errors.md", """# API errors

Page the web primary when the five-minute 5xx share stays above the alert threshold. Check request error rate, health checks, and recent deploys. Link the incident and record the affected route.
""")
    write_text("runbooks/api-latency.md", """# API latency

Compare percentile latency with the normal hour-of-day pattern. Check request timeouts, upstream calls, and database wait time before escalating. A high process metric without a corresponding request symptom is a platform investigation.
""")
    write_text("runbooks/db-connections.md", """# Database connections

Check pool usage, wait time, application errors, and the last web-api deploy. If callers wait for a connection, protect the customer path first and record the affected endpoints.
""")
    write_text("runbooks/queue-backlog.md", """# Queue backlog

Use queue age to judge customer impact. Inspect depth, worker errors, provider retries, and the oldest message. Page for work that is approaching its delivery objective.
""")
    write_text("runbooks/health-checks.md", """# Health checks

Confirm the failed check from a second location, then compare it with request errors and deploy status. A single failed probe can be transient; sustained failures on the public path need a page.
""")
    write_text("runbooks/worker-errors.md", """# Worker errors

Review error samples, retry counts, queue age, and the owning job. Page when failed jobs are causing customer-visible delay; otherwise link the ticket to the job owner.
""")
    write_text("scripts/check_alerts.py", """#!/usr/bin/env python3
from pathlib import Path

text = Path('alerts/alert-rules.yml').read_text(encoding='utf-8')
print(f'{text.count("- name:")} alert entries found')
""")
    write_text("scripts/summarize_firings.sh", """#!/bin/sh
set -eu
awk -F, 'NR > 1 { count[$1]++ } END { for (name in count) print count[name], name }' history/alert-firings.csv | sort -nr
""")
    write_text("notes/maintenance-calendar.md", """# Maintenance calendar

The routine maintenance window is Wednesday 02:00-03:00 UTC. Certificate renewal checks run on the first Tuesday. Provider maintenance notices belong in the billing handoff.

This note is retained for scheduling context and does not define alert thresholds.
""")
    write_text("notes/old-dashboard-migration.md", """# Archived dashboard migration note

The old dashboard export was moved to cold storage after the team changed the chart layout. Keep this note for historical screenshots only.

Archived 2024-11-06.
""")
    write_text("config/notification-routes.yml", """routes:
  web-primary:
    channel: pager
    escalation: web-oncall
  data-primary:
    channel: pager
    escalation: data-oncall
  jobs-primary:
    channel: pager
    escalation: jobs-oncall
  identity-queue:
    channel: ticket
    queue: identity
  billing-queue:
    channel: ticket
    queue: billing
  edge-queue:
    channel: ticket
    queue: edge
  search-queue:
    channel: ticket
    queue: search
  platform-queue:
    channel: ticket
    queue: platform
  release-primary:
    channel: pager
    escalation: release-oncall
""")


def main() -> None:
    if ROOT.exists():
        for child in sorted(ROOT.rglob("*"), reverse=True):
            if child.is_file():
                child.unlink()
            elif child.is_dir():
                child.rmdir()
    ROOT.mkdir(parents=True, exist_ok=True)
    make_catalogue()
    make_deploys()
    make_incidents()
    make_alert_history()
    make_logs()
    make_static_files()


if __name__ == "__main__":
    main()
