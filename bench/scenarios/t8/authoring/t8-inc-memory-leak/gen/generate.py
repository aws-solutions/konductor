#!/usr/bin/env python3
"""Create the search service operations fixture."""
from __future__ import annotations

import csv
import datetime as dt
import math
import random
import shutil
from pathlib import Path

SEED = 781204
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixture"
UTC = dt.timezone.utc
rng = random.Random(SEED)


def iso(value: dt.datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def mkdir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write(path: str, text: str) -> None:
    target = OUT / path
    mkdir(target)
    target.write_text(text, encoding="utf-8")


def make_static_files() -> None:
    write("README.md", """# Atlas search API operations folder

This folder contains a sampled four-day production record for the Atlas search API. The service ran eight containers behind the edge gateway. Times in operational data are UTC.

- `ops/logs/` contains gateway, API, indexer, and node-agent records.
- `ops/metrics/` contains five-minute container samples.
- `ops/deploy-history.csv`, `ops/traffic-report.csv`, and `ops/config/release-diff.yaml` describe changes and load.
- `docs/` has the normal operating notes used by the on-call rotation.

The records are a working set rather than a complete archive. Line numbers in the logs and configuration files are stable for incident references.
""")
    write("docs/architecture.md", """# Search API service map

The edge gateway accepts HTTPS requests and forwards them to eight `search-api` containers. Each API container reads the read-only shard index and sends refresh work to `indexer`. `node-agent` records process and cgroup readings. The gateway retries one failed upstream request once.

The container memory limit is 2048 MiB. Health checks run every 30 seconds and do not exercise the full query path. Container names are `search-01` through `search-08`.
""")
    write("docs/oncall.md", """# On-call notes

Normal response checks include the gateway 5xx rate, upstream latency, container restarts, and memory headroom. Compare the canary container with the release cohort before treating a traffic change as a service change.

A restart can remove a short-lived error burst without removing the condition that caused it. Preserve the first warning and the container lifecycle lines when collecting evidence.
""")
    write("docs/runbooks/restart-triage.md", """# Restart triage

1. Check the container lifecycle record and the node-agent memory reading.
2. Compare restart counts with request and error counts for the same five-minute windows.
3. Check the deploy record and configuration changes in effect before the first restart.
4. Keep one healthy version or canary in the comparison when possible.
5. Record the recovery change and confirm a full traffic interval after it.

The gateway's retry budget is four seconds. A failed upstream request is counted once in the API error metric even if the gateway retries it.
""")
    write("notes/2025-04-06-capacity-review.md", """# Capacity review notes

The April capacity review found comfortable disk headroom and a stable shard count. The next review was scheduled after the index refresh window. This note predates the sampled incident.
""")
    write("notes/2025-04-08-index-refresh.md", """# Index refresh note

The west shard refresh completed at 03:18 UTC. Refresh lag stayed below 11 seconds and the normal read-only index files were present on all hosts. No follow-up was required.
""")
    write("ops/config/release-diff.yaml", """release: 3.8.0
applied_at: 2025-04-08T14:00:00Z
service: search-api
changes:
  - key: query_cache.enabled
    from: false
    to: true
  - key: query_cache.key
    from: null
    to: full_query
  - key: query_cache.max_entries
    from: 0
    to: null
  - key: query_cache.ttl_seconds
    from: 0
    to: 900
  - key: response_compression.level
    from: 5
    to: 6
""")
    write("ops/change-record.yaml", """time: 2025-04-10T12:40:00Z
service: search-api
change: rollback
from_version: 3.8.0
to_version: 3.7.4
query_cache_enabled: false
operator: release-bot
""")
    write("ops/alerts.yaml", """alerts:
  - name: search-api-memory-headroom
    expression: container_memory_working_set_bytes / container_memory_limit_bytes > 0.91
    for: 10m
    severity: page
  - name: search-api-restarts
    expression: increase(container_restarts_total[15m]) > 1
    for: 5m
    severity: page
  - name: search-api-errors
    expression: rate(search_errors_total[5m]) > 0.025
    for: 10m
    severity: ticket
  - name: gateway-upstream-latency
    expression: p95(upstream_request_seconds) > 1.2
    for: 15m
    severity: ticket
""")
    write("ops/deploy-history.csv", """time,version,actor,scope,notes
2025-04-07T09:00:00Z,3.7.4,release-bot,search-api,baseline image refresh
2025-04-07T18:00:00Z,3.7.5,release-bot,search-api,shard reader timeout adjustment
2025-04-08T09:00:00Z,3.7.6,release-bot,search-api,request label cleanup
2025-04-08T14:00:00Z,3.8.0,release-bot,search-api,query response handling update
2025-04-09T12:00:00Z,3.8.1,release-bot,gateway,access log field update
2025-04-10T08:00:00Z,3.8.2,release-bot,indexer,refresh scheduling update
""")
    write("ops/traffic-report.csv", """date,window_utc,requests,distinct_queries,p95_ms,notes
2025-04-07,00:00-23:59,1842200,612400,184,normal weekday
2025-04-08,00:00-23:59,1918700,645900,189,normal weekday
2025-04-09,00:00-23:59,3375400,1286100,271,product launch campaign
2025-04-10,00:00-23:59,2498800,894300,238,launch tail
""")
    write("ops/scripts/check_memory.sh", """#!/bin/sh
set -eu
for f in ops/metrics/container-*.csv; do
  awk -F, 'NR == 1 { next } $4 > 1900 { print f ":" NR ":" $4 " MiB" }' f="$f" "$f"
done
""")
    write("ops/scripts/rotate-logs.sh", """#!/bin/sh
set -eu
find ops/logs -type f -name '*.log' -size +64M -print
""")
    write("ops/scripts/summarize_errors.py", """#!/usr/bin/env python3
import csv
import glob

errors = 0
for name in glob.glob('ops/metrics/container-*.csv'):
    with open(name, newline='', encoding='utf-8') as fh:
        for row in csv.DictReader(fh):
            errors += int(row['error_count'])
print(f'error_count={errors}')
""")
    write("ops/metrics/catalog.csv", """metric,unit,description
memory_mb,MiB,container working set
request_rate,requests_per_second,requests accepted by the API
error_count,requests,five-minute API failures
restarts,count,cumulative container restarts
 distinct_queries,count,unique full query strings observed since process start
cache_entries,count,entries retained by the response cache
""".replace(" distinct", "distinct"))


START = dt.datetime(2025, 4, 7, tzinfo=UTC)
RELEASE = dt.datetime(2025, 4, 8, 14, tzinfo=UTC)
FIRST_SYMPTOM = dt.datetime(2025, 4, 8, 15, 35, tzinfo=UTC)
MITIGATION = dt.datetime(2025, 4, 10, 12, 40, tzinfo=UTC)
RECOVERY = dt.datetime(2025, 4, 10, 13, 25, tzinfo=UTC)
CONTAINERS = [f"search-{n:02d}" for n in range(1, 9)]

KILL_TIMES = {
    "search-01": ["2025-04-09T06:20:00Z", "2025-04-09T14:10:00Z", "2025-04-09T20:35:00Z", "2025-04-10T02:05:00Z", "2025-04-10T07:30:00Z", "2025-04-10T12:35:00Z"],
    "search-02": ["2025-04-09T06:25:00Z", "2025-04-09T14:20:00Z", "2025-04-09T20:45:00Z", "2025-04-10T02:15:00Z", "2025-04-10T07:40:00Z", "2025-04-10T12:40:00Z"],
    "search-03": ["2025-04-09T06:30:00Z", "2025-04-09T14:30:00Z", "2025-04-09T20:55:00Z", "2025-04-10T02:25:00Z", "2025-04-10T07:50:00Z", "2025-04-10T12:35:00Z"],
    "search-04": ["2025-04-09T06:35:00Z", "2025-04-09T14:40:00Z", "2025-04-09T21:05:00Z", "2025-04-10T02:35:00Z", "2025-04-10T08:00:00Z", "2025-04-10T12:40:00Z"],
    "search-05": ["2025-04-09T06:40:00Z", "2025-04-09T14:50:00Z", "2025-04-09T21:15:00Z", "2025-04-10T02:45:00Z", "2025-04-10T08:10:00Z", "2025-04-10T12:35:00Z"],
    "search-06": ["2025-04-09T06:45:00Z", "2025-04-09T15:00:00Z", "2025-04-09T21:25:00Z", "2025-04-10T02:55:00Z", "2025-04-10T08:20:00Z", "2025-04-10T12:40:00Z"],
    "search-07": ["2025-04-09T06:50:00Z", "2025-04-09T15:10:00Z", "2025-04-09T21:35:00Z", "2025-04-10T03:05:00Z", "2025-04-10T08:30:00Z", "2025-04-10T12:35:00Z"],
    "search-08": [],
}


def dt_from(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def generate_metrics() -> None:
    for container in CONTAINERS:
        path = OUT / "ops" / "metrics" / f"container-{container}.csv"
        mkdir(path)
        rows = []
        kills = [dt_from(s) for s in KILL_TIMES[container]]
        t = START
        while t < START + dt.timedelta(days=4):
            version = "3.7.4"
            restarts = 0
            cache = 0
            distinct = 0
            if container != "search-08" and RELEASE <= t < MITIGATION:
                version = "3.8.0"
                prior = RELEASE
                for k in kills:
                    if k <= t:
                        restarts += 1
                        prior = k
                next_kill = next((k for k in kills if k > t), MITIGATION)
                span = max(1.0, (next_kill - prior).total_seconds())
                progress = max(0.0, min(0.98, (t - prior).total_seconds() / span))
                cache = int(1700 * progress)
                distinct = cache + int(130 * progress)
            elif container != "search-08" and t >= MITIGATION:
                version = "3.7.4"
                restarts = len(kills)
            else:
                version = "3.7.4"
            if version == "3.8.0":
                memory = 700 + cache * 0.80 + rng.uniform(-12, 12)
                base_rate = 96 + (t - START).total_seconds() / 86400 * 4
                if t.date() == dt.date(2025, 4, 9):
                    base_rate *= 1.78
                errors = rng.randint(0, 2)
                if any(abs((t - k).total_seconds()) <= 300 for k in kills):
                    errors += rng.randint(14, 26)
            else:
                memory = 760 + rng.uniform(-18, 18)
                base_rate = 98 + rng.uniform(-5, 5)
                if t.date() == dt.date(2025, 4, 9):
                    base_rate *= 1.78
                errors = rng.randint(0, 1)
            if t >= MITIGATION:
                errors = rng.randint(0, 1)
            rows.append([
                iso(t), container, version, f"{memory:.1f}", f"{base_rate:.1f}", str(errors), str(restarts), str(distinct), str(cache)
            ])
            t += dt.timedelta(minutes=5)
        with path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["timestamp", "container", "version", "memory_mb", "request_rate", "error_count", "restarts", "distinct_queries", "cache_entries"])
            w.writerows(rows)


def generate_logs() -> None:
    service_names = ["gateway", "search-api", "indexer", "node-agent"]
    explicit = {}
    def add(day: str, when: dt.datetime, service: str, level: str, message: str) -> None:
        explicit.setdefault(day, []).append(f"{iso(when)} {level} {service} {message}")

    add("2025-04-08", FIRST_SYMPTOM, "search-api", "WARN", "container=search-03 rss=834MiB cache_entries=163 distinct_queries=175 version=3.8.0 memory growth above baseline")
    add("2025-04-08", FIRST_SYMPTOM + dt.timedelta(minutes=5), "node-agent", "INFO", "container=search-03 working_set=846MiB limit=2048MiB sample=memory")
    add("2025-04-09", dt_from("2025-04-09T09:00:00Z"), "gateway", "INFO", "campaign traffic window started requests_per_second=812 distinct_queries_per_second=308")
    add("2025-04-09", dt_from("2025-04-09T09:01:00Z"), "gateway", "WARN", "traffic rate above weekday forecast; upstream error rate remains below alert threshold")
    for container, stamps in KILL_TIMES.items():
        for stamp in stamps:
            when = dt_from(stamp)
            add(when.strftime("%Y-%m-%d"), when, "node-agent", "ERROR", f"container={container} kernel_oom_event=1 memory_limit=2048MiB action=SIGKILL")
            add(when.strftime("%Y-%m-%d"), when + dt.timedelta(seconds=2), "search-api", "ERROR", f"container={container} request_id=req-{when.strftime('%m%d%H%M')}-{container[-2:]} upstream terminated after out_of_memory restart_count=1")
            add(when.strftime("%Y-%m-%d"), when + dt.timedelta(seconds=18), "gateway", "WARN", f"upstream=search-api container={container} status=503 retry=1 retryable=true")
    add("2025-04-10", MITIGATION, "search-api", "INFO", "rollout completed version=3.7.4 query response path restored; cache configuration disabled")
    add("2025-04-10", RECOVERY, "node-agent", "INFO", "all search-api containers memory_headroom=stable restart_rate=0 error_rate=0.0015")
    add("2025-04-10", RECOVERY + dt.timedelta(minutes=5), "gateway", "INFO", "upstream 5xx rate returned to baseline after rollout")

    for day_offset in range(4):
        day = START + dt.timedelta(days=day_offset)
        day_name = day.strftime("%Y-%m-%d")
        records = []
        t = day
        while t < day + dt.timedelta(days=1):
            minute = t.hour * 60 + t.minute
            for service in service_names:
                rid = f"req-{day.strftime('%m%d')}-{minute:04d}-{rng.randrange(1000, 9999)}"
                if service == "gateway":
                    if minute % 173 == 0:
                        msg = f"request_id={rid} upstream=search-api status=503 retry=1 reason=connection_reset"
                        level = "WARN"
                    elif minute % 97 == 0:
                        msg = f"request_id={rid} upstream=search-api status=200 latency_ms={rng.randint(800, 1450)} slow_request=true"
                        level = "INFO"
                    else:
                        msg = f"request_id={rid} upstream=search-api status=200 latency_ms={rng.randint(28, 240)}"
                        level = "INFO"
                elif service == "search-api":
                    if minute % 211 == 0:
                        msg = f"request_id={rid} operation=search retry=1 status=200 reason=transient_shard_timeout"
                        level = "WARN"
                    else:
                        msg = f"request_id={rid} operation=search status=200 latency_ms={rng.randint(18, 310)}"
                        level = "INFO"
                elif service == "indexer":
                    if minute % 181 == 0:
                        msg = f"job=refresh shard={rng.randint(1, 12)} retry=1 reason=remote_read_timeout"
                        level = "WARN"
                    else:
                        msg = f"job=refresh shard={rng.randint(1, 12)} status=complete duration_ms={rng.randint(120, 780)}"
                        level = "INFO"
                else:
                    if minute % 149 == 0:
                        msg = f"container=search-{rng.randint(1,8):02d} health_check=ok cgroup_memory=nominal"
                        level = "INFO"
                    elif minute % 233 == 0:
                        msg = "disk_queue=moderate inode_check=ok retry=0"
                        level = "WARN"
                    else:
                        msg = f"health_check=ok containers=8 sample_id={rng.randrange(100000, 999999)}"
                        level = "INFO"
                records.append((t, f"{iso(t)} {level} {service} {msg}"))
            t += dt.timedelta(minutes=2)
        for line in explicit.get(day_name, []):
            records.append((dt_from(line[:20]), line))
        records.sort(key=lambda x: x[0])
        write(f"ops/logs/cluster-{day_name}.log", "\n".join(line for _, line in records) + "\n")


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    make_static_files()
    generate_metrics()
    generate_logs()


if __name__ == "__main__":
    main()
