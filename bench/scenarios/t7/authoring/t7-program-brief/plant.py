#!/usr/bin/env python3
"""Add the scenario-specific records after the ordinary exports are generated."""
from __future__ import annotations

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixture"


def edit_ticket(ticket_id: str, **changes: str) -> None:
    path = ROOT / "open-requests.csv"
    with path.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
        fields = rows[0].keys()
    for row in rows:
        if row["id"] == ticket_id:
            row.update(changes)
            break
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    # These are ordinary-looking requests, distributed through the sequence.
    edit_ticket(
        "REQ-012",
        title="Provide deployment identity for service accounts",
        status="Open",
        votes="8",
        requester="release-ops",
        team="Platform",
        estimate_points="5",
        comment="Release jobs need token exchange through the Identity Services endpoint. The service owner asked for one interface before the teams change their runners.",
    )
    edit_ticket(
        "REQ-027",
        title="Coordinate shared deployment migration window",
        status="Open",
        votes="12",
        requester="service-team",
        team="Atlas",
        estimate_points="3",
        comment="Please confirm whether the Atlas or Beacon release group will own the first migration window.",
    )
    edit_ticket(
        "REQ-043",
        title="Add deployment audit history export",
        status="In Progress",
        votes="17",
        requester="quality",
        team="Atlas",
        estimate_points="3",
        comment="Reviewers need to find release records after the deployment; the current export is incomplete.",
    )
    edit_ticket(
        "REQ-068",
        title="Add feature flag controls to release console",
        status="Open",
        votes="96",
        requester="product",
        team="Growth",
        estimate_points="8",
        comment="Several requesters asked for a simple toggle during a rollout.",
    )
    edit_ticket(
        "REQ-086",
        title="Document rollback steps for service owners",
        status="Open",
        votes="14",
        requester="support",
        team="Cedar",
        estimate_points="2",
        comment="The current instructions omit the final verification step.",
    )
    edit_ticket(
        "REQ-055",
        requester="relase-ops",
        comment="Please check this against the staging workflow; requester spelling came from the source export.",
    )

    (ROOT / "atlas-roadmap.md").write_text("""# Atlas roadmap\n\nAs of 2027-04-12. Quarter labels use calendar quarters.\n\n| Quarter | Work | Owner | Status | Dependency |\n|---|---|---|---|---|\n| 2027-Q2 | Refresh release checklist | Atlas | planned | REQ-006 |\n| 2027-Q3 | Shared deployment migration | Atlas | planned | REQ-012 |\n| 2027-Q4 | Archive old release reports | Atlas | proposed | REQ-022 |\n""", encoding="utf-8")
    (ROOT / "beacon-roadmap.md").write_text("""# Beacon roadmap\n\nAs of 2027-04-12. Quarter labels use calendar quarters.\n\n| Quarter | Work | Owner | Status | Dependency |\n|---|---|---|---|---|\n| 2027-Q2 | Improve approval queue | Beacon | planned | REQ-009 |\n| 2027-Q3 | Shared deployment migration | Beacon | planned | REQ-012 |\n| 2027-Q4 | Remove an old queue | Beacon | proposed | REQ-026 |\n""", encoding="utf-8")
    (ROOT / "cedar-roadmap.md").write_text("""# Cedar roadmap\n\nAs of 2027-04-12. Quarter labels use calendar quarters.\n\n| Quarter | Work | Owner | Status | Dependency |\n|---|---|---|---|---|\n| 2027-Q2 | Document service promotion | Cedar | planned | REQ-011 |\n| 2027-Q3 | Cedar service release wave | Cedar | planned | REQ-012 |\n| 2027-Q4 | Simplify test cleanup | Cedar | proposed | REQ-031 |\n""", encoding="utf-8")

    (ROOT / "README.md").write_text("""# Shared deployment program inputs\n\nThese exports are as of **2027-04-12**, which is the working date for this folder. Dates use ISO format. Quarter labels are calendar quarters.\n\n## Files\n\n- `leadership-memo.md`: the request, scope, required staffing, retention and sign-in requirements, and suggested checkpoints.\n- `atlas-tools.csv`, `beacon-tools.csv`, `cedar-tools.csv`: one inventory per team. Columns are tool name, version, owning team, environments, audit retention in days, sign-in mode, lifecycle status, and a free-text note.\n- `atlas-roadmap.md`, `beacon-roadmap.md`, `cedar-roadmap.md`: each team's planned work. Table columns are quarter, work, owner, status, and a recorded dependency.\n- `open-requests.csv`: request export. Columns are id, title, status, votes, requester, team, estimate points, created date, updated date, and comment. Empty estimate cells mean no estimate was recorded.\n- `headcount.csv`: current staffing. `engineering_headcount` is the team total; `available_program_engineers` is the number available for this program during the stated period.\n- `capacity-2027.csv`: remaining engineer-days by sprint. Sprints run Monday through Friday for two weeks, and the listed holiday removes one working day from each team's capacity. Blank holiday cells mean no listed holiday.\n\nFor request triage, `Open`, `In Progress`, and `Waiting` are active statuses. `Closed`, `Done`, and `Cancelled` are historical and are not active requests. Votes are a request signal, not a scope decision.\n\nThe exports include comments, blank cells, old rows, and spelling variations because they came from separate team systems. Match team names case-insensitively and do not infer missing estimates.\n""", encoding="utf-8")


if __name__ == "__main__":
    main()
