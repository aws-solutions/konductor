#!/usr/bin/env python3
"""Derive the hidden release-decision key using only fixture files."""
from __future__ import annotations

import csv
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
OUT = ROOT / "hidden" / "key.json"


def csv_rows(name: str) -> list[dict[str, str]]:
    with (FIXTURE / name).open(encoding="utf-8", newline="") as fh:
        rows = [line for line in fh if not line.startswith("#")]
    return list(csv.DictReader(rows))


def norm(value: str | None) -> str:
    return (value or "").strip().lower()


def main() -> None:
    issues = csv_rows("release_blockers.csv")
    by_id = {r["ticket_id"].strip().upper(): r for r in issues}
    triage = {r["ticket_id"].strip().upper(): norm(r["triage_disposition"]) for r in csv_rows("triage_notes.csv")}
    queue = csv_rows("cherry_pick_queue.csv")
    ci = json.loads((FIXTURE / "ci_signal_summary.json").read_text(encoding="utf-8"))
    calendar = json.loads((FIXTURE / "release_calendar.json").read_text(encoding="utf-8"))
    notes = (FIXTURE / "release_notes_draft.md").read_text(encoding="utf-8")

    active_labeled = []
    for ticket, row in by_id.items():
        labels = {part.strip().lower() for part in row["labels"].split(",") if part.strip()}
        if "release-blocker" in labels and triage.get(ticket, "active") not in {"demoted", "cancelled"}:
            active_labeled.append(ticket)

    queue_by_ticket = {r["ticket_id"].strip().upper(): r for r in queue}
    late = []
    for ticket in active_labeled:
        q = queue_by_ticket.get(ticket)
        if not q or norm(q["approval_status"]) not in {"approved", "merged"}:
            continue
        approved = datetime.strptime(q["approved_at"].strip(), "%Y-%m-%d %H:%M")
        deadline = datetime.strptime(q["deadline"].strip(), "%Y-%m-%d %H:%M")
        if approved > deadline:
            late.append(ticket)

    failing_jobs = [j["name"] for j in ci["jobs"] if j["required"] and j["pass_rate_7d"] < 100
                    and "every run" in norm(j.get("failure_pattern"))]
    flaky_jobs = [j["name"] for j in ci["jobs"] if j["required"] and 0 < j["pass_rate_7d"] < 100
                  and "intermittent" in norm(j.get("failure_pattern"))]
    failure_commits = {j.get("first_failure_commit") for j in ci["jobs"] if j["first_failure_commit"]}

    branch_missing = [ticket for ticket in active_labeled
                      if norm(by_id[ticket]["release_branch_present"]) != "yes"]
    regressions = [ticket for ticket in active_labeled if by_id[ticket]["main_commit"] in failure_commits]

    # Each issue can contribute one actionable blocker, with the queue fact taking precedence.
    blocker_ids: list[str] = []
    blockers: list[dict[str, object]] = []
    for ticket in active_labeled:
        row = by_id[ticket]
        q = queue_by_ticket.get(ticket)
        if ticket in late:
            summary = (f"Approved cherry-pick is after the {q['deadline']} deadline; "
                       f"{q['commit']} is not on {q['target_branch']}.")
        elif ticket in regressions:
            job_names = ", ".join(failing_jobs) or "a required CI job"
            summary = f"Required job {job_names} has repeated failures beginning at commit {row['main_commit']}."
        elif ticket in branch_missing:
            summary = "Fix is closed on main but the release branch does not contain its commit."
        else:
            continue
        blocker_ids.append(ticket)
        blockers.append({"tickets": [ticket], "summary": summary, "owner": row["owner"].strip()})

    corrections = []
    for ticket in re.findall(r"\bREL-\d+\b", notes, flags=re.I):
        ticket = ticket.upper()
        if ticket in by_id and norm(by_id[ticket]["status"]) == "reverted" and ticket not in corrections:
            corrections.append(ticket)

    current = calendar["current_release"]
    slots = sorted(calendar["release_slots"], key=lambda s: s["release_date"])
    target = next(s for s in slots if s["version"] == current)
    if blockers or failing_jobs or flaky_jobs or corrections:
        later = [s for s in slots if s["release_date"] > target["release_date"]]
        earliest = later[0]["release_date"] if later else target["release_date"]
    else:
        earliest = target["release_date"]

    decision = "no-go" if blockers or failing_jobs or flaky_jobs or corrections else "go"
    assertions = [
        {"id": "decision", "desc": "the release decision is no-go when unresolved release evidence remains",
         "op": "equals", "path": "decision", "value": decision},
        {"id": "blocker-precision", "desc": "the blockers list is focused on the derived actionable tickets",
         "op": "precision", "path": "blockers", "field": "tickets", "ids": blocker_ids,
         "min": 0.5, "maxCount": int(1.5 * len(blocker_ids) + 2)},
    ]
    for ticket in blocker_ids:
        assertions.append({"id": f"blocker-{ticket.lower()}", "desc": f"the blockers list cites {ticket}",
                            "op": "cites", "path": "blockers", "field": "tickets", "ids": [ticket]})
    for ticket in blocker_ids:
        assertions.append({"id": f"owner-{ticket.lower()}", "desc": f"the blocker entry for {ticket} names its owner",
                            "op": "cites", "path": "blockers", "field": "tickets", "ids": [ticket],
                            "where": {"owner": by_id[ticket]["owner"].strip()}})
    if failing_jobs:
        assertions.append({"id": "failing-jobs", "desc": "repeatedly failing required jobs are named",
                            "op": "includes", "path": "failing_jobs", "ids": failing_jobs})
    if flaky_jobs:
        assertions.append({"id": "flaky-jobs", "desc": "intermittent required jobs are named",
                            "op": "includes", "path": "flaky_jobs", "ids": flaky_jobs})
    assertions.extend([
        {"id": "late-cherry-picks", "desc": "the late approved cherry-picks are named",
         "op": "includes", "path": "late_cherry_picks", "ids": late},
        {"id": "notes-corrections", "desc": "reverted promises are marked for notes correction",
         "op": "includes", "path": "notes_corrections", "ids": corrections},
    ])
    demoted = [ticket for ticket in by_id if triage.get(ticket) == "demoted"]
    assertions.append({"id": "demoted-absent", "desc": "demoted release labels are not treated as blockers",
                        "op": "absent", "path": "blockers", "field": "tickets", "ids": demoted})
    assertions.append({"id": "earliest-slot", "desc": "the earliest defensible release slot is reported",
                       "op": "date", "path": "earliest_release_date", "value": earliest, "tolDays": 0})

    key = {"output": "release/go-no-go.md", "block": "release-decision", "assertions": assertions}
    OUT.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
