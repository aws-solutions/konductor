#!/usr/bin/env python3
"""Create the fictional notification pipeline operations fixture."""
from __future__ import annotations

import csv
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixture"
SEED = 731904
rng = random.Random(SEED)
START = datetime(2025, 4, 17, 8, 0, tzinfo=timezone.utc)
INCIDENT_START = datetime(2025, 4, 17, 14, 7, tzinfo=timezone.utc)
INCIDENT_END = datetime(2025, 4, 17, 17, 18, tzinfo=timezone.utc)
RECOVERY = datetime(2025, 4, 17, 17, 19, tzinfo=timezone.utc)


def put(rel: str, text: str) -> None:
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text.rstrip() + "\n", encoding="utf-8")


def iso(dt: datetime, millis: int = 0) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + (f".{millis:03d}" if millis else "") + "Z"


def make_metrics() -> None:
    p = ROOT / "metrics" / "notification-metrics.csv"
    p.parent.mkdir(parents=True, exist_ok=True)
    fields = ["timestamp", "enqueue_rate", "consumer_lag", "processed_per_second", "retries", "dead_letter_count", "broker_disk_pct", "oldest_message_age_sec", "delayed_notifications_total"]
    with p.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        delayed = 0
        for i in range(12 * 60 + 1):
            t = START + timedelta(minutes=i)
            if INCIDENT_START <= t <= INCIDENT_END:
                n = int((t - INCIDENT_START).total_seconds() // 60)
                enqueue = 68 + (n % 7)
                lag = 320 + 15 * n
                pps = 1.0 + ((n % 4) * 0.05)
                retries = 48 + (n % 9)
                delayed = 15 * n
                disk = 91.2 - min(7.8, n * 0.87)
                age = 60 * (n + 1)
            elif t == RECOVERY:
                enqueue, lag, pps, retries, disk, age = 71, 12, 4.6, 8, 83.7, 0
            else:
                enqueue = 63 + (i * 11) % 18
                lag = 2 + (i * 3) % 6
                pps = round(4.4 + ((i * 7) % 8) / 10, 2)
                retries = (i * 5) % 4
                disk = round(74.0 + ((i * 13) % 90) / 10, 1)
                age = 2 + (i % 5)
            w.writerow({"timestamp": iso(t), "enqueue_rate": enqueue, "consumer_lag": lag, "processed_per_second": pps, "retries": retries, "dead_letter_count": 0, "broker_disk_pct": f"{disk:.1f}", "oldest_message_age_sec": age, "delayed_notifications_total": delayed})


def base_docs() -> None:
    put("README.md", """# ParcelPing notification pipeline operations folder

This folder contains the day shift evidence for ParcelPing's delivery notification path. The path accepts delivery events through `notify-api`, puts them on `notify.events`, and fans them into three consumers before calling the push gateway.

The timestamps in logs and metrics are UTC. Configuration snippets show the values loaded by the service unless a document says that it is a change record. The scripts are small read-only helpers used during on-call work.

The incident window is mixed into a full day of ordinary traffic. Routine health checks, retry noise, and capacity warnings are intentionally retained so that the records can be compared across services.
""")
    put("config/consumer-config.yaml", """service: notify-consumer
queue: notify.events
consumer_group: delivery-notifications
workers:
  - notify-consumer-a
  - notify-consumer-b
  - notify-consumer-c
payload_validation:
  recipient_type: string
retry:
  max_attempts: 0
  backoff_seconds: 5
  retryable_errors:
    - TimeoutError
    - PushGatewayUnavailable
dead_letter:
  enabled: false
  topic: ""
""")
    put("config/consumer-config-changes.yaml", """change_id: cfg-2025-04-17-1651
service: notify-consumer
applied_at: 2025-04-17T16:51:00Z
retry.max_attempts: 4
retry.backoff_seconds: 4
dead_letter.enabled: true
dead_letter.topic: notify.events.dead
payload_validation.recipient_type: string
""")
    put("alerts/notification-alerts.yaml", """alerts:
  - name: notify-consumer-lag
    metric: consumer_lag
    threshold: 250
    for_minutes: 5
    severity: page
  - name: notify-oldest-message
    metric: oldest_message_age_sec
    threshold: 900
    for_minutes: 10
    severity: page
  - name: broker-disk-high
    metric: broker_disk_pct
    threshold: 90
    for_minutes: 5
    severity: ticket
  - name: notify-retry-rate
    metric: retries
    threshold: 40
    for_minutes: 3
    severity: page
""")
    put("docs/architecture.md", """# Notification path

`notify-api` accepts an event and publishes it to `notify.events`. The broker retains the event by partition. Consumers A, B, and C share the delivery-notification group; each acknowledges an event only after the push gateway accepts it. The gateway returns a request ID that is logged by the consumer.

The consumer payload contract currently calls the destination field `recipient` and the configured type is a scalar string. Consumer A owns partition 2 during the period covered by these records.
""")
    put("docs/oncall-notes.md", """# Shift notes, 17 April

08:00 UTC handoff: the notification queue was quiet and push success was within the usual band. A few gateway timeouts were retried during the morning and cleared without operator action.

14:09 UTC: support reported that a delivery status appeared late. The API continued to acknowledge new events. The broker disk page was visible in the console while this was investigated.

16:44 UTC: the event stream was sampled and the oldest item was still on partition 2. The producer rollout was halted. The consumer configuration was changed at 16:51 UTC and consumer A was restarted after the new settings were loaded.

17:19 UTC: lag and oldest-message age returned to their normal range. The delayed-event count is taken from the per-minute metrics series, not from support ticket volume.
""")
    put("docs/metrics-catalog.md", """# Notification metric catalogue

The CSV uses one UTC row per minute. `enqueue_rate` is events per minute. `consumer_lag` is queued events. `processed_per_second` is events per second across the consumer group. `retries` is retry attempts recorded in that minute. `dead_letter_count` is events routed to a dead-letter topic. `broker_disk_pct` is broker disk usage as a percent. `oldest_message_age_sec` is the age of the oldest queued event in seconds. `delayed_notifications_total` is the cumulative count of notifications whose delivery exceeded the support delay threshold.
""")
    put("runbooks/notification-backlog.md", """# Notification backlog response

Check the API enqueue rate, group lag, oldest message age, retry volume, and broker disk separately. Confirm whether all partitions are moving before restarting a worker. Capture the event ID and partition from the consumer log before replaying anything.

For a worker restart, preserve the current logs and record the loaded configuration. If a payload cannot be handled safely, send it to the configured dead-letter destination rather than replaying it indefinitely. A replay should be limited to a small time range and watched for changes in lag.
""")
    put("runbooks/push-gateway.md", """# Push gateway checks

The gateway can return transient 429 and 503 responses. Consumers retry those responses with backoff. A successful call includes `gateway_request_id` and an acknowledgement line in the consumer log.

Use the gateway health endpoint only after checking queue movement. Gateway latency alone does not explain a partition that has stopped acknowledging events.
""")
    put("notes/last-incident.md", """# Previous shift note

On 03 April a short gateway outage caused a burst of 503 responses. The queue recovered after the gateway returned 200 responses. That event did not involve a consumer restart.
""")
    put("notes/capacity-review.md", """# Capacity review

The broker volume has 20 percent headroom under the ordinary traffic profile. Consumer group throughput is normally above four events per second. This note predates the current delivery-event schema rollout.
""")
    put("scripts/check_lag.py", """#!/usr/bin/env python3
import csv
import sys

with open(sys.argv[1], newline='', encoding='utf-8') as stream:
    rows = list(csv.DictReader(stream))
print(max(rows, key=lambda row: int(row['consumer_lag'])))
""")
    put("scripts/replay_window.py", """#!/usr/bin/env python3
import sys

if len(sys.argv) != 3:
    raise SystemExit('usage: replay_window.py START END')
print('review-only window', sys.argv[1], sys.argv[2])
""")
    put("scripts/rotate-old-logs.sh", """#!/bin/sh
# Dry-run list for the weekly log rotation review.
find logs -type f -name '*.log' -printf '%p\\n' | sort
""")
    put("docs/retention-policy.md", """# Evidence retention

Keep broker, API, consumer, and gateway logs for fourteen days. Keep per-minute metrics for ninety days. Incident working notes may contain request IDs but must not contain customer message bodies.
""")


def make_deploy_history() -> None:
    put("deploy/deploy-history.md", """# Deploy history

| UTC time | service | release | note |
|---|---|---|---|
| 2025-04-17T08:32:00Z | push-gateway | 2025.04.17-1 | routine dependency refresh |
| 2025-04-17T11:18:00Z | notify-consumer | 2025.04.17-2 | worker image refresh |
| 2025-04-17T12:12:00Z | broker | 2025.04.17-3 | routine metadata refresh |
| 2025-04-17T13:58:00Z | notify-api | 2025.04.17-4 | producer schema 4.8 enabled for delivery events; recipient is emitted as a list for multi-device targets |
| 2025-04-17T16:51:00Z | notify-consumer | 2025.04.17-5 | load consumer configuration change cfg-2025-04-17-1651 |
| 2025-04-17T16:55:00Z | notify-consumer | 2025.04.17-6 | restart worker A after configuration load |
""")


def log_line(t: datetime, level: str, service: str, message: str, millis: int = 0) -> str:
    return f"{iso(t, millis)} level={level} service={service} {message}"


def make_logs() -> None:
    paths = {
        "api": ROOT / "logs/api.log",
        "a": ROOT / "logs/consumer-a.log",
        "b": ROOT / "logs/consumer-b.log",
        "c": ROOT / "logs/consumer-c.log",
        "broker": ROOT / "logs/broker.log",
        "gateway": ROOT / "logs/push-gateway.log",
    }
    streams = {k: [] for k in paths}
    event_counter = 10000
    t = START
    while t <= datetime(2025, 4, 17, 20, 0, tzinfo=timezone.utc):
        minute_index = int((t - START).total_seconds() // 60)
        # API traffic and routine checks run throughout the day.
        streams["api"].append(log_line(t, "INFO", "notify-api", f"request_id=req-{minute_index:05d}-a enqueue accepted event_id=evt-{event_counter} status=202", 11))
        streams["api"].append(log_line(t, "INFO", "notify-api", f"request_id=req-{minute_index:05d}-b enqueue accepted event_id=evt-{event_counter + 1} status=202", 28))
        streams["api"].append(log_line(t, "INFO", "notify-api", f"request_id=req-{minute_index:05d}-c health path=/ready response=200 duration_ms={8 + minute_index % 12}", 44))
        streams["api"].append(log_line(t, "WARN", "notify-api", f"request_id=req-{minute_index:05d}-d upstream=profile timeout_ms={420 + minute_index % 70}", 59) if minute_index % 19 == 0 else log_line(t, "INFO", "notify-api", f"request_id=req-{minute_index:05d}-d enqueue accepted event_id=evt-{event_counter + 2} status=202", 59))
        if t == INCIDENT_START:
            streams["api"].append(log_line(t, "INFO", "notify-api", "request_id=req-incident-01 enqueue accepted event_id=evt-784221 schema=4.8 recipient=[\"device-31\",\"device-44\"] status=202", 731))
        event_counter += 3

        for worker, key in [("notify-consumer-a", "a"), ("notify-consumer-b", "b"), ("notify-consumer-c", "c")]:
            partition = {"a": 2, "b": 0, "c": 1}[key]
            if key == "a" and INCIDENT_START <= t <= INCIDENT_END:
                worker_lag = 320 + 15 * int((t - INCIDENT_START).total_seconds() // 60)
                worker_pps = 1.0 + ((minute_index - int((INCIDENT_START - START).total_seconds() // 60)) % 4) * 0.05
            else:
                worker_lag = 2 + minute_index % 6
                worker_pps = 4 + (minute_index % 5) / 10
            streams[key].append(log_line(t, "INFO", worker, f"health path=/ready response=200 partition={partition} lag={worker_lag}", 7 + partition))
            streams[key].append(log_line(t, "INFO", worker, f"poll partition={partition} records={3 + minute_index % 4} processed_per_second={worker_pps:.1f}", 21 + partition))
            streams[key].append(log_line(t, "INFO", worker, f"gateway request_id=gw-{minute_index:05d}-{key} response=200 latency_ms={90 + (minute_index * 7) % 140}", 39 + partition))
            streams[key].append(log_line(t, "INFO", worker, f"ack partition={partition} offset={minute_index * 9 + partition} batch={3 + minute_index % 4}", 52 + partition))
            streams[key].append(log_line(t, "WARN", worker, f"retryable gateway response=503 attempt=1 event_id=evt-{event_counter + partition} backoff_ms=500", 63) if minute_index % 23 == 0 else log_line(t, "DEBUG", worker, f"poller idle partition={partition} wait_ms={100 + minute_index % 30}", 63))

        streams["broker"].append(log_line(t, "INFO", "notify-broker", f"partition=0 append_rate={62 + minute_index % 15} records={3 + minute_index % 4} disk_pct={74 + ((minute_index * 13) % 90) / 10:.1f}", 5))
        streams["broker"].append(log_line(t, "INFO", "notify-broker", f"partition=1 append_rate={65 + minute_index % 11} records={2 + minute_index % 5} disk_pct={75 + ((minute_index * 9) % 70) / 10:.1f}", 23))
        streams["broker"].append(log_line(t, "INFO", "notify-broker", f"partition=2 append_rate={66 + minute_index % 10} records={4 + minute_index % 3} disk_pct={76 + ((minute_index * 5) % 80) / 10:.1f}", 41))
        streams["broker"].append(log_line(t, "INFO", "notify-broker", f"health path=/ready response=200 fsync_ms={4 + minute_index % 8}", 56))
        streams["gateway"].append(log_line(t, "INFO", "push-gateway", f"health path=/ready response=200 active_connections={120 + minute_index % 20}", 9))
        streams["gateway"].append(log_line(t, "INFO", "push-gateway", f"request_id=gw-{minute_index:05d}-a response=200 latency_ms={88 + minute_index % 120}", 26))
        streams["gateway"].append(log_line(t, "INFO", "push-gateway", f"request_id=gw-{minute_index:05d}-b response=200 latency_ms={95 + minute_index % 130}", 48))
        if minute_index % 17 == 0:
            streams["gateway"].append(log_line(t, "WARN", "push-gateway", f"rate_limit window=one_minute rejected={1 + minute_index % 3} retry_after_ms=1000", 55))

        if t == INCIDENT_START:
            streams["broker"].append(log_line(t, "WARN", "notify-broker", "alert=broker-disk-high usage_pct=91.2 threshold_pct=90 volume=queue-data", 905))
            streams["a"].append(log_line(t, "ERROR", "notify-consumer-a", "event_id=evt-784221 partition=2 decode_error=PayloadShapeError field=recipient expected=string actual=array", 912))
            streams["a"].append(log_line(t, "WARN", "notify-consumer-a", "event_id=evt-784221 partition=2 retry scheduled attempt=1 policy=max_attempts:0 backoff_seconds=5", 918))
        if t == INCIDENT_START + timedelta(minutes=1):
            streams["a"].append(log_line(t, "ERROR", "notify-consumer-a", "event_id=evt-784221 partition=2 processing failed; offset not acknowledged; retrying", 104))
            streams["broker"].append(log_line(t, "WARN", "notify-broker", "partition=2 consumer_lag=335 blocked_offset=784221 owner=notify-consumer-a", 117))
        if t == INCIDENT_START + timedelta(minutes=5):
            streams["a"].append(log_line(t, "WARN", "notify-consumer-a", "event_id=evt-784221 partition=2 retry scheduled attempt=17 policy=max_attempts:0 dead_letter=disabled", 220))
        if t == INCIDENT_START + timedelta(minutes=9):
            streams["broker"].append(log_line(t, "INFO", "notify-broker", "alert=broker-disk-high resolved usage_pct=83.4 threshold_pct=90 volume=queue-data", 610))
        if t == INCIDENT_START + timedelta(minutes=12):
            streams["a"].append(log_line(t, "WARN", "notify-consumer-a", "partition=2 lag=505 oldest_event=evt-784221 state=blocked retry_loop=true", 404))
        if t == INCIDENT_START + timedelta(minutes=28):
            streams["a"].append(log_line(t, "WARN", "notify-consumer-a", "event_id=evt-784221 partition=2 retry scheduled attempt=96 policy=max_attempts:0", 302))
        if t == datetime(2025, 4, 17, 16, 51, tzinfo=timezone.utc):
            streams["a"].append(log_line(t, "INFO", "notify-consumer-a", "configuration reloaded retry.max_attempts=4 dead_letter.enabled=true dead_letter.topic=notify.events.dead", 606))
        if t == datetime(2025, 4, 17, 16, 55, tzinfo=timezone.utc):
            streams["a"].append(log_line(t, "INFO", "notify-consumer-a", "worker restart complete partition=2 offset=784221 replay_mode=bounded", 333))
            streams["a"].append(log_line(t, "INFO", "notify-consumer-a", "event_id=evt-784221 partition=2 routed topic=notify.events.dead reason=PayloadShapeError", 347))
        if t == RECOVERY:
            streams["a"].append(log_line(t, "INFO", "notify-consumer-a", "partition=2 lag=12 oldest_age_sec=0 processing resumed throughput=4.6", 92))
            streams["broker"].append(log_line(t, "INFO", "notify-broker", "partition=2 consumer_lag=12 blocked_offset=none owner=notify-consumer-a", 111))
        t += timedelta(minutes=1)

    for key, p in paths.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("\n".join(streams[key]) + "\n", encoding="utf-8")


def main() -> None:
    if ROOT.exists():
        for p in sorted(ROOT.rglob("*"), reverse=True):
            if p.is_file():
                p.unlink()
            elif p.is_dir():
                p.rmdir()
    ROOT.mkdir(parents=True, exist_ok=True)
    base_docs()
    make_deploy_history()
    make_metrics()
    make_logs()


if __name__ == "__main__":
    main()
