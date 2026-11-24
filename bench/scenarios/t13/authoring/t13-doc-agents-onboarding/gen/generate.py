#!/usr/bin/env python3
"""Create deterministic service evidence for the onboarding fixture."""
from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixture"
RNG = random.Random(41729)
START = datetime(2026, 3, 17, 0, 0, tzinfo=timezone.utc)

SERVICES = [
    ("gateway", "api-01"),
    ("gateway", "api-02"),
    ("identity", "auth-01"),
    ("worker", "jobs-01"),
]
LEVELS = ["INFO"] * 13 + ["WARN"] * 2 + ["DEBUG"]
ROUTES = ["/health", "/v1/profile", "/v1/session", "/v1/preferences", "/metrics"]


def stamp(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def request_id() -> str:
    return f"req_{RNG.randrange(0x100000, 0xFFFFFF):06x}"


def write_logs() -> None:
    logs = {
        "api-2026-03-17.log": ("gateway", "api-01", 1260),
        "auth-2026-03-17.log": ("identity", "auth-01", 1120),
        "worker-2026-03-17.log": ("worker", "jobs-01", 1180),
    }
    for name, (service, host, count) in logs.items():
        lines: list[str] = []
        for i in range(count):
            dt = START + timedelta(seconds=(i * 86400 // count) + RNG.randrange(0, 18))
            level = RNG.choice(LEVELS)
            rid = request_id()
            if service == "gateway":
                route = RNG.choice(ROUTES)
                if level == "WARN":
                    msg = f"slow request route={route} duration_ms={RNG.randrange(410, 980)}"
                elif level == "DEBUG":
                    msg = f"health check route=/health status=200 duration_ms={RNG.randrange(2, 18)}"
                else:
                    msg = f"request route={route} status=200 duration_ms={RNG.randrange(18, 245)}"
                lines.append(f"{stamp(dt)} {level} service={service} host={host} request_id={rid} {msg}")
            elif service == "identity":
                if level == "WARN":
                    msg = f"token retry attempt={RNG.randrange(1, 3)} backoff_ms={RNG.randrange(80, 420)}"
                else:
                    msg = f"token check result=allow duration_ms={RNG.randrange(4, 130)}"
                lines.append(f"{stamp(dt)} {level} service={service} host={host} request_id={rid} {msg}")
            else:
                if level == "WARN":
                    msg = f"job retry queue=profile attempt={RNG.randrange(1, 4)} delay_ms={RNG.randrange(90, 600)}"
                else:
                    msg = f"job completed queue=profile duration_ms={RNG.randrange(20, 440)}"
                lines.append(f"{stamp(dt)} {level} service={service} host={host} request_id={rid} {msg}")

        if name == "api-2026-03-17.log":
            # Keep incident evidence well past the first sixty lines.
            inserts = {
                929: "2026-03-17T17:42:11Z INFO service=gateway host=api-01 request_id=req_deploy01 deploy marker=release-2026.03.17.2 status=started",
                935: "2026-03-17T17:49:37Z INFO service=gateway host=api-01 request_id=req_cfg001 config reload db_pool_max=10 source=environment",
                940: "2026-03-17T17:54:02Z WARN service=gateway host=api-01 request_id=req_pool01 database pool wait_ms=112 available=0 max=10",
                947: "2026-03-17T18:02:44Z WARN service=gateway host=api-01 request_id=req_slow01 request route=/v1/profile status=504 duration_ms=3188 error=pool_acquire_timeout",
                949: "2026-03-17T18:04:08Z ERROR service=gateway host=api-01 request_id=req_err01 request route=/v1/profile status=503 duration_ms=4012 error=database connection timeout",
                950: "2026-03-17T18:05:21Z ERROR service=gateway host=api-02 request_id=req_err02 request route=/v1/session status=503 duration_ms=3970 error=database connection timeout",
                956: "2026-03-17T18:12:33Z INFO service=gateway host=api-01 request_id=req_fix01 config reload db_pool_max=40 source=environment",
                959: "2026-03-17T18:15:05Z INFO service=gateway host=api-01 request_id=req_recover01 recovery status=healthy pool_available=37 max=40",
                960: "2026-03-17T18:17:44Z INFO service=gateway host=api-02 request_id=req_recover02 request route=/v1/profile status=200 duration_ms=188",
            }
            for index, line in inserts.items():
                lines[index] = line
        if name == "auth-2026-03-17.log":
            lines[934] = "2026-03-17T18:03:52Z INFO service=identity host=auth-01 request_id=req_auth01 token check result=allow duration_ms=42 dependency=database"
            lines[936] = "2026-03-17T18:06:16Z WARN service=identity host=auth-01 request_id=req_auth02 token retry attempt=2 backoff_ms=220 dependency=database"
        if name == "worker-2026-03-17.log":
            lines[872] = "2026-03-17T18:04:20Z INFO service=worker host=jobs-01 request_id=req_job01 job completed queue=profile duration_ms=304"
            lines[878] = "2026-03-17T18:10:02Z WARN service=worker host=jobs-01 request_id=req_job02 job retry queue=profile attempt=2 delay_ms=320"
        (ROOT / "logs" / name).write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_metrics() -> None:
    catalogue = [
        ("http_5xx_rate", "ratio", "gateway request failures"),
        ("db_pool_wait_ms", "milliseconds", "database pool wait"),
        ("db_pool_available", "connections", "idle database connections"),
        ("request_latency_p95_ms", "milliseconds", "95th percentile request latency"),
        ("healthcheck_failures", "count", "failed health checks"),
    ]
    with (ROOT / "metrics" / "catalogue.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["metric", "unit", "description"])
        writer.writerows(catalogue)
    with (ROOT / "metrics" / "api-hourly.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["hour_utc", "http_5xx_rate", "db_pool_wait_ms", "db_pool_available", "request_latency_p95_ms", "healthcheck_failures"])
        rows = []
        for hour in range(90):
            moment = START - timedelta(days=3) + timedelta(hours=hour)
            rows.append((stamp(moment), round(0.0005 + (hour % 7) * 0.0002, 4), 6 + (hour % 9), 28 + (hour % 8), 210 + (hour % 11) * 9, hour % 2))
        rows.append(("2026-03-17T18:00:00Z", 0.084, 121, 0, 3210, 14))
        rows.append(("2026-03-17T19:00:00Z", 0.002, 11, 36, 260, 0))
        writer.writerows(rows)
    with (ROOT / "metrics" / "latency-summary.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["service", "window_utc", "p50_ms", "p95_ms", "p99_ms"])
        for index in range(78):
            day = START + timedelta(hours=index * 7)
            writer.writerow(("gateway" if index % 3 else "identity", f"{stamp(day)}/{stamp(day + timedelta(hours=1))}", 50 + index % 20, 180 + index % 70, 330 + index % 100))
        writer.writerow(("gateway", "2026-03-17T18:00:00Z/2026-03-17T18:59:59Z", 81, 3210, 4110))
        writer.writerow(("identity", "2026-03-17T18:00:00Z/2026-03-17T18:59:59Z", 55, 610, 920))


def write_history() -> None:
    (ROOT / "ops" / "deploy-history.csv").write_text(
        "deploy_utc,release,service,actor,result\n"
        "2026-03-14T10:22:00Z,release-2026.03.14.1,gateway,lee,success\n"
        "2026-03-17T17:42:00Z,release-2026.03.17.2,gateway,mina,success\n"
        "2026-03-17T18:12:00Z,rollback-2026.03.17.2,gateway,lee,success\n"
        "2026-03-18T09:05:00Z,release-2026.03.18.1,gateway,mina,success\n",
        encoding="utf-8",
    )
    (ROOT / "ops" / "config-diff.log").write_text(
        "2026-03-16T16:00:00Z config review service=gateway result=approved\n"
        "2026-03-17T17:48:59Z environment snapshot service=gateway host=api-01 source=release bundle\n"
        "2026-03-17T17:49:37Z environment delta service=gateway key=runtime setting actor=release-runner\n"
        "2026-03-17T18:12:33Z environment delta service=gateway key=runtime setting actor=oncall\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    for directory in ["logs", "metrics", "ops"]:
        (ROOT / directory).mkdir(parents=True, exist_ok=True)
    write_logs()
    write_metrics()
    write_history()
