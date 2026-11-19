#!/usr/bin/env python3
"""Create the invented collaboration-service fixture."""
from __future__ import annotations

import csv
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixture"
rng = random.Random(20250317)

for d in (ROOT / "docs", ROOT / "runbooks", ROOT / "config", ROOT / "deploy", ROOT / "logs", ROOT / "scripts", ROOT / "notes"):
    d.mkdir(parents=True, exist_ok=True)


def put(rel: str, text: str) -> None:
    (ROOT / rel).write_text(text.rstrip() + "\n", encoding="utf-8")


put("README.md", """# RelayRoom platform folder

RelayRoom is the internal name for the realtime collaboration service. This folder is the working set used by the platform team when reviewing production changes. It contains service notes, operational data, deployment records, and a few retained team notes.

The production fleet has forty Linux hosts across three zones. Clients keep websocket sessions open while they edit shared rooms. The platform owns the edge gateway, session router, presence workers, and collaboration API; the database team owns the shared database.

The data covers 19 August 2025 unless a document says otherwise. Timestamps in logs are UTC. Host names and identifiers are synthetic.

The scripts directory contains small operator helpers. They do not install dependencies or call external systems.
""")

put("docs/capacity-report.md", """# Capacity review, 2025-08-20

Owner: platform operations

| Measure | Observed value |
| --- | --- |
| Production hosts | 40 hosts |
| Normal fleet CPU utilisation | 72% |
| Operating ceiling used for planning | 80% |
| Spare capacity at the planning ceiling | 3.2 host-equivalents |\n| Raw capacity before the ceiling | 11.2 host-equivalents |
| Typical websocket sessions | 18,000 |

The 72% value is the 30-day fleet median. The busiest weekday hour reached 77%. Review capacity if normal fleet CPU utilisation reaches 78%. A deployment pattern that needs another full 40-host serving fleet cannot fit inside the spare capacity or the approved monthly expansion. Host reservations are not elastic during a release.

The fleet is split 18/12/10 across zones north, central, and south. Session-router placement is balanced across all three zones.
""")

put("docs/finance-note.md", """# Platform finance note, 2025-08-21

The approved monthly incremental infrastructure spend for release safety is **$2,800 USD**. This is a cap, not a target.

A second serving fleet of 40 hosts would add **$7,200 USD per month**, before temporary observability charges. A small parallel slice of four hosts costs about $720 per month. The finance review does not approve a standing second fleet.

The estimate assumes the existing fleet stays in service. It does not include database replicas or engineer time.
""")

put("docs/slo.md", """# Realtime collaboration SLO notes

The customer-facing availability objective is 99.95% for room operations. The websocket connection objective is 99.9% successful connection establishment per 28-day window.

Sessions are long lived. The p95 drain time is **40 minutes** after a host stops accepting new websocket connections; the p99 is 47 minutes. A release must preserve existing sessions while it moves new sessions away from a host.

The session router retries an upstream connection twice with jitter. The presence service is allowed to lag for 30 seconds before its alert fires.
""")

put("docs/schema-compatibility.md", """# Shared database compatibility note

The collaboration API and the room-index worker use one shared PostgreSQL database. During a release, the database schema must support **two application versions at once**. Additive changes are safe for the overlap; a column rename or destructive type change needs a separate migration window.

The last approved migration used an additive nullable column and was followed by a cleanup release. The database team does not provide a transaction rollback for application binaries.
""")

put("docs/deploy-goals.md", """# Delivery goals

The platform group has a production delivery goal of **3 deploys per week** while keeping the connection SLO green. The goal is measured over a rolling four-week period, excluding emergency reversions.

A release path should be repeatable by the on-call engineer and should not require a reserved duplicate fleet.
""")

put("docs/compliance-note.md", """# Release control note

The customer-data control requires a failed production release to be reverted or stopped within **12 minutes** of the release health signal. The release owner must preserve the UTC event time and the health signal in the change record.

Stopping further exposure counts as an immediate containment step. A full binary revert still follows the service runbook.
""")

put("docs/incident-list.md", """# Selected incident list

## RR-221, 2025-08-19

At 14:32 UTC, websocket connection errors rose while a session-router release was in progress. The first page named database latency because room writes also slowed. Database CPU and commit latency stayed within their normal bands. Session-router logs recorded upstream connection-pool waiting followed by retries from already-connected clients. The nearby change record includes a per-host upstream-pool setting transition from 240 to 120. The incident was contained by stopping the rollout and restoring the prior setting.

## RR-217, 2025-08-07

A presence-worker binary increased room fanout latency for nine minutes. The release was stopped after the first zone and no customer data was lost. The alert fired before the second zone began.

## RR-209, 2025-07-29

A database migration exposed an old client query for six minutes. The additive compatibility step was missing from the change record. The application rollback was safe because both binaries still understood the old column.

The list is incomplete and is retained for release planning context.
""")

put("docs/old-release-wiki.md", """# Release discussion copied from the old wiki

The old note says, "we should do blue/green like everyone." It would make the switch feel clean and give us an obvious old environment. This note predates the current host budget and the long-session measurements. It has no owner and is retained because people still link to it.
""")

put("runbooks/deploy.md", """# Production release runbook

1. Confirm the change record, compatible database migration, and current fleet health.
2. Stop accepting new sessions on the selected hosts. Wait for the drain alarm to clear or record the remaining sessions.
3. Start the new binary on the first exposure set. Check connection success, websocket close rate, room-operation error rate, upstream pool wait, and presence lag.
4. Hold the exposure for enough traffic to cover normal room churn. Continue only if all release alerts remain quiet.
5. If the health signal fails, stop exposure, preserve the UTC timestamp, and restore the last known-good binary or setting.
6. Record every exposure change and the final session drain in the change record.

The on-call engineer may stop a release without waiting for a second approver.
""")

put("runbooks/websocket-drain.md", """# Websocket drain notes

A host in drain mode rejects new websocket assignments but keeps established sessions. The session router reports `drain_remaining` every 30 seconds. Do not kill a host merely because a normal drain takes longer than one polling interval.

Escalate when the p95 drain exceeds 40 minutes, when close codes change unexpectedly, or when a drained host continues receiving new assignments.
""")

put("config/service.yaml", """service: relayroom
fleet:
  hosts: 40
  zones: [north, central, south]
release:
  health_signal_window_minutes: 5
  change_record_required: true
websocket:
  upstream_pool_per_host: 240
  drain_poll_seconds: 30
  retry_attempts: 2
alerts:
  - websocket_connect_error_rate
  - room_operation_error_rate
  - upstream_pool_wait_ms
  - presence_lag_seconds
""")

put("config/alerts.yaml", """alerts:
  websocket_connect_error_rate:
    page_above_percent: 0.8
    window_minutes: 5
  room_operation_error_rate:
    page_above_percent: 0.4
    window_minutes: 5
  upstream_pool_wait_ms:
    page_above_ms: 250
    window_minutes: 3
  presence_lag_seconds:
    page_above_seconds: 30
    window_minutes: 5
  host_cpu_percent:
    warn_above_percent: 80
    window_minutes: 10
""")

put("config/hosts.json", json.dumps({
    "service": "relayroom",
    "zones": {
        "north": [f"rr-n-{i:02d}" for i in range(1, 19)],
        "central": [f"rr-c-{i:02d}" for i in range(1, 13)],
        "south": [f"rr-s-{i:02d}" for i in range(1, 11)],
    },
    "roles": {"session-router": 16, "edge-gateway": 8, "presence-worker": 8, "collab-api": 8},
}, indent=2) + "\n")

put("scripts/check_drain.sh", """#!/bin/sh
# Print the fields an operator should compare during a drain.
printf '%s\n' 'drain_remaining close_rate new_assignments upstream_pool_wait_ms'
""")
put("scripts/summarize.py", """#!/usr/bin/env python3
import csv
import sys

with open(sys.argv[1], newline='', encoding='utf-8') as fh:
    rows = list(csv.DictReader(fh))
print('rows:', len(rows))
print('services:', ', '.join(sorted({r['service'] for r in rows})))
""")
put("notes/meeting-2024-11.md", """# Retained meeting note

The team discussed whether room names should be case-sensitive. No decision was recorded. This note is unrelated to release mechanics and is kept because the link is in an old project index.
""")
put("notes/retired-alert-tuning.md", """# Retired alert tuning

The 2024 alert for typing indicators was noisy during regional maintenance. It was retired after the new presence-lag alert shipped. Do not use this note to set current thresholds.
""")

# Generated deploy history: ordinary releases across several services, with a few reversions.
services = ["edge-gateway", "session-router", "presence-worker", "collab-api"]
versions = {s: 180 for s in services}
start = datetime(2025, 7, 1, tzinfo=timezone.utc)
deploy_rows = []
for i in range(126):
    service = services[i % len(services)]
    t = start + timedelta(hours=i * 13 + rng.randrange(0, 4))
    versions[service] += 1
    outcome = "completed"
    duration = rng.randrange(4, 13)
    if i in (31, 58, 93):
        outcome = "reverted"
        duration = rng.randrange(7, 11)
    deploy_rows.append({
        "time_utc": t.isoformat().replace("+00:00", "Z"),
        "service": service,
        "version": f"2025.07.{versions[service]}",
        "exposure": rng.choice(["one-zone", "two-zone", "fleet"]),
        "outcome": outcome,
        "duration_minutes": duration,
        "operator": rng.choice(["alina", "marco", "devon", "rhea"]),
    })
with (ROOT / "deploy/deploy-history.csv").open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(deploy_rows[0]))
    writer.writeheader()
    writer.writerows(deploy_rows)

# Metric catalogue and a day of samples. Values include ordinary variation and a short incident window.
metric_names = ["host_cpu_percent", "websocket_connect_error_rate", "room_operation_error_rate", "upstream_pool_wait_ms", "presence_lag_seconds", "active_websocket_sessions"]
with (ROOT / "config/metrics.csv").open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["metric", "unit", "service", "description"])
    descriptions = {
        "host_cpu_percent": ("percent", "fleet", "fleet CPU utilisation"),
        "websocket_connect_error_rate": ("percent", "edge-gateway", "failed websocket connection percentage"),
        "room_operation_error_rate": ("percent", "collab-api", "room operation failures"),
        "upstream_pool_wait_ms": ("milliseconds", "session-router", "wait for an upstream websocket connection"),
        "presence_lag_seconds": ("seconds", "presence-worker", "presence update lag"),
        "active_websocket_sessions": ("sessions", "session-router", "active websocket sessions"),
    }
    for name in metric_names:
        writer.writerow([name, *descriptions[name]])

metric_rows = []
base = datetime(2025, 8, 19, tzinfo=timezone.utc)
for minute in range(0, 24 * 60, 5):
    t = base + timedelta(minutes=minute)
    for metric in metric_names:
        if metric == "host_cpu_percent": value = round(68 + rng.random() * 9, 2)
        elif metric == "websocket_connect_error_rate": value = round(0.12 + rng.random() * 0.22, 3)
        elif metric == "room_operation_error_rate": value = round(0.08 + rng.random() * 0.16, 3)
        elif metric == "upstream_pool_wait_ms": value = round(35 + rng.random() * 55, 2)
        elif metric == "presence_lag_seconds": value = round(4 + rng.random() * 12, 2)
        else: value = round(16500 + rng.random() * 2800)
        if datetime(2025, 8, 19, 14, 32, tzinfo=timezone.utc) <= t <= datetime(2025, 8, 19, 14, 47, tzinfo=timezone.utc):
            if metric == "websocket_connect_error_rate": value = round(1.1 + rng.random() * 0.8, 3)
            elif metric == "room_operation_error_rate": value = round(0.45 + rng.random() * 0.35, 3)
            elif metric == "upstream_pool_wait_ms": value = round(310 + rng.random() * 180, 2)
            elif metric == "presence_lag_seconds": value = round(35 + rng.random() * 24, 2)
        metric_rows.append([t.isoformat().replace("+00:00", "Z"), metric, value])
with (ROOT / "config/metric-samples.csv").open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["time_utc", "metric", "value"])
    writer.writerows(metric_rows)

# Realistic all-day logs. The inserted incident lines are mixed with ordinary traffic.
log_specs = {
    "logs/edge-gateway.log": "edge-gateway",
    "logs/session-router.log": "session-router",
    "logs/presence-worker.log": "presence-worker",
    "logs/collab-api.log": "collab-api",
}
levels = ["INFO", "INFO", "INFO", "DEBUG", "WARN"]
messages = {
    "edge-gateway": [
        "health check passed zone=north status=200",
        "websocket handshake completed room=room-{room} status=101",
        "request completed method=GET path=/v1/rooms/{room} status=200 latency_ms={lat}",
        "retrying upstream request attempt=1 reason=temporary_unavailable",
        "slow request method=GET path=/v1/rooms/{room} status=200 latency_ms={slow}",
    ],
    "session-router": [
        "health check passed assigned={assigned} drain_remaining={drain}",
        "websocket assigned host=rr-n-{host:02d} room=room-{room} pool_wait_ms={pool}",
        "session closed code=1000 duration_min={duration}",
        "retrying upstream connection attempt=1 backoff_ms=80",
        "slow request method=POST path=/route latency_ms={slow}",
    ],
    "presence-worker": [
        "health check passed queue_depth={queue}",
        "fanout completed room=room-{room} subscribers={subs} latency_ms={lat}",
        "retrying presence publish attempt=1 reason=temporary_unavailable",
        "slow request method=POST path=/presence latency_ms={slow}",
        "checkpoint persisted offset={offset}",
    ],
    "collab-api": [
        "health check passed db_commit_ms={db}",
        "request completed method=POST path=/v1/rooms/{room}/ops status=200 latency_ms={lat}",
        "database query retried attempt=1 reason=serialization_conflict",
        "slow request method=POST path=/v1/rooms/{room}/ops status=200 latency_ms={slow}",
        "request completed method=GET path=/v1/rooms/{room} status=200 latency_ms={lat}",
    ],
}

incident_time = datetime(2025, 8, 19, 14, 32, 10, tzinfo=timezone.utc)
incident_lines = {
    "session-router": [
        (incident_time, "WARN", "config reload completed key=upstream_pool_per_host old=240 new=120 change_id=chg-8841"),
        (incident_time + timedelta(seconds=18), "WARN", "upstream connection pool wait exceeded threshold pool_wait_ms=418 active=120 queued=37"),
        (incident_time + timedelta(seconds=31), "ERROR", "websocket assignment failed reason=upstream_pool_exhausted retrying=true"),
        (incident_time + timedelta(seconds=44), "WARN", "retry burst observed attempts=2 reconnects=86 window_seconds=30"),
        (incident_time + timedelta(minutes=2), "INFO", "release exposure stopped reason=health_signal"),
        (incident_time + timedelta(minutes=5), "INFO", "config reload completed key=upstream_pool_per_host old=120 new=240 change_id=chg-8841-revert"),
        (incident_time + timedelta(minutes=8), "INFO", "pool wait recovered pool_wait_ms=72 queued=0"),
    ],
    "edge-gateway": [
        (incident_time + timedelta(seconds=49), "WARN", "websocket connect error rate elevated percent=1.41 upstream=session-router"),
        (incident_time + timedelta(minutes=3), "INFO", "edge traffic stable status=200 database_latency_ms=42"),
    ],
    "presence-worker": [
        (incident_time + timedelta(minutes=1), "WARN", "presence lag elevated seconds=41 cause=upstream_backpressure"),
        (incident_time + timedelta(minutes=7), "INFO", "queue depth recovered depth=12"),
    ],
    "collab-api": [
        (incident_time + timedelta(seconds=52), "INFO", "database query latency normal commit_ms=38 cpu_percent=54"),
        (incident_time + timedelta(minutes=4), "WARN", "room operation retry rate elevated percent=0.62 reason=client_reconnects"),
    ],
}

for rel, service in log_specs.items():
    rows = []
    t = base
    for i in range(560):
        t = base + timedelta(seconds=int(i * (86400 / 560)) + rng.randrange(0, 35))
        level = rng.choice(levels)
        template = rng.choice(messages[service])
        vals = {
            "room": rng.randrange(100, 999), "lat": rng.randrange(8, 180), "slow": rng.randrange(650, 1500),
            "assigned": rng.randrange(80, 240), "drain": rng.randrange(0, 18), "host": rng.randrange(1, 19),
            "pool": rng.randrange(12, 140), "duration": rng.randrange(1, 41), "queue": rng.randrange(0, 45),
            "subs": rng.randrange(2, 80), "offset": rng.randrange(10000, 90000), "db": rng.randrange(12, 70),
        }
        msg = template.format(**vals)
        rid = f"req-{rng.randrange(10**7, 10**8):08d}"
        rows.append((t, level, rid, msg))
    rows.extend((t, level, f"req-{rng.randrange(10**7, 10**8):08d}", msg) for t, level, msg in incident_lines.get(service, []))
    rows.sort(key=lambda x: x[0])
    with (ROOT / rel).open("w", encoding="utf-8") as fh:
        for t, level, rid, msg in rows:
            fh.write(f"{t.isoformat().replace('+00:00', 'Z')} {level} request_id={rid} service={service} {msg}\n")

# Set executable bits for the two tiny helpers.
(ROOT / "scripts/check_drain.sh").chmod(0o755)
(ROOT / "scripts/summarize.py").chmod(0o755)
