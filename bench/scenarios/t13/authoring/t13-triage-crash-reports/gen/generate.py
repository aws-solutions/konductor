#!/usr/bin/env python3
"""Create the synthetic desktop-sync release triage folder."""
from __future__ import annotations

import csv
import json
import random
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "fixture"
RANDOM = random.Random(42173)
UTC = timezone.utc
START = datetime(2026, 3, 16, 8, 0, tzinfo=UTC)


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def report(report_id: int, kind: str, version: str, platform: str, user: str, dt: datetime) -> dict:
    if kind == "A":
        if platform == "Windows":
            frames = (["SyncRoot::resolveImpl", "SyncRoot::resolve", "SyncJob::openRoot", "SyncJob::begin", "Scheduler::run", "Worker::dispatch", "ThreadPool::invoke", "main"]
                      if report_id % 2 else
                      ["SyncRoot::resolve", "SyncRoot::resolveImpl", "SyncJob::openRoot", "SyncJob::begin", "Scheduler::run", "Worker::dispatch", "ThreadPool::invoke", "main"])
        else:
            frames = ["SyncRoot::resolve", "SyncJob::openRoot", "SyncJob::begin", "Scheduler::run", "Worker::dispatch", "ThreadPool::invoke", "EventLoop::poll", "main"]
        logs = ["sync root selected", "removable volume status checked", "sync session starting", "path lookup returned no location", "fatal exception captured"]
    elif kind == "B":
        frames = ["TrayIcon::refresh", "TrayIcon::setBadge", "ShellIntegration::update", "SyncStatus::changed", "EventLoop::poll", "ThreadPool::invoke", "App::run", "main"]
        logs = ["status update received", "tray state recalculated", "badge update requested", "shell notification queued", "fatal exception captured"]
    elif kind == "C":
        frames = ["LocalDatabase::read", "sqlite3_step", "LocalStore::loadRecord", "SyncIndex::lookup", "SyncSession::restore", "Worker::dispatch", "ThreadPool::invoke", "main"]
        logs = ["opening local index", "reading sync record", "database page checksum mismatch", "recovery could not continue", "fatal exception captured"]
    elif kind == "D":
        frames = ["ThumbnailCache::allocate", "OutOfMemory", "ThumbnailCache::put", "PreviewWorker::render", "Worker::dispatch", "ThreadPool::invoke", "App::run", "main"]
        logs = ["thumbnail decode completed", "cache insert requested", "memory pressure observed", "dropping pending uploads", "fatal exception captured"]
    else:
        frames = ["UiEventLoop::dispatch", "Window::paint", "Telemetry::flush", "EventLoop::poll", "App::run", "ThreadPool::invoke", "main", "start"]
        logs = ["periodic health check", "background task completed", "routine warning recorded", "telemetry batch flushed", "fatal exception captured"]
    os_version = {
        "Windows": RANDOM.choice(["11 23H2", "10 22H2"]),
        "macOS": RANDOM.choice(["14.4", "13.6"]),
        "Linux": RANDOM.choice(["Ubuntu 22.04", "Fedora 40"]),
    }.get(platform, "unknown")
    return {
        "id": f"crash-{report_id:04d}",
        "timestamp": iso(dt),
        "appVersion": version,
        "os": platform,
        "osVersion": os_version,
        "userHash": user,
        "topFrames": frames,
        "lastLogs": logs,
    }


def make_reports() -> None:
    crash_dir = FIXTURE / "crashes"
    crash_dir.mkdir(parents=True, exist_ok=True)
    report_id = 1
    records: list[dict] = []

    # A: 170 reports, 120 distinct users, split across Windows and macOS.
    for i in range(170):
        platform = "Windows" if i % 10 < 6 else "macOS"
        user = f"u-a-{i % 120:03d}"
        dt = START + timedelta(minutes=17 * i + (i % 5) * 3)
        rec = report(report_id, "A", "4.2.0", platform, user, dt)
        records.append(rec)
        report_id += 1

    # B: 45 current-release reports and 15 older reports, 55 users overall.
    for i in range(45):
        user = f"u-b-{i % 45:03d}" if i < 45 else f"u-b-{i % 55:03d}"
        dt = START + timedelta(minutes=23 * i + 11)
        rec = report(report_id, "B", "4.2.0", "macOS", user, dt)
        records.append(rec)
        report_id += 1
    for i in range(15):
        user = f"u-b-{40 + i:03d}"
        dt = START - timedelta(days=10, minutes=19 * i)
        rec = report(report_id, "B", "4.1.3", "macOS", user, dt)
        records.append(rec)
        report_id += 1

    # C: 40 reports from only three users; one user is especially noisy.
    c_users = ["u-c-001"] * 20 + ["u-c-002"] * 10 + ["u-c-003"] * 10
    for i, user in enumerate(c_users):
        dt = START + timedelta(minutes=9 * i + 5)
        rec = report(report_id, "C", "4.2.0", "Windows", user, dt)
        records.append(rec)
        report_id += 1

    # D: 20 Linux reports from 20 users and a data-loss signal in the tail logs.
    for i in range(20):
        dt = START + timedelta(minutes=29 * i + 7)
        rec = report(report_id, "D", "4.2.0", "Linux", f"u-d-{i + 1:03d}", dt)
        records.append(rec)
        report_id += 1

    # Ten beta reports are excluded from the release comparison.
    for i in range(10):
        dt = START - timedelta(days=90, minutes=13 * i)
        rec = report(report_id, "N", "3.9.0-beta2", RANDOM.choice(["Windows", "macOS", "Linux"]), f"u-n-{i + 1:03d}", dt)
        records.append(rec)
        report_id += 1

    RANDOM.shuffle(records)
    for index, rec in enumerate(records, start=1):
        # Keep report JSON compact, but vary file sizes with a harmless collector note.
        rec["collectorNote"] = "desktop client submitted a complete native crash envelope" if index % 4 else "desktop client submitted a complete crash envelope with symbol lookup metadata"
        name = f"{rec['id']}.json"
        (crash_dir / name).write_text(json.dumps(rec, separators=(",", ":")) + "\n", encoding="utf-8")


def make_logs() -> None:
    log_dir = FIXTURE / "ops" / "logs"
    lines: list[str] = []
    services = ["sync-api", "desktop-gateway", "symbolizer", "metrics-writer"]
    for i in range(1, 381):
        dt = START + timedelta(minutes=8 * i)
        service = services[i % len(services)]
        rid = f"req-{RANDOM.randrange(100000, 999999)}"
        if i % 31 == 0:
            msg = "health check completed status=200 latency_ms=42"
        elif i % 47 == 0:
            msg = "routine warning queue depth above soft limit"
        elif i % 53 == 0:
            msg = "retry scheduled attempt=2 backoff_ms=800"
        elif i % 67 == 0:
            msg = "slow request route=/crashes/search latency_ms=911"
        elif i % 29 == 0:
            msg = "symbol lookup completed frames=8"
        else:
            msg = "request completed status=200 latency_ms=" + str(35 + (i * 13) % 210)
        lines.append(f"{iso(dt)} service={service} request_id={rid} {msg}")
    # Deep operational lines provide evidence without making the first part of the file a summary.
    lines[251] = "2026-03-17T17:28:00Z service=desktop-gateway request_id=req-772041 crash batch grouped signature=SyncRoot::resolve removable-volume path lookup"
    lines[252] = "2026-03-17T17:28:08Z service=symbolizer request_id=req-772041 frames=8 symbols=complete platform=Windows"
    lines[319] = "2026-03-18T02:32:00Z service=sync-api request_id=req-558204 warning=dropping pending uploads reason=thumbnail cache memory pressure"
    lines[320] = "2026-03-18T02:32:04Z service=sync-api request_id=req-558204 status=503 retry scheduled attempt=1"
    write(log_dir / "desktop-sync.log", "\n".join(lines) + "\n")

    audit = []
    for i in range(1, 91):
        dt = START + timedelta(minutes=31 * i)
        audit.append(f"{iso(dt)} actor=release-bot action=collector-batch batch={i:03d} status=accepted")
    write(log_dir / "collector-audit.log", "\n".join(audit) + "\n")


def make_metrics() -> None:
    path = FIXTURE / "ops" / "metrics" / "crash-groups.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [["window_start", "metric", "platform", "value"]]
    for i in range(1, 121):
        dt = START + timedelta(hours=i)
        metric = RANDOM.choice(["crash_reports_total", "active_sessions", "symbolizer_latency_ms", "retry_queue_depth"])
        platform = RANDOM.choice(["Windows", "macOS", "Linux"])
        value = 40 + (i * 17) % 260
        rows.append([iso(dt), metric, platform, str(value)])
    with path.open("w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(rows)


def make_release_files() -> None:
    write(FIXTURE / "release" / "history.md", """# Desktop release history

- 4.1.3 — published 2026-02-23.
- 4.2.0 — published 2026-03-16 (Monday).

This file records publication dates only; incident evidence lives in the release packet and collector data.
""")
    write(FIXTURE / "release" / "notes-4.2.0.md", """# 4.2.0 release notes

The desktop client adds removable-drive sync support and improves status reporting for long-running transfers. It also updates thumbnail handling and tray presentation on supported desktop systems.

The release notes describe user-visible changes. They do not replace crash grouping or platform-level impact analysis.
""")
    diff_lines = ["diff --git a/src/ui/status.cpp b/src/ui/status.cpp", "index 81ab..92cd 100644", "--- a/src/ui/status.cpp", "+++ b/src/ui/status.cpp"]
    for i in range(1, 43):
        diff_lines.append(f" context status maintenance line {i}: preserve existing status rendering")
    diff_lines += ["@@ -44,6 +44,9 @@ void Status::refresh()", "+    cache.setLastRefresh(clock.now());", "+    notifyObservers();", "+    return;", "", "diff --git a/src/transfer/queue.cpp b/src/transfer/queue.cpp", "index 11aa..22bb 100644", "--- a/src/transfer/queue.cpp", "+++ b/src/transfer/queue.cpp"]
    for i in range(43, 78):
        diff_lines.append(f" context queue maintenance line {i}: retain transfer ordering")
    diff_lines += ["@@ -78,7 +78,11 @@ void Queue::resume()", "+    metrics.record(\"resume\");", "+    wakeWorkers();", "+    return;", "", "diff --git a/src/sync/root.cpp b/src/sync/root.cpp", "index 44cd..55ef 100644", "--- a/src/sync/root.cpp", "+++ b/src/sync/root.cpp"]
    for i in range(78, 91):
        diff_lines.append(f" context sync root maintenance line {i}: retain volume bookkeeping")
    diff_lines += ["@@ -91,8 +91,16 @@ Path SyncRoot::resolve(const Volume& volume)", "-    auto root = volume.syncPath();", "+    auto root = volume.isRemovable() ? volume.attachedSyncPath() : volume.syncPath();", "+    if (volume.isRemovable()) {", "+        root = normalizePath(root);", "+    }", "+    return root;", "", "diff --git a/src/sync/scheduler.cpp b/src/sync/scheduler.cpp", "index 66de..77fa 100644", "--- a/src/sync/scheduler.cpp", "+++ b/src/sync/scheduler.cpp"]
    for i in range(92, 115):
        diff_lines.append(f" context scheduler maintenance line {i}: preserve worker fairness")
    diff_lines += ["@@ -115,5 +115,7 @@ void Scheduler::scheduleRetry(Job& job)", "-    timer.after(milliseconds(1000));", "+    timer.after(milliseconds(1500));", "+    metrics.record(\"retry scheduled\");", "", "diff --git a/src/thumb/cache.cpp b/src/thumb/cache.cpp", "index 88ab..99bc 100644", "--- a/src/thumb/cache.cpp", "+++ b/src/thumb/cache.cpp"]
    for i in range(116, 140):
        diff_lines.append(f" context thumbnail maintenance line {i}: preserve cache accounting")
    diff_lines += ["@@ -140,4 +140,6 @@ void ThumbnailCache::put(Item item)", "+    trimExpired();", "+    notifyMemorySampler();"]
    extra_files = [
        "src/ui/menu.cpp",
        "src/storage/index.cpp",
        "src/net/probe.cpp",
        "src/auth/session.cpp",
        "src/settings/profile.cpp",
        "src/telemetry/events.cpp",
        "src/platform/clipboard.cpp",
    ]
    for number, filename in enumerate(extra_files, start=1):
        diff_lines += [
            f"diff --git a/{filename} b/{filename}",
            f"index {number:02x}aa..{number:02x}bb 100644",
            f"--- a/{filename}",
            f"+++ b/{filename}",
            f"@@ -{number * 10},2 +{number * 10},{number * 10 + 1} @@ routine maintenance",
            "+    metrics.record(\"component refreshed\");",
        ]
    write(FIXTURE / "release" / "4.2.0-diff.txt", "\n".join(diff_lines) + "\n")


def make_docs_and_ops() -> None:
    write(FIXTURE / "README.md", """# Desktop sync release packet

This folder is the working packet for the 4.2.0 desktop crash review. It contains collector exports, operational logs, release material, and a few old working notes.

Start with the release history, then inspect the collector fields before comparing versions. Report paths are relative to this folder. Timestamps in generated records use UTC.

The packet includes routine telemetry and examples from more than one release. Treat the app version as part of the comparison and preserve original evidence when writing the review.

Useful locations:

- `crashes/` contains one JSON envelope per submitted report.
- `release/` contains the version history, notes, and source diff.
- `docs/` explains field meanings and the response policy.
- `ops/` contains logs, metrics, deploy records, and small maintenance tools.

The release owner wants a concise, evidence-backed decision rather than a histogram copied into a document.
""")
    write(FIXTURE / "docs" / "crash-collector.md", """# Crash collector fields

Each JSON envelope has an `id`, UTC `timestamp`, `appVersion`, `os`, `osVersion`, `userHash`, `topFrames`, and `lastLogs`. The user hash is stable for counting distinct users within this export. A report count counts envelopes, not frames.

The collector retains the first eight symbolized frames and the last five log lines. Platform symbols can use different names for equivalent functions. The Windows build may inline small functions, so one crash can show two closely related top frames. Group by the underlying behavior when the evidence supports it.

Do not treat a repeated log phrase as a crash signature without checking the frames and release comparison.
""")
    write(FIXTURE / "docs" / "hotfix-policy.md", """# Hotfix policy

A defect qualifies for a hotfix when it affects more than 1% of weekly active users or causes any data loss. A defect that meets neither condition goes into the next release.

The release owner must cite the affected versions, distinct users, platform impact, and an executable mitigation when one exists. A crash count alone is not a user count. Evidence must point to a real file and line.
""")
    write(FIXTURE / "docs" / "triage-runbook.md", """# Crash review runbook

Compare release versions before calling a group a regression. Count report envelopes and distinct user hashes separately. Keep platform counts in the same group so a platform-specific pattern does not become a second defect merely because symbols differ.

Use the source diff to identify a plausible suspect only after matching the behavior in frames or logs. Keep unrelated release changes as alternatives until the evidence rules them out.

The final review belongs in `triage/4.2.0-crash-triage.md` and must retain file-and-line citations.
""")
    write(FIXTURE / "ops" / "deploy-history.yaml", """deployments:
  - id: dep-410
    version: 4.1.3
    started: 2026-02-23T13:10:00Z
    status: complete
  - id: dep-420
    version: 4.2.0
    started: 2026-03-16T10:20:00Z
    status: complete
  - id: dep-tools-19
    version: collector-tools-1.9
    started: 2026-03-15T16:40:00Z
    status: complete
""")
    write(FIXTURE / "ops" / "config.json", json.dumps({"collector": {"batchSize": 50, "retentionDays": 30}, "symbolizer": {"timeoutMs": 1200}, "alerts": {"latencyMs": 800}}, indent=2) + "\n")
    write(FIXTURE / "ops" / "alerts.yml", """alerts:
  - name: crash-ingest-delay
    threshold_seconds: 90
    severity: warning
  - name: symbolizer-errors
    threshold_percent: 3
    severity: warning
  - name: collector-disk
    threshold_percent: 80
    severity: page
""")
    write(FIXTURE / "ops" / "scripts" / "check_space.sh", """#!/bin/sh
set -eu
df -P . | tail -n 1
""")
    write(FIXTURE / "ops" / "scripts" / "rotate_notes.py", """from pathlib import Path

for note in Path("ops/notes").glob("*.md"):
    print(note.name)
""")
    write(FIXTURE / "ops" / "notes" / "old-review.md", """# Old review note

The previous release review closed after routine symbolizer latency returned to normal. This note is retained for context and is not a current incident conclusion.
""")
    write(FIXTURE / "ops" / "notes" / "todo.txt", """- reconcile collector batches after the Friday export
- remove obsolete dashboard bookmark
- ask support whether any customers saw repeated prompts
""")


def main() -> None:
    if FIXTURE.exists():
        shutil.rmtree(FIXTURE)
    FIXTURE.mkdir()
    make_reports()
    make_logs()
    make_metrics()
    make_release_files()
    make_docs_and_ops()
    count = sum(1 for p in FIXTURE.rglob("*") if p.is_file())
    print(f"wrote {count} fixture files")


if __name__ == "__main__":
    main()
