#!/usr/bin/env python3
"""Create the synthetic gateway operations fixture."""
from __future__ import annotations

import csv
import json
import random
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixture"
RNG = random.Random(271828)
BASE = datetime(2026, 5, 2, tzinfo=timezone.utc)


def utc_text(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log_text(value: datetime, node: str) -> str:
    if node == "gw-b":
        # This node writes its wall clock without a zone suffix.
        return (value - timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%S")
    return utc_text(value)


def record(ts: datetime, node: str, event: str, account: str, src: str, ua: str, reason: str) -> dict[str, str]:
    return {
        "ts": log_text(ts, node),
        "node": node,
        "event": event,
        "account": account,
        "src_ip": src,
        "ua": ua,
        "reason": reason,
        "_actual": utc_text(ts),
    }


def write_jsonl(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            clean = {key: value for key, value in row.items() if key != "_actual"}
            handle.write(json.dumps(clean, separators=(",", ":")) + "\n")


def write_small_files() -> None:
    (ROOT / "logs").mkdir(parents=True, exist_ok=True)
    (ROOT / "config").mkdir(parents=True, exist_ok=True)
    (ROOT / "notes").mkdir(parents=True, exist_ok=True)
    (ROOT / "accounts").mkdir(parents=True, exist_ok=True)
    (ROOT / "metrics").mkdir(parents=True, exist_ok=True)
    (ROOT / "deploys").mkdir(parents=True, exist_ok=True)
    (ROOT / "alerts").mkdir(parents=True, exist_ok=True)
    (ROOT / "docs").mkdir(parents=True, exist_ok=True)
    (ROOT / "scripts").mkdir(parents=True, exist_ok=True)

    (ROOT / "README.md").write_text(
        """# Edge authentication operations\n\nThis folder is the overnight handoff for the edge authentication gateway. The gateway accepts sign-in traffic, performs challenge steps, and issues short-lived tokens.\n\nStart with the service notes and the gateway log field guide. The CSV files are exported snapshots, not authoritative configuration. Preserve the input files when writing an incident analysis.\n\nThe report requested by the lead belongs at `analysis/2026-05-02-auth-spike.md`.\n""",
        encoding="utf-8",
    )
    (ROOT / "logs/README.md").write_text(
        """# Gateway log field guide\n\nEach JSON line has `ts`, `node`, `event`, `account`, `src_ip`, `ua`, and `reason`. The event values are `login_attempt`, `login_ok`, `login_fail`, `mfa_challenge`, `mfa_ok`, and `token_issued`.\n\n`ts` is an ISO 8601 timestamp. Gateway node `gw-a` records UTC. Node `gw-b` records local time (UTC-5) because of a known configuration bug tracked in `OPS-1842`; convert it before comparing nodes.\n\nA failed login is an unsuccessful credential check. A successful login does not by itself prove that a usable session was made; inspect the subsequent challenge and token events.\n""",
        encoding="utf-8",
    )
    (ROOT / "config/allowlist.yaml").write_text(
        """# Egress addresses approved for interactive authentication\noffice:\n  cidrs:\n    - 203.0.113.0/26\n  owner: workplace-network\nvpn:\n  cidrs:\n    - 198.51.100.8/29\n  owner: remote-access\nreviewed: 2026-04-28\n""",
        encoding="utf-8",
    )
    (ROOT / "notes/oncall.md").write_text(
        """# Overnight handoff\n\nAlert: `auth-gateway-failure-rate` crossed its warning threshold during the night window. The page includes both gateway nodes and a high volume of rejected credentials.\n\nFirst guess from on-call: **probably the load test again?**\n\nPlease leave a concise security analysis for the morning lead. Include affected identities, source addresses, and concrete containment steps.\n""",
        encoding="utf-8",
    )
    (ROOT / "notes/load-test-schedule.md").write_text(
        """# QA traffic schedule\n\nQA runs a repeatable gateway load test every night from 02:00 to 02:20 UTC. It originates at `198.51.100.10` and uses 50 accounts whose IDs begin with `qa-`. The test is approved by the release engineering rotation.\n\nThis note is retained for correlation with overnight alerts; it does not replace review of the authentication events.\n""",
        encoding="utf-8",
    )
    (ROOT / "alerts/auth-spike.yaml").write_text(
        """name: auth-gateway-failure-rate\nowner: security-oncall\nwindow: overnight\ncondition: rejected-login-rate above baseline\nfor: 5m\nnotifications:\n  - pager\n  - security-mailbox\n""",
        encoding="utf-8",
    )
    (ROOT / "docs/runbook.md").write_text(
        """# Authentication alert runbook\n\nUse the gateway logs to establish a normalized time window before correlating nodes. Separate approved synthetic traffic from unknown sources.\n\nFor an identity review, distinguish a rejected credential, a successful login, a completed challenge, and a token issuance. Record exact evidence as a relative file path and one-based line number.\n\nContainment decisions must name an owner and leave a reversible audit trail.\n""",
        encoding="utf-8",
    )
    (ROOT / "scripts/check_window.py").write_text(
        """#!/usr/bin/env python3\nimport json\nimport sys\nfrom pathlib import Path\n\nfor name in sys.argv[1:]:\n    with Path(name).open() as stream:\n        for line in stream:\n            row = json.loads(line)\n            if row.get('event') in {'login_ok', 'token_issued'}:\n                print(row['ts'], row['node'], row['account'])\n""",
        encoding="utf-8",
    )
    (ROOT / "scripts/rotate_gateway_logs.sh").write_text(
        """#!/bin/sh\nset -eu\n# The host timer owns compression and retention.\nfor file in logs/gw-*.jsonl; do\n  test -s "$file" || exit 1\ndone\nprintf '%s\\n' 'gateway log inputs present'\n""",
        encoding="utf-8",
    )


def write_directory() -> None:
    path = ROOT / "accounts/directory.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["account_id", "display_name", "mfa", "last_password_change"])
        compromised = {"acct-0017", "acct-0042", "acct-0108", "acct-0231", "acct-0414", "acct-0599"}
        challenge = {"acct-0701", "acct-0702", "acct-0703"}
        legitimate = {"acct-0711", "acct-0712"}
        for i in range(1, 721):
            account = f"acct-{i:04d}"
            mfa = "off" if account in compromised else "on"
            if account in challenge:
                mfa = "on"
            name = f"Staff Account {i:04d}"
            if account in legitimate:
                name = "Known Device Test User " + account[-2:]
            writer.writerow([account, name, mfa, f"2026-04-{(i % 27) + 1:02d}"])
        for i in range(1, 51):
            writer.writerow([f"qa-{i:03d}", f"QA Synthetic User {i:03d}", "on", "2026-04-15"])


def write_metrics_and_deploys() -> None:
    with (ROOT / "metrics/gateway_hourly.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["hour_utc", "node", "login_rate", "failure_rate", "p95_ms", "token_rate"])
        for hour in range(24):
            for node in ("gw-a", "gw-b"):
                base_rate = 410 + RNG.randrange(-35, 36)
                failure = round(0.018 + RNG.random() * 0.012, 4)
                p95 = 185 + RNG.randrange(-18, 31)
                tokens = 325 + RNG.randrange(-25, 26)
                writer.writerow([f"2026-05-01T{hour:02d}:00:00Z", node, base_rate, failure, p95, tokens])
    with (ROOT / "deploys/history.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["deployed_at", "service", "version", "change_ticket", "result"])
        services = ["edge-auth", "risk-adapter", "session-cache", "audit-forwarder"]
        for i in range(32):
            hour = (i * 7) % 24
            writer.writerow([
                f"2026-04-{(i % 28) + 1:02d}T{hour:02d}:20:00Z",
                services[i % len(services)],
                f"2026.05.{i % 9 + 1}",
                f"REL-{810 + i}",
                "complete" if i != 17 else "rolled-back",
            ])


def build_logs() -> None:
    nodes = {"gw-a": [], "gw-b": []}
    attack_ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
    comp = ["acct-0017", "acct-0042", "acct-0108", "acct-0231", "acct-0414", "acct-0599"]
    challenged = ["acct-0701", "acct-0702", "acct-0703"]
    noncomp = [f"acct-{i:04d}" for i in range(1, 641) if f"acct-{i:04d}" not in comp]
    noncomp.extend(["acct-0641", "acct-0642", "acct-0643"])
    special_comp = {10: comp[0], 100: comp[1], 300: comp[2], 600: comp[3], 900: comp[4], 1300: comp[5]}
    special_challenge = {30: challenged[0], 700: challenged[1], 1500: challenged[2]}
    start = BASE + timedelta(hours=1, minutes=10)

    for i in range(2200):
        if i < 1800:
            src = f"192.0.2.{1 + ((i * 37) % 254)}"
        else:
            src = "203.0.113.77"
        ts = start + timedelta(seconds=(85 * 60) * i / 2199)
        node = "gw-a" if i % 2 == 0 else "gw-b"
        account = special_comp.get(i) or special_challenge.get(i) or noncomp[(i * 17) % len(noncomp)]
        fail = record(ts, node, "login_fail", account, src, attack_ua, "password_rejected")
        nodes[node].append(fail)
        if i in special_comp:
            nodes[node].append(record(ts + timedelta(seconds=4), node, "login_ok", account, src, attack_ua, "password_match"))
            nodes[node].append(record(ts + timedelta(seconds=7), node, "token_issued", account, src, attack_ua, "session_created"))
        elif i in special_challenge:
            nodes[node].append(record(ts + timedelta(seconds=4), node, "login_ok", account, src, attack_ua, "password_match"))
            nodes[node].append(record(ts + timedelta(seconds=7), node, "mfa_challenge", account, src, attack_ua, "challenge_sent"))

    # Two successful sign-ins by known users are inside the security window.
    for account, src, ts in [
        ("acct-0711", "198.51.100.21", BASE + timedelta(minutes=45)),
        ("acct-0712", "198.51.100.22", BASE + timedelta(minutes=46)),
    ]:
        nodes["gw-a"].append(record(ts, "gw-a", "login_attempt", account, src, "Mozilla/5.0 (Macintosh; Intel Mac OS X)", "known_device"))
        nodes["gw-a"].append(record(ts + timedelta(seconds=3), "gw-a", "login_ok", account, src, "Mozilla/5.0 (Macintosh; Intel Mac OS X)", "known_device"))
        inside = BASE + timedelta(hours=1, minutes=30 if account.endswith("11") else 2, seconds=20)
        nodes["gw-a"].append(record(inside, "gw-a", "login_ok", account, src, "Mozilla/5.0 (Macintosh; Intel Mac OS X)", "known_device"))

    # The approved QA run is deliberately represented as ordinary failures.
    for i in range(600):
        ts = BASE + timedelta(hours=2, seconds=(20 * 60) * i / 599)
        account = f"qa-{(i % 50) + 1:03d}"
        nodes["gw-b"].append(record(ts, "gw-b", "login_fail", account, "198.51.100.10", "qa-runner/4.8", "scheduled_load_test"))

    # Fill each node with routine, mixed traffic over the full day.
    for node in nodes:
        need = 2500 - len(nodes[node])
        for i in range(need):
            seconds = RNG.randrange(0, 24 * 60 * 60)
            ts = BASE - timedelta(hours=6) + timedelta(seconds=seconds)
            roll = RNG.random()
            if roll < 0.52:
                event = "login_attempt"
                reason = "normal_interactive"
            elif roll < 0.78:
                event = "login_fail"
                reason = "bad_password"
            elif roll < 0.88:
                event = "login_ok"
                reason = "normal_interactive"
            elif roll < 0.94:
                event = "mfa_challenge"
                reason = "step_up_required"
            elif roll < 0.98:
                event = "mfa_ok"
                reason = "challenge_completed"
            else:
                event = "token_issued"
                reason = "session_created"
            account = f"acct-{RNG.randrange(1, 721):04d}"
            src = f"10.{RNG.randrange(16, 24)}.{RNG.randrange(0, 256)}.{RNG.randrange(1, 255)}"
            ua = RNG.choice(["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Mozilla/5.0 (Macintosh; Intel Mac OS X)", "gateway-probe/2.1"])
            nodes[node].append(record(ts, node, event, account, src, ua, reason))

    for node, rows in nodes.items():
        rows.sort(key=lambda row: row["_actual"])
        assert len(rows) == 2500, (node, len(rows))
        write_jsonl(ROOT / f"logs/{node}.jsonl", rows)


def main() -> None:
    if ROOT.exists():
        shutil.rmtree(ROOT)
    ROOT.mkdir(parents=True)
    write_small_files()
    write_directory()
    write_metrics_and_deploys()
    build_logs()


if __name__ == "__main__":
    main()
