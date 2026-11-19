#!/usr/bin/env python3
"""Create the deliberately noisy login-service operations fixture."""
from __future__ import annotations

import csv
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixture"
DAY = datetime(2025, 2, 14, tzinfo=timezone.utc)
RNG = random.Random(18427)


def iso(minute: int, second: int = 0) -> str:
    return (DAY + timedelta(minutes=minute, seconds=second)).strftime("%Y-%m-%dT%H:%M:%SZ")


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def make_configs() -> None:
    write("README.md", """# Atlas login operations\n\nThis folder contains the daily operating record for Atlas Login, a two-region sign-in service.\nThe global edge sends requests to the nearest healthy login pool. Times in the exported records are UTC.\n\nThe records cover 2025-02-14 and include ordinary traffic, release activity, monitoring data, and the\ncorresponding incident conversation. Some exports are retained for context and are not current runbooks.\n""")
    write("config/regions.yaml", """service: atlas-login\nregions:\n  eu-west-1:\n    edge_pool: edge-eu\n    gateway_pool: gateway-eu\n    auth_pool: auth-eu\n    traffic_share: 0.47\n  us-east-1:\n    edge_pool: edge-us\n    gateway_pool: gateway-us\n    auth_pool: auth-us\n    traffic_share: 0.53\nglobal_health_probe: /internal/ready\nprobe_interval_seconds: 15\n""")
    write("config/global-lb.yaml", """name: atlas-login-global\nstrategy: latency_with_health_override\nnormal_backends:\n  - edge-eu\n  - edge-us\nhealth_override_after_failures: 3\nrecovery_hold_seconds: 120\n""")
    write("config/auth-service.yaml", """service: atlas-auth\nrelease_channel: stable\nlistener: 8443\nclient_authentication: required\ntrust_bundle: atlas-internal-ca.pem\nrequest_timeout_ms: 1800\n""")
    write("config/metrics-catalogue.txt", """login_attempts\nsuccess_rate_pct\ntls_handshake_errors\np95_latency_ms\nedge_5xx_responses\nupstream_retry_count\n""")
    write("alerts/login-alerts.yaml", """alerts:\n  - name: login-success-rate-low\n    metric: success_rate_pct\n    region: each\n    threshold: 95\n    for_minutes: 5\n    severity: page\n  - name: tls-handshake-errors\n    metric: tls_handshake_errors\n    threshold: 20\n    for_minutes: 3\n    severity: ticket\n  - name: edge-latency-high\n    metric: p95_latency_ms\n    threshold: 900\n    for_minutes: 10\n    severity: warn\n""")
    write("runbooks/login.md", """# Login service response\n\nCheck the regional success-rate and TLS panels before changing global routing. Compare edge, gateway, and\nauth-service request IDs. Keep a timestamped note for every routing change.\n\nA rollback is appropriate when a release explains the first failing requests and the failure is present in\nboth the request and health-check paths. Otherwise preserve the logs and inspect the shared dependencies.\n""")
    write("runbooks/certificates.md", """# Internal certificate rotation\n\nThe gateway presents a region-specific client certificate to the auth service. Rotation is expected at least\n14 days before the not-after time. The certificate inventory is the source for serial numbers and expiration\ntimes; the service logs show whether a presented certificate was accepted.\n\nAfter a replacement, confirm a successful handshake in each region before restoring normal routing.\n""")
    write("docs/architecture.md", """# Atlas Login request path\n\nBrowser -> global load balancer -> regional edge -> internal gateway -> regional auth service.\n\nThe two regional auth pools are independent. The gateway-to-auth hop uses mutual TLS, while the edge-to-gateway\nhop uses ordinary service authentication. A regional edge can temporarily send login traffic to the healthy\nregional pool during an incident.\n""")
    write("docs/oncall-notes.md", """# On-call handoff notes\n\nThe morning handoff called out a busy password-reset campaign and normal queue growth. No customer-impacting\nissue was open at handoff. The previous certificate rotation report had no customer-facing summary attached.\n""")
    write("notes/old-incident.md", """# Archived note: avatar image delays\n\nA November image resize job caused slow profile pictures for 17 minutes. It did not involve the login path.\nThis note is retained because the same incident channel was used for the follow-up.\n""")
    write("notes/release-notes.md", """# Release notes retained with the export\n\nThe 2025-02-14 auth-service release contains dependency housekeeping and a token-cache metric. No schema\nchanges were included. The release was deployed to the two production regions in the morning window.\n""")
    write("scripts/check-login.sh", """#!/bin/sh\nset -eu\nregion=${1:-eu-west-1}\ncurl --fail --silent --show-error "https://login.${region}.atlas.example/health" >/dev/null\nprintf '%s healthy\\n' "$region"\n""")
    write("scripts/rotate-cert.py", """#!/usr/bin/env python3\n# Local operator helper; it prints the command and does not call a control plane.\nimport sys\nregion = sys.argv[1] if len(sys.argv) > 1 else 'eu-west-1'\nprint(f'prepare rotation for {region}')\n""")
    write("scripts/old-traffic-report.py", """#!/usr/bin/env python3\nfrom pathlib import Path\nprint('This retained script reads a legacy weekly export.')\nprint(Path('metrics/weekly-2024-11.csv'))\n""")


def make_cert_inventory() -> None:
    rows = [
        ["certificate_id", "region", "subject", "serial", "not_before", "not_after", "issuer", "status"],
        ["gw-auth-eu-2024-11", "eu-west-1", "gateway.atlas.internal", "A7E4-91C2", "2024-11-16T11:00:00Z", "2025-02-14T11:00:00Z", "Atlas Internal CA", "active"],
        ["gw-auth-us-2025-01", "us-east-1", "gateway.atlas.internal", "B8F2-44D1", "2025-01-21T09:00:00Z", "2025-04-21T09:00:00Z", "Atlas Internal CA", "active"],
        ["edge-eu-2025-02", "eu-west-1", "edge.atlas.internal", "C4A0-77B9", "2025-02-01T08:00:00Z", "2025-05-02T08:00:00Z", "Atlas Internal CA", "active"],
        ["edge-us-2025-02", "us-east-1", "edge.atlas.internal", "C4A0-77BA", "2025-02-01T08:00:00Z", "2025-05-02T08:00:00Z", "Atlas Internal CA", "active"],
        ["gw-auth-eu-next", "eu-west-1", "gateway.atlas.internal", "D1B3-8820", "2025-02-14T12:05:00Z", "2025-05-15T12:05:00Z", "Atlas Internal CA", "staged"],
    ]
    write("certs/certificate-inventory.csv", "\n".join(",".join(row) for row in rows) + "\n")


def make_deploy_history() -> None:
    rows = [["deploy_id", "service", "region", "version", "started_at", "completed_at", "result", "operator"]]
    rows.extend([
        ["rel-8421", "atlas-auth", "eu-west-1", "2025.02.14-rc3", iso(649), iso(652), "success", "release-bot"],
        ["rel-8421", "atlas-auth", "us-east-1", "2025.02.14-rc3", iso(649), iso(652), "success", "release-bot"],
        ["rel-8422", "edge", "eu-west-1", "2025.02.14-rc2", iso(625), iso(627), "success", "release-bot"],
        ["rel-8422", "edge", "us-east-1", "2025.02.14-rc2", iso(625), iso(627), "success", "release-bot"],
        ["rel-8423", "atlas-auth", "eu-west-1", "2025.02.14-rc3-rollback", iso(678), iso(686), "success", "oncall-17"],
        ["rel-8423", "atlas-auth", "us-east-1", "2025.02.14-rc3-rollback", iso(678), iso(686), "success", "oncall-17"],
        ["rel-8424", "atlas-auth", "eu-west-1", "2025.02.14-hotfix1", iso(725), iso(731), "success", "oncall-17"],
    ])
    write("deploy/deploy-history.csv", "\n".join(",".join(row) for row in rows) + "\n")


def make_metrics(region: str) -> None:
    path = f"metrics/{region}-login.csv"
    rows = [["timestamp", "region", "login_attempts", "successful_logins", "success_rate_pct", "tls_handshake_errors", "p95_latency_ms", "edge_5xx_responses", "upstream_retry_count"]]
    for minute in range(1440):
        if region == "eu-west-1":
            attempts = 410 + (minute * 17) % 95
            if 660 <= minute < 700:
                successful = 14 + (minute % 5) * 2
                tls = 360 + (minute % 9) * 11
                latency = 1740 + (minute % 6) * 55
                edge5xx = attempts - successful
                retries = 90 + minute % 17
            elif 700 <= minute < 712:
                successful = attempts - 4 - (minute % 3)
                tls = 8 + minute % 4
                latency = 520 + (minute % 5) * 30
                edge5xx = attempts - successful
                retries = 12 + minute % 5
            else:
                successful = attempts - (2 + minute % 4)
                tls = minute % 4
                latency = 245 + (minute % 8) * 19
                edge5xx = 2 + minute % 3
                retries = 3 + minute % 4
        else:
            attempts = 450 + (minute * 13) % 90
            successful = attempts - (2 + (minute + 1) % 4)
            tls = (minute + 2) % 3
            latency = 230 + (minute % 7) * 21
            edge5xx = 2 + minute % 2
            retries = 2 + minute % 5
        rate = round(successful * 100 / attempts, 3)
        rows.append([iso(minute), region, attempts, successful, rate, tls, latency, edge5xx, retries])
    write(path, "\n".join(",".join(map(str, row)) for row in rows) + "\n")


def log_line(ts: str, level: str, service: str, message: str) -> str:
    return f"{ts} {level} service={service} {message}"


def make_log(region: str, service: str) -> None:
    lines: list[str] = []
    for minute in range(1440):
        # Every file has normal operational traffic throughout the day.
        jitter = RNG.randrange(0, 4)
        req = f"r-{region[:2]}-{minute:04d}"
        if service == "edge":
            lines.append(log_line(iso(minute), "INFO", f"edge-{region[:2]}", f"request_id={req} route=/login method=POST status=200 upstream=auth-{region[:2]} latency_ms={42 + minute % 31 + jitter}"))
            lines.append(log_line(iso(minute, 12), "INFO", f"edge-{region[:2]}", f"health path=/internal/ready status=200 backend=auth-{region[:2]} probe_ms={8 + minute % 9 + jitter}"))
            if minute % 97 == 0:
                lines.append(log_line(iso(minute, 28), "WARN", f"edge-{region[:2]}", f"request_id={req}-slow route=/login status=200 latency_ms={860 + minute % 180} retryable=false"))
            if region == "eu-west-1" and minute == 660:
                lines.append(log_line(iso(minute, 1), "ERROR", "edge-eu", "request_id=eu-outage-0001 route=/login upstream=gateway-eu status=502 error=upstream_tls_handshake_failed"))
            if region == "eu-west-1" and 660 <= minute < 700:
                for n in range(2):
                    lines.append(log_line(iso(minute, 20 + n), "ERROR", "edge-eu", f"request_id=eu-fail-{minute:04d}-{n} route=/login upstream=gateway-eu status=502 error=upstream_tls_handshake_failed"))
        elif service == "gateway":
            lines.append(log_line(iso(minute), "INFO", f"gateway-{region[:2]}", f"request_id={req} upstream=auth-{region[:2]} mtls=accepted status=200 duration_ms={31 + minute % 24 + jitter}"))
            if minute % 131 == 0:
                lines.append(log_line(iso(minute, 31), "WARN", f"gateway-{region[:2]}", f"request_id={req}-retry upstream=auth-{region[:2]} retry=1 reason=upstream_timeout"))
            if region == "eu-west-1" and minute == 660:
                lines.append(log_line(iso(minute, 2), "ERROR", "gateway-eu", "request_id=eu-outage-0001 upstream=auth-eu mtls=failed error=x509: certificate has expired serial=A7E4-91C2"))
            if region == "eu-west-1" and 660 <= minute < 700:
                lines.append(log_line(iso(minute, 15), "ERROR", "gateway-eu", f"request_id=eu-mtls-{minute:04d} upstream=auth-eu mtls=failed error=x509: certificate has expired"))
            if region == "eu-west-1" and minute == 700:
                lines.append(log_line(iso(minute, 3), "INFO", "gateway-eu", "request_id=eu-route-0700 upstream=auth-us mtls=accepted route_override=incident-eu-to-us status=200"))
        else:
            lines.append(log_line(iso(minute), "INFO", f"auth-{region[:2]}", f"request_id={req} operation=login result=success token_cache=hit duration_ms={25 + minute % 40 + jitter}"))
            if minute % 173 == 0:
                lines.append(log_line(iso(minute, 44), "WARN", f"auth-{region[:2]}", f"request_id={req}-cache operation=login token_cache=miss retry=0 duration_ms=210"))
            if region == "eu-west-1" and minute == 660:
                lines.append(log_line(iso(minute, 4), "ERROR", "auth-eu", "request_id=eu-outage-0001 operation=login result=rejected reason=client_certificate_expired peer=gateway-eu"))
            if region == "eu-west-1" and 660 <= minute < 700:
                lines.append(log_line(iso(minute, 18), "WARN", "auth-eu", f"request_id=eu-auth-{minute:04d} operation=login result=rejected reason=client_certificate_expired"))
            if region == "eu-west-1" and minute == 700:
                lines.append(log_line(iso(minute, 4), "INFO", "auth-eu", "request_id=eu-route-0700 operation=login result=not_reached route=incident-eu-to-us"))
        # An occasional independent retry makes the logs less synthetic.
        if minute % 211 == 19:
            lines.append(log_line(iso(minute, 51), "INFO", f"{service}-{region[:2]}", f"request_id={req}-background job=session-cleanup retry=1 result=complete"))
    write(f"logs/{service}-{region[:2]}.log", "\n".join(lines) + "\n")


def make_incident_channel() -> None:
    write("incident/channel-export.md", """# #login-ops export\n\n**2025-02-14T10:30:00Z — mila (on-call)**\nMorning handoff is quiet. Watching the password-reset campaign queue.\n\n**2025-02-14T10:49:00Z — release-bot**\nDeployment `rel-8421` started for atlas-auth in eu-west-1 and us-east-1.\n\n**2025-02-14T10:55:00Z — release-bot**\nDeployment `rel-8421` completed successfully in both regions.\n\n**2025-02-14T11:04:00Z — pager**\nAlert: eu-west-1 login success rate below 95% for five minutes.\n\n**2025-02-14T11:07:00Z — mila (on-call)**\nEU login errors are climbing. US dashboard is normal. Comparing request IDs and the regional paths now.\n\n**2025-02-14T11:18:00Z — mila (on-call)**\nThe auth release rollback has started in both regions.\n\n**2025-02-14T11:26:00Z — mila (on-call)**\nThe auth release rollback completed in both regions. EU failures continue, so the rollback did not change the symptom.\n\n**2025-02-14T11:31:00Z — devon**\nThe gateway panel shows repeated failed handshakes to auth-eu. I am checking the regional service records.\n\n**2025-02-14T11:36:00Z — mila (on-call)**\nThe EU pool is isolated while we verify the next routing step.\n\n**2025-02-14T11:40:00Z — mila (on-call)**\nMitigation applied: route eu-west-1 login traffic through the healthy us-east-1 auth pool.\n\n**2025-02-14T11:42:00Z — pager**\nEU success-rate alert recovered after the routing change. Keeping the override while replacing the regional credential.\n\n**2025-02-14T12:05:00Z — devon**\nA replacement credential is staged for the EU gateway.\n\n**2025-02-14T12:11:00Z — mila (on-call)**\nThe EU gateway handshake check is green. Normal routing can be restored after the hold period.\n\n**2025-02-14T13:00:00Z — mila (on-call)**\nCustomer traffic is normal in both regions.\n""")


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    make_configs()
    make_cert_inventory()
    make_deploy_history()
    make_metrics("eu-west-1")
    make_metrics("us-east-1")
    for region in ("eu-west-1", "us-east-1"):
        for service in ("edge", "gateway", "auth"):
            make_log(region, service)
    make_incident_channel()
    manifest = {
        "generated_day": DAY.strftime("%Y-%m-%d"),
        "random_seed": 18427,
        "files": sorted(str(p.relative_to(ROOT)) for p in ROOT.rglob("*") if p.is_file()),
    }
    pass  # no manifest in the fixture


if __name__ == "__main__":
    main()
