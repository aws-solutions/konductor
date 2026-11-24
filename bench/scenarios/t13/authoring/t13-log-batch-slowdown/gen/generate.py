from __future__ import annotations

import csv
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "fixture"
RNG = random.Random(41729)
UTC = timezone.utc


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip("\n") + "\n", encoding="utf-8")


def stage_plan(index: int) -> dict[str, int]:
    enrich = [70, 70, 81, 92, 103, 114, 125, 136, 147, 158, 169, 180, 191, 202][index]
    extract = [45, 45, 46, 46, 47, 47, 48, 48, 49, 49, 50, 50, 51, 51][index]
    dedupe = [30, 31, 31, 32, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37][index]
    aggregate = 28
    publish = [12, 12, 12, 12, 11, 10, 10, 9, 8, 8, 7, 7, 6, 6][index]
    return {"extract": extract, "dedupe": dedupe, "enrich": enrich, "aggregate": aggregate, "publish": publish}


def rows_for(index: int) -> int:
    return round(1_000_000 * (1.03 ** index))


def log_file(index: int) -> None:
    day = datetime(2026, 4, 1 + index, 0, 0, tzinfo=UTC)
    night = day.strftime("%Y-%m-%d")
    start = day.replace(hour=1)
    plan = stage_plan(index)
    rows = rows_for(index)
    stage_names = ["extract", "dedupe", "enrich-v2" if index >= 5 else "enrich", "aggregate", "publish"]
    lines: list[str] = []

    # The ambient stream makes the batch records one part of a normal operations log.
    for n in range(178):
        minute = (n * 7 + index * 11) % (22 * 60)
        if minute == 390:
            minute = 391
        ts = day + timedelta(minutes=minute)
        service = ["lookup-api", "report-api", "warehouse", "notifier"][n % 4]
        req = f"req-{index + 1:02d}-{n + 1:04d}-{RNG.randrange(1000, 9999)}"
        if n % 29 == 0:
            lines.append(f"{iso(ts)} level=WARN service={service} request_id={req} msg=retrying upstream check attempt=2")
        elif n % 37 == 0:
            lines.append(f"{iso(ts)} level=INFO service={service} request_id={req} msg=health check status=ok latency_ms={RNG.randrange(8, 42)}")
        elif n % 41 == 0:
            lines.append(f"{iso(ts)} level=WARN service={service} request_id={req} msg=slow request latency_ms={RNG.randrange(420, 870)}")
        else:
            lines.append(f"{iso(ts)} level=INFO service={service} request_id={req} msg=request complete status=200 latency_ms={RNG.randrange(12, 180)}")

    lines.append(f"{iso(start)} level=INFO service=nightly-report job=nightly-report night={night} event=start rows={rows}")
    cursor = start
    for stage_index, (base_name, duration) in enumerate(stage_plan(index).items()):
        name = "enrich-v2" if base_name == "enrich" and index >= 5 else base_name
        end = cursor + timedelta(minutes=duration)
        lines.append(
            f"{iso(cursor)} level=INFO service=nightly-report job=nightly-report night={night} "
            f"stage={name} start={iso(cursor)} end={iso(end)} rows={rows}"
        )
        if name.startswith("enrich"):
            workers = 2 if index >= 2 else 8
            lookup = "lookup-api"
            lines.append(f"{iso(cursor + timedelta(minutes=1))} level=INFO service=nightly-report job=nightly-report night={night} stage={name} workers={workers} pool=lookup-workers target={lookup}")
            lines.append(f"{iso(cursor + timedelta(minutes=duration // 2))} level=INFO service=nightly-report job=nightly-report night={night} stage={name} workers={workers} batch=midpoint rows={rows // 2}")
            if index in (2, 5, 8, 11):
                lines.append(f"{iso(cursor + timedelta(minutes=duration - 2))} level=WARN service=nightly-report night={night} stage={name} lookup_latency_ms={RNG.randrange(90, 140)} queue_depth={RNG.randrange(12, 30)}")
        elif stage_index == 0:
            lines.append(f"{iso(cursor + timedelta(minutes=2))} level=INFO service=nightly-report job=nightly-report night={night} stage={name} workers=4 source=warehouse partitions=16")
        else:
            lines.append(f"{iso(cursor + timedelta(minutes=1))} level=INFO service=nightly-report job=nightly-report night={night} stage={name} workers=4 rows={rows}")
        cursor = end

    if index == 8:
        lines.append(f"{iso(cursor)} level=ERROR service=nightly-report job=nightly-report night={night} stage=publish publish_status=failed attempt=1 reason=remote_503")
        lines.append(f"{iso(cursor + timedelta(minutes=4))} level=WARN service=nightly-report job=nightly-report night={night} stage=publish retry=1 backoff_seconds=240")
        lines.append(f"{iso(cursor + timedelta(minutes=49))} level=ERROR service=nightly-report job=nightly-report night={night} stage=publish publish_status=failed attempt=2 reason=remote_503")
        lines.append(f"{iso(cursor + timedelta(minutes=54))} level=WARN service=nightly-report job=nightly-report night={night} stage=publish retry=2 backoff_seconds=300")
        cursor += timedelta(minutes=134)
    lines.append(f"{iso(cursor)} level=INFO service=nightly-report job=nightly-report night={night} event=finish total={rows} status=success")

    # Pad the tail with ordinary daytime operations so every file has a comparable shape.
    while len(lines) < 320:
        n = len(lines)
        ts = day + timedelta(hours=8, minutes=(n * 3) % (12 * 60))
        req = f"req-{index + 1:02d}-tail-{n:04d}"
        lines.append(f"{iso(ts)} level=INFO service=report-api request_id={req} msg=cache refresh status=200 latency_ms={RNG.randrange(10, 95)}")
    write(FIXTURE / "logs" / f"night-{night}.log", "\n".join(lines[:320]))


def make_fixture() -> None:
    (FIXTURE / "logs").mkdir(parents=True, exist_ok=True)
    for old in (FIXTURE / "logs").glob("night-*.log"):
        old.unlink()
    for i in range(14):
        log_file(i)

    volumes = ["night,rows,source\n"]
    for i in range(14):
        night = (datetime(2026, 4, 1, tzinfo=UTC) + timedelta(days=i)).strftime("%Y-%m-%d")
        volumes.append(f"{night},{rows_for(i)},warehouse-prod\n")
    write(FIXTURE / "data" / "volumes.csv", "".join(volumes))

    metrics = ["night,metric,value,unit\n"]
    for i in range(14):
        night = (datetime(2026, 4, 1, tzinfo=UTC) + timedelta(days=i)).strftime("%Y-%m-%d")
        metrics.extend([
            f"{night},api_request_count,{18000 + i * 420},requests\n",
            f"{night},api_p95_ms,{210 + i * 3},milliseconds\n",
            f"{night},warehouse_cpu_pct,{42 + i % 4},percent\n",
            f"{night},publish_success_ratio,{0.998 - i * 0.0001:.4f},ratio\n",
            f"{night},input_rows,{rows_for(i)},rows\n",
        ])
    for i in range(14):
        night = (datetime(2026, 4, 1, tzinfo=UTC) + timedelta(days=i)).strftime("%Y-%m-%d")
        plan = stage_plan(i)
        metrics.extend([
            f"{night},extract_duration,{plan['extract']},minutes\n",
            f"{night},dedupe_duration,{plan['dedupe']},minutes\n",
            f"{night},enrich_duration,{plan['enrich']},minutes\n",
            f"{night},aggregate_duration,{plan['aggregate']},minutes\n",
            f"{night},publish_duration,{plan['publish']},minutes\n",
            f"{night},lookup_error_rate,{0.001 + i * 0.0001:.4f},ratio\n",
        ])
    write(FIXTURE / "metrics" / "nightly.csv", "".join(metrics))

    deploy = ["timestamp,service,version,change,operator\n"]
    services = ["report-api", "warehouse", "notifier", "publish-gateway"]
    changes = [
        ("2026-03-28T16:20:00Z", "report-api", "2026.03.28.1", "routine patch", "mira"),
        ("2026-04-02T17:05:00Z", "warehouse", "2026.04.02.2", "partition maintenance", "jonah"),
        ("2026-04-07T18:10:00Z", "report-api", "2026.04.07.4", "query compatibility patch", "salma"),
        ("2026-04-11T16:45:00Z", "notifier", "2026.04.11.1", "certificate refresh", "devon"),
    ]
    for i in range(96):
        stamp = datetime(2026, 1, 1, 15, 0, tzinfo=UTC) + timedelta(days=i)
        service = services[i % len(services)]
        version = f"2026.{stamp.month:02d}.{stamp.day:02d}.{(i % 4) + 1}"
        operator = ["mira", "jonah", "salma", "devon"][i % 4]
        change = ["routine patch", "dependency refresh", "certificate check", "maintenance window"][i % 4]
        deploy.append(f"{iso(stamp)},{service},{version},{change},{operator}\n")
    deploy.extend(",".join(row) + "\n" for row in changes)
    write(FIXTURE / "deploy" / "history.csv", "".join(deploy))


if __name__ == "__main__":
    make_fixture()
