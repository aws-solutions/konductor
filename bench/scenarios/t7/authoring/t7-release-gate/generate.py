#!/usr/bin/env python3
"""Create the synthetic release-tracking fixture."""
from __future__ import annotations

import csv
import json
import random
from pathlib import Path

SEED = 27105
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixture"


def write_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(rows)


def main() -> None:
    rng = random.Random(SEED)
    OUT.mkdir(parents=True, exist_ok=True)

    owners = ["Asha Nair", "Mira Sol", "Jon Bell", "Lina Ortiz", "Pavel Chen", "Ruth Ives"]
    components = ["gateway", "storage", "client", "scheduler", "observability", "tooling"]
    verbs = ["Tighten", "Refresh", "Align", "Handle", "Reduce", "Document", "Harden", "Update"]
    objects = ["retry handling", "quota checks", "cache headers", "shutdown cleanup", "trace labels", "snapshot paths", "request guards", "upgrade notes"]
    statuses = ["Open", "In Progress", "Closed", "Closed", "Closed", "Cancelled"]
    issue_rows: list[list[str]] = []
    for i in range(60):
        ticket = f"REL-{100 + i}"
        status = rng.choice(statuses)
        owner = rng.choice(owners)
        component = rng.choice(components)
        title = f"{rng.choice(verbs)} {rng.choice(objects)}"
        labels = rng.choice(["maintenance", "release-blocker", "quality", "customer", "cleanup", ""])
        main_commit = f"{rng.choice('abcdef0123456789')}{rng.choice('abcdef0123456789')}{i:04x}"
        branch_present = "yes" if status in {"Closed", "Cancelled"} else rng.choice(["yes", "no"])
        opened = f"2027-04-{rng.randint(1, 24):02d}"
        closed = f"2027-04-{rng.randint(18, 30):02d}" if status == "Closed" else ""
        points = str(rng.choice([1, 2, 3, 5, 8])) if rng.random() > 0.12 else ""
        comment = rng.choice([
            "Needs a final verification pass.",
            "Reviewed in the daily handoff.",
            "Test coverage is included.",
            "Waiting on the next build.",
            "No customer-facing text requested.",
            "Follow-up can land separately.",
        ])
        issue_rows.append([ticket, title, status, labels, owner, component, main_commit,
                           branch_present, opened, closed, points, comment])

    # Keep ordinary label values varied, while reserving the release label for planted rows.
    for row in issue_rows:
        if row[3].lower() == "release-blocker":
            row[3] = "quality"

    # Plant ordinary-looking release facts at scattered positions in the export.
    def set_issue(ticket: str, **changes: str) -> None:
        idx = int(ticket.split("-")[1]) - 100
        fields = {
            "ticket_id": 0, "title": 1, "status": 2, "labels": 3, "owner": 4,
            "component": 5, "main_commit": 6, "release_branch_present": 7,
            "opened_date": 8, "closed_date": 9, "estimate_points": 10, "comment": 11,
        }
        for key, value in changes.items():
            issue_rows[idx][fields[key]] = value

    set_issue("REL-112", title="Handle snapshot paths", status="Closed", labels="release-blocker",
              owner="Mira Sol", component="storage", main_commit="a7d4e1c",
              release_branch_present="no", opened_date="2027-04-08", closed_date="2027-04-22",
              estimate_points="3", comment="Reviewed in the daily handoff.")
    set_issue("REL-118", title="Update upgrade notes", status="In Progress", labels="release-blocker",
              owner="Jon Bell", component="tooling", main_commit="b4e2f90",
              release_branch_present="no", opened_date="2027-04-12", closed_date="",
              estimate_points="2", comment="Waiting on the next build.")
    set_issue("REL-127", title="Refresh cache headers", status="Reverted", labels="customer",
              owner="Lina Ortiz", component="gateway", main_commit="d2aa761",
              release_branch_present="no", opened_date="2027-04-17", closed_date="",
              estimate_points="5", comment="Follow-up can land separately.")
    set_issue("REL-131", title="Align retry handling", status="In Progress", labels="release-blocker",
              owner="Asha Nair", component="gateway", main_commit="c9f1e2a",
              release_branch_present="yes", opened_date="2027-04-19", closed_date="",
              estimate_points="3", comment="Needs a final verification pass.")
    set_issue("REL-145", title="Reduce quota checks", status="Open", labels="release-blocker",
              owner="Pavel Chen", component="storage", main_commit="e8b1c44",
              release_branch_present="no", opened_date="2027-04-26", closed_date="",
              estimate_points="2", comment="Reviewed in the daily handoff.")

    # Add a couple of benign irregularities typical of an export.
    issue_rows[3][3] = "Maintenance"
    issue_rows[22][11] = ""
    issue_rows[38][2] = "closed "
    issue_path = OUT / "release_blockers.csv"
    with issue_path.open("w", newline="", encoding="utf-8") as fh:
        fh.write("# Export generated by release tracker; rows reflect the last sync.\n")
        writer = csv.writer(fh)
        writer.writerow(["ticket_id", "title", "status", "labels", "owner", "component", "main_commit",
                         "release_branch_present", "opened_date", "closed_date", "estimate_points", "comment"])
        writer.writerows(issue_rows)

    queue_rows = [
        ["REL-104", "a1e0034", "approved", "2027-04-24 11:10", "2027-04-28 17:00", "release/27.05", "N. Patel"],
        ["REL-112", "a7d4e1c", "proposed", "2027-04-25 09:30", "2027-04-28 17:00", "release/27.05", "Mira Sol"],
        ["REL-118", "b4e2f90", "approved", "2027-04-29 09:15", "2027-04-28 17:00", "release/27.05", "Jon Bell"],
        ["REL-121", "f0d112a", "merged", "2027-04-26 15:00", "2027-04-28 17:00", "release/27.05", "Ruth Ives"],
        ["REL-128", "aa9102b", "rejected", "2027-04-23 13:00", "2027-04-28 17:00", "release/27.05", "Lina Ortiz"],
        ["REL-139", "cc1009d", "approved", "2027-04-27 16:40", "2027-04-28 17:00", "release/27.05", "Pavel Chen"],
        ["REL-147", "d012a8e", "merged", "2027-04-21 10:20", "2027-04-28 17:00", "release/27.05", "Asha Nair"],
        ["REL-153", "bca8801", "cancelled", "2027-04-20 08:00", "2027-04-28 17:00", "release/27.05", "Mira Sol"],
    ]
    with (OUT / "cherry_pick_queue.csv").open("w", newline="", encoding="utf-8") as fh:
        fh.write("# Queue snapshot; timestamps are UTC.\n")
        writer = csv.writer(fh)
        writer.writerow(["ticket_id", "commit", "approval_status", "approved_at", "deadline", "target_branch", "requested_by"])
        writer.writerows(queue_rows)

    ci = {
        "branch": "release/27.05",
        "as_of": "2027-04-30",
        "window_start": "2027-04-24",
        "window_end": "2027-04-30",
        "pass_rate_unit": "percent",
        "jobs": [
            {"name": "linux-integration", "required": True, "runs": 20, "passes": 10,
             "pass_rate_7d": 50, "first_failure_commit": "c9f1e2a",
             "failure_pattern": "every run after the first failure commit"},
            {"name": "windows-smoke", "required": True, "runs": 20, "passes": 17,
             "pass_rate_7d": 85, "first_failure_commit": "", 
             "failure_pattern": "intermittent; failures on 2027-04-25, 2027-04-28, 2027-04-30"},
            {"name": "api-contract", "required": True, "runs": 20, "passes": 20,
             "pass_rate_7d": 100, "first_failure_commit": "", "failure_pattern": "none"},
            {"name": "docs-linkcheck", "required": False, "runs": 20, "passes": 19,
             "pass_rate_7d": 95, "first_failure_commit": "", "failure_pattern": "one transient timeout"},
        ],
    }
    (OUT / "ci_signal_summary.json").write_text(json.dumps(ci, indent=2) + "\n", encoding="utf-8")

    calendar = {
        "calendar_as_of": "2027-04-30",
        "timezone": "UTC",
        "current_release": "27.05",
        "release_slots": [
            {"version": "27.05", "release_date": "2027-05-06", "weekday": "Thursday",
             "code_freeze": "2027-04-29 17:00", "cherry_pick_deadline": "2027-04-28 17:00",
             "validation_start": "2027-05-03", "validation_end": "2027-05-05", "status": "planned"},
            {"version": "27.06", "release_date": "2027-05-13", "weekday": "Thursday",
             "code_freeze": "2027-05-06 17:00", "cherry_pick_deadline": "2027-05-05 17:00",
             "validation_start": "2027-05-10", "validation_end": "2027-05-12", "status": "planned"},
            {"version": "27.07", "release_date": "2027-05-20", "weekday": "Thursday",
             "code_freeze": "2027-05-13 17:00", "cherry_pick_deadline": "2027-05-12 17:00",
             "validation_start": "2027-05-17", "validation_end": "2027-05-19", "status": "planned"},
        ],
        "blackout_dates": ["2027-05-31"],
    }
    (OUT / "release_calendar.json").write_text(json.dumps(calendar, indent=2) + "\n", encoding="utf-8")

    (OUT / "release_notes_draft.md").write_text(
        """# 27.05 release notes draft\n\nAs of 2027-04-30\n\n## Highlights\n\n- REL-104: Refresh the request timeout guidance.\n- REL-127: Refresh cache headers for gateway responses.\n- REL-139: Add clearer quota messages.\n\n## Fixes\n\n- REL-112: Correct snapshot path handling during upgrades.\n- REL-121: Preserve trace labels in scheduled work.\n\n## Editorial notes\n\nThe final list should use ticket IDs and describe behavior that is in the release branch.\n""", encoding="utf-8")

    write_csv(OUT / "triage_notes.csv", ["ticket_id", "triage_disposition", "reviewer", "note"], [
        ["REL-105", "active", "Mira Sol", "Keep in the release review."],
        ["REL-112", "active", "Mira Sol", "Keep in the release review."],
        ["REL-118", "active", "Jon Bell", "Keep in the release review."],
        ["REL-131", "active", "Asha Nair", "Keep in the release review."],
        ["REL-145", "demoted", "Pavel Chen", "Track in the normal maintenance queue."],
        ["REL-153", "demoted", "Ruth Ives", "Cancelled during scope review."],
    ])

    write_csv(OUT / "team_roster.csv", ["name", "team", "backup", "timezone"], [
        ["Asha Nair", "runtime", "Mira Sol", "UTC+05:30"],
        ["Mira Sol", "storage", "Pavel Chen", "UTC-05:00"],
        ["Jon Bell", "tooling", "Ruth Ives", "UTC+00:00"],
        ["Lina Ortiz", "gateway", "Asha Nair", "UTC-06:00"],
        ["Pavel Chen", "storage", "Mira Sol", "UTC+01:00"],
        ["Ruth Ives", "quality", "Jon Bell", "UTC+00:00"],
    ])

    (OUT / "handoff_log.md").write_text(
        """# Release handoff log\n\nAs of 2027-04-30\n\n- 2027-04-28: queue review recorded; the normal deadline remains in the calendar.\n- 2027-04-29: owners were asked to keep ticket titles stable in exports.\n- 2027-04-30: draft notes and signal summary were refreshed.\n\nTimes in this folder use UTC unless a source says otherwise.\n""", encoding="utf-8")

    (OUT / "README.md").write_text(
        """# Release tracking folder\n\nAs of date: **2027-04-30**. The release under review is 27.05, scheduled for **Thursday 2027-05-06**. Dates and timestamps are UTC unless a file states otherwise.\n\n## Files\n\n- `release_blockers.csv`: the issue export. Columns are ticket ID, title, status, labels, owner, component, main commit, whether the commit is on the release branch, opened and closed dates, estimate points, and the last comment. `Closed` means closed on the main branch; the separate branch column is authoritative for branch contents. `Reverted` means the intended change was backed out. Blank estimates are unestimated.\n- `cherry_pick_queue.csv`: requested cherry-picks. Columns are ticket ID, commit, approval status, approval time, calendar deadline, target branch, and requester. Approval status is one of proposed, approved, merged, rejected, or cancelled.\n- `ci_signal_summary.json`: required and optional jobs for the release branch. Each job reports runs, passes, a seven-day pass rate in percent, its first failure commit when known, and a short observed failure pattern.\n- `release_calendar.json`: planned release slots, freeze times, cherry-pick deadlines, validation windows, and blackout dates. The weekday and ISO date in each slot are both part of the calendar record.\n- `release_notes_draft.md`: the current draft notes, with ticket IDs attached to claims.\n- `triage_notes.csv`: the latest triage disposition for selected tickets. `active` remains in the release review; `demoted` is handled in the normal maintenance queue; `cancelled` is no longer planned.\n- `team_roster.csv`: owner names, teams, backups, and time zones for matching names in the export.\n- `handoff_log.md`: dated handoff entries and the timestamp convention.\n\nThe issue export can contain cancelled and closed work, empty cells, comments, and case or spacing variations from the source systems. Treat ticket IDs as the stable join key. A required job is a release signal even when its issue list is otherwise quiet. The current release slot is the first slot in the calendar; later slots are planned alternatives.\n""", encoding="utf-8")


if __name__ == "__main__":
    main()
