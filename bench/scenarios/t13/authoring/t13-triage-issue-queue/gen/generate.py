#!/usr/bin/env python3
"""Create the local triage fixture with deterministic operational noise."""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED = 271828
ROOT = Path(__file__).resolve().parents[1] / "fixture"
rng = random.Random(SEED)


def write(rel: str, text: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def issue(number: int, title: str, reporter: str, date: str, body: str, env: str, comments: list[str], reactions: int) -> None:
    lines = [
        f"# ISSUE-{number}: {title}",
        f"Reporter: {reporter}",
        f"Date: {date}",
        "",
        body,
        "",
        f"Environment: {env}",
        "",
        "Comments:",
    ]
    lines.extend(f"- {comment}" for comment in comments)
    lines.extend(["", f"Reactions: {reactions}"])
    write(f"issues/ISSUE-{number}.md", "\n".join(lines))


ROOT.mkdir(parents=True, exist_ok=True)
write("README.md", """# Northstar service operations folder

This folder is the working export for the Northstar team's April triage rotation. The issue files are the public queue; the operational files are a small snapshot from the same service family. Dates in logs and deploy records use UTC.

The `src/` tree is intentionally partial. It contains the paths that were linked from reports, not a buildable checkout. Treat comments and reactions as reporter context, not as severity by themselves.

Useful starting points are `CODEOWNERS`, `docs/severity.md`, and `docs/triage-process.md`. The old note in `notes/` is retained because the export was assembled from a shared folder.
""")
write("CODEOWNERS", """# Path ownership for the Northstar monorepo
/src/api/       @platform-api
/src/web/       @web
/src/billing/   @billing
/infra/         @sre
/docs/          @docs
""")
write("CHANGELOG.md", """# Changelog

## 1.8.2
- fixed the CSV export dropping the last row
- refreshed the support contact in the account page

## 1.8.1
- changed export batching for large result sets
- added Safari session diagnostics

## 1.8.0
- added invoice footer localization
""")
write("docs/severity.md", """# Severity guide

- **S1**: data loss or security exposure.
- **S2**: a feature is broken and there is no workaround.
- **S3**: a workaround exists.
- **S4**: cosmetic or low-impact presentation issue.

The labels used in this queue are `bug`, `security`, `enhancement`, `needs-info`, `duplicate`, `fixed`, `browser`, `billing`, `export`, `upload`, `auth`, and `ui`.
""")
write("docs/triage-process.md", """# Triage process

Ask for `needs-info` when an issue has no reproduction details. A duplicate closes with a link to the oldest issue in its group. Security reports move to the private tracker rather than staying in the public queue.

Record the owning team from `CODEOWNERS`, keep a short evidence-based reason, and use the issue comments as additional context. A fix already named in the changelog should not be scheduled as new work.
""")
write("docs/old-browser-matrix.md", """# Browser matrix (archived)

This note predates the current support page. It is kept for historical context and should not be treated as a current compatibility contract.

The old matrix lists several browsers and mobile versions, but it does not define triage priority.
""")
write("src/api/export.py", """\"\"\"Export and session endpoints referenced by the issue queue.\"\"\"

EXPORT_ROUTE = "/v1/exports"
SESSION_ROUTE = "/v1/session"
MOBILE_UPLOAD_ROUTE = "/v1/mobile/uploads"


def queue_export(account_id: str, query: str) -> str:
    return f"queued:{account_id}:{len(query)}"


def validate_session(cookie: str) -> bool:
    return bool(cookie)
""")
write("src/web/app.js", """// Browser-side entry points mentioned by support reports.
export const uploadEndpoint = "/v1/uploads";
export const loginEndpoint = "/v1/session";
export const invoiceEndpoint = "/v1/invoices";

export function renderExportState(state) {
  return state === "ready" ? "Download" : "Preparing";
}

export function browserFamily(userAgent) {
  return /Safari/i.test(userAgent) ? "safari" : "other";
}
""")
write("src/billing/invoices.py", """\"\"\"Invoice presentation and access helpers.\"\"\"

INVOICE_ROUTE = "/v1/invoices/{invoice_id}"
FOOTER_COPY = "Thank you for choosing Northstar"


def invoice_path(invoice_id: str) -> str:
    return INVOICE_ROUTE.format(invoice_id=invoice_id)


def footer(locale: str) -> str:
    return FOOTER_COPY if locale == "en" else "Merci de choisir Northstar"
""")
write("infra/alerts.yaml", """groups:
  - name: edge
    rules:
      - alert: Gateway5xxBurst
        expr: rate(gateway_requests_total{status=~\"5..\"}[5m]) > 0.04
      - alert: SlowExportQueue
        expr: histogram_quantile(0.95, export_queue_seconds) > 12
  - name: billing
    rules:
      - alert: InvoiceReadDenied
        expr: rate(invoice_access_denied_total[10m]) > 0.02
owners:
  edge: sre
  billing: billing
""")
write("scripts/healthcheck.sh", """#!/bin/sh
set -eu
endpoint=${1:-http://127.0.0.1:8080/health}
printf 'checking %s\\n' "$endpoint"
curl -fsS --max-time 3 "$endpoint" >/dev/null
printf 'healthy\\n'
""")
write("scripts/old_csv_probe.py", """#!/usr/bin/env python3
# Unrelated utility retained from the support handoff.
import csv
import sys

with open(sys.argv[1], newline='', encoding='utf-8') as handle:
    for row in csv.reader(handle):
        print(row)
""")
write("notes/old-triage.md", """# Old triage notes

These notes are from an earlier rotation and are not a decision record. The on-call alias changed after they were written. Several reminders here refer to queues that no longer exist.

- keep examples short
- link the oldest report when merging duplicates
- do not infer a browser from a screenshot alone
""")

issue(401, "Export button hangs after preparing", "Mina K.", "2026-04-13", "The export button stays on Preparing for several minutes and never offers a CSV. It happens for a saved report with about 8,000 rows.", "Chrome 124 on macOS 14; release 1.8.1; account ac-77", ["I can reproduce it twice this morning; the network tab keeps the export request pending."], 7)
issue(402, "Cannot reproduce export from screenshot", "Ravi P.", "2026-04-13", "The attached screenshot shows an empty export toast, but I do not remember the exact clicks or the version. Please tell me what to try.", "version unknown; browser unknown", ["Support asked for a recording and a version; none has arrived."], 1)
issue(403, "Filter chips vanish on narrow screens", "Jo Ellis", "2026-04-13", "On a narrow browser window, removing one filter makes the remaining chips disappear until reload. The table data is still correct.", "Firefox 125 on Ubuntu 24.04; release 1.8.1", ["A full-width window is a usable workaround."], 3)
issue(404, "Safari login returns to sign-in", "Nora V.", "2026-04-14", "I enter valid credentials, see the dashboard for a moment, then land back on the sign-in page. It only happens in Safari.", "Safari 17.4 on macOS 14.4; release 1.8.1", ["Clearing site data did not change it."], 12)
issue(405, "Blank page from a support screenshot", "Lee Santos", "2026-04-14", "There is a screenshot of a blank page. No URL, browser version, account, or steps were included.", "version not supplied; environment not supplied", ["Could not reproduce from the image alone."], 0)
issue(406, "Web upload fails over 10 MB", "Priya N.", "2026-04-14", "The web uploader rejects files larger than 10 MB with a generic error. Smaller files complete normally, so splitting a file is possible for now.", "Chrome 124 on Windows 11; release 1.8.1; 12 MB PDF", ["The same file uploads when split into two parts."], 8)
issue(407, "Invoice list takes a long time to open", "Owen Ward", "2026-04-14", "The invoice list can take 20 seconds to open for an account with a large history. Refreshing eventually works.", "Edge 123 on Windows 11; release 1.8.1; account ac-184", ["Support suggested filtering by month as a temporary workaround."], 4)
issue(408, "CSV export drops the last row", "Talia Reed", "2026-04-14", "A CSV downloaded on 1.8.1 was missing its final row. The changelog says this was fixed in 1.8.2, so this report is retained for the audit trail.", "Chrome 123 on Linux; release 1.8.1", ["Verified fixed after the 1.8.2 rollout."], 5)
issue(409, "Export spinner never finishes", "Samir Holt", "2026-04-15", "The export spinner remains indefinitely for a large saved report. No file arrives even after waiting.", "Chrome 124 on macOS 14; release 1.8.1; account ac-77", ["This looks identical to ISSUE-401 from yesterday."], 2)
issue(410, "Help link has the wrong destination", "Cleo Martin", "2026-04-15", "The Help link in the account menu opens an outdated support page. Copying the current URL into the address bar works.", "Firefox 125 on Ubuntu 24.04; release 1.8.1", ["The link is usable after copying the address manually."], 2)
issue(411, "Invoice footer has a spelling error", "Drew Ng", "2026-04-15", "English invoices show a misspelled word in the thank-you footer. The totals and payment details are correct.", "Chrome 124 on Windows 11; release 1.8.1; locale en-US", ["The same typo appears on PDF and HTML invoices."], 6)
issue(412, "Retrying a report sends duplicate email", "Gina Park", "2026-04-15", "When a report email times out, retrying sends two messages to the recipient. Waiting for the first request to finish avoids the duplicate.", "Chrome 124 on macOS 14; release 1.8.1", ["I can avoid it by not clicking retry until the status changes."], 9)
issue(413, "Funny, I saw someone else's invoice when I changed the id", "Marco B.", "2026-04-16", "Funny, I saw someone else's invoice when I changed the id in the URL. I only changed the number and did not expect another account's details to load.", "Chrome 124 on Windows 11; release 1.8.1; account ac-991", ["I stopped testing and did not save a copy of the invoice."], 16)
issue(414, "Mobile upload error", "Ari Chen", "2026-04-16", "The app displays an upload error, but the report has no app version, file type, size, or steps. Only a cropped screenshot is attached.", "iPhone; version not supplied", ["Please provide the app version and one small test file."], 2)
issue(415, "iOS upload fails for every file", "Helen Wu", "2026-04-16", "On iOS, uploads fail for both a 200 KB image and a 40 MB video. The web uploader still works for me, so this is not the large-file browser report.", "iOS 17.4, Northstar app 1.8.1; account ac-211", ["Reinstalling the app did not help; web upload succeeds."], 10)
issue(416, "Account timezone label is clipped", "Bea Cole", "2026-04-17", "The timezone label is clipped in the account settings panel at 125% zoom. The setting can still be changed.", "Chrome 124 on Windows 11; release 1.8.1", ["Reducing zoom is a workaround."], 1)
issue(417, "Large export remains stuck", "Inez Ford", "2026-04-17", "A saved report export stays stuck in the preparing state and never downloads. It appears to be the same behavior as another export report.", "Chrome 124 on macOS 14; release 1.8.1; account ac-77", ["I found ISSUE-401 after filing this."], 1)
issue(418, "Webhook test gives no useful error", "Max Doran", "2026-04-17", "The webhook test reports Failed without showing the response code. Retrying after a few minutes usually succeeds.", "Edge 123 on Windows 11; release 1.8.1", ["A retry is a workable temporary path."], 3)
issue(419, "App crashes on start", "Jules King", "2026-04-17", "The app crashes immediately after opening and shows no usable screen. This is blocking me from checking today's invoices.", "Internet Explorer 11 on Windows 10; release 1.8.1", ["It works on Chrome 124 on the same machine; the browser in the original report is unsupported."], 34)
issue(420, "Safari keeps sending me back to login", "Nora V.", "2026-04-18", "Safari sends me back to the sign-in page after a successful login. This is the same loop described in ISSUE-404.", "Safari 17.4 on macOS 14.4; release 1.8.1", ["Please link this to ISSUE-404."], 4)
issue(421, "Add scheduled invoice exports", "Quinn Bell", "2026-04-18", "It would be useful to schedule an invoice CSV every Monday and send it to a chosen address. This is a request for a new capability, not a report of a broken existing feature.", "Chrome 124 on macOS 14; release 1.8.1", ["Several finance users asked for the same workflow."], 11)
issue(422, "Sort order resets after returning to a list", "Nadia Shah", "2026-04-18", "After opening an invoice and going back, the list loses the selected sort order. Selecting the sort again restores the intended view.", "Firefox 125 on Ubuntu 24.04; release 1.8.1", ["The workaround is to select the sort after returning."], 5)
issue(423, "Thank-you line typo on invoice", "Drew Ng", "2026-04-18", "The thank-you line on an invoice contains the same spelling mistake reported in ISSUE-411.", "Chrome 124 on Windows 11; release 1.8.1; locale en-US", ["Confirmed this is the same footer text as ISSUE-411."], 2)
issue(424, "Permissions page does not load", "Casey Fox", "2026-04-18", "The permissions page does not load, but the report has no steps, account role, version, or browser details. The screenshot alone is not enough to reproduce it.", "unknown version; unknown browser", ["Asked the reporter for a URL, role, and browser version."], 1)

start = datetime(2026, 4, 18, 0, 0, tzinfo=timezone.utc)
services = ["edge", "api", "worker", "billing"]
levels = ["INFO", "INFO", "INFO", "WARN"]
paths = ["/health", "/v1/session", "/v1/invoices", "/v1/exports", "/metrics"]
log_lines: list[str] = []
for i in range(3600):
    ts = start + timedelta(seconds=i * 24)
    service = services[i % len(services)]
    level = levels[(i * 7) % len(levels)]
    request_id = f"req-{rng.randrange(100000, 999999)}"
    path = paths[(i * 3) % len(paths)]
    latency = rng.randint(8, 420)
    status = 200 if i % 29 else 503
    if i % 41 == 0:
        message = "retrying upstream request attempt=2"
    elif i % 53 == 0:
        message = "slow request observed"
    elif i % 67 == 0:
        message = "health check completed"
    else:
        message = "request completed"
    log_lines.append(f"{ts.isoformat().replace('+00:00', 'Z')} {level} service={service} request_id={request_id} method=GET path={path} status={status} latency_ms={latency} {message}")
# Operational detail is intentionally well past the first screen of this file.
log_lines.extend([
    "2026-04-18T23:12:00Z WARN service=api request_id=req-880201 export queue depth=43 worker_wait_ms=1880",
    "2026-04-18T23:12:24Z WARN service=api request_id=req-880202 export queue depth=47 worker_wait_ms=2410",
    "2026-04-18T23:12:48Z INFO service=worker request_id=req-880203 export retry scheduled attempt=2 backoff_ms=5000",
    "2026-04-18T23:13:12Z WARN service=api request_id=req-880204 export request status=202 latency_ms=18400 queue_wait_ms=16100",
    "2026-04-18T23:13:36Z INFO service=api request_id=req-880205 export response completed rows=8000 bytes=921004",
])
write("logs/gateway.log", "\n".join(log_lines))

metric_rows = ["metric,unit,description", "gateway_requests_total,count,requests accepted at the edge", "gateway_5xx_ratio,ratio,share of gateway responses with 5xx", "export_queue_depth,count,queued export jobs", "export_request_latency_ms,milliseconds,export request duration", "invoice_access_denied_total,count,invoice reads denied by policy", "upload_bytes_total,bytes,accepted upload payload bytes", "session_redirect_total,count,session redirects"]
metric_rows.extend(f"routine_metric_{i},count,retained catalogue metric" for i in range(1, 16))
write("metrics/catalogue.csv", "\n".join(metric_rows))

history = []
for i in range(18):
    when = start + timedelta(days=i - 17, hours=3 + i % 5)
    history.append(json.dumps({"time": when.isoformat().replace("+00:00", "Z"), "release": f"1.{max(0, i - 1)}.{i % 4}", "service": services[i % len(services)], "status": "complete", "operator": ["lena", "omar", "suki"][i % 3]}))
history.extend([
    json.dumps({"time": "2026-04-17T20:10:00Z", "release": "1.8.2", "service": "api", "status": "complete", "operator": "omar"}),
    json.dumps({"time": "2026-04-18T02:20:00Z", "release": "1.8.2", "service": "web", "status": "complete", "operator": "suki"}),
])
write("deploy/history.jsonl", "\n".join(history))
