#!/usr/bin/env python3
"""Create the deterministic ticket-export fixture for t7-status-slip."""
from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
SEED = 7127
rng = random.Random(SEED)

TEAMS = {
    "Payments": ["Ari Mendez", "Asha Iyer", "Jon Bell", "Priya Shah"],
    "Checkout": ["Luca Park", "Nia Cole", "Omar Reed", "Tessa Yu"],
    "Platform": ["Ben Ortiz", "Cora Lin", "Dev Patel", "Hana Moss"],
    "Risk": ["Eve Grant", "Finn Ward", "Gia Stone", "Inez Fox"],
    "Support": ["Jules Ray", "Kai Dunn", "Lana Price", "Milo Kent"],
}
TEAM_CODES = {
    "Payments": "PAY",
    "Checkout": "CHK",
    "Platform": "PLT",
    "Risk": "RISK",
    "Support": "SUP",
}
EPICS = [
    "Payments and Checkout Launch",
    "Merchant Console",
    "Account Recovery",
    "Order History",
    "Reliability Follow-ups",
]
STATUSES = ["To Do", "In Progress", "Done", "Cancelled"]
PRIORITIES = ["Low", "Medium", "High"]
FIELDS = [
    "id", "title", "epic", "team", "assignee", "status", "priority",
    "estimate_points", "sprint", "depends_on", "created", "due",
    "reopened", "status_history", "comments",
]


def iso(d: date) -> str:
    return d.isoformat()


def write_csv(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


FIXTURE.mkdir(exist_ok=True)
for old in FIXTURE.iterdir():
    if old.is_file():
        old.unlink()

# The generated portion is intentionally ordinary export noise. Seeded rows are
# appended below, so their IDs and dates remain easy for the key builder to derive.
rows: list[dict[str, str]] = []
start = date(2027, 4, 1)
for team_index, (team, people) in enumerate(TEAMS.items()):
    for n in range(1, 45):
        ticket_id = f"{TEAM_CODES[team]}-{n:03d}"
        created = start + timedelta(days=rng.randrange(0, 57))
        status = rng.choices(STATUSES, weights=[34, 26, 30, 10], k=1)[0]
        # Keep generated rows in other product areas. The launch rows below
        # replace ordinary sequence positions and remain easy to audit.
        epic = rng.choice(EPICS[1:])
        estimate = "" if n % 19 == 0 else str(rng.choice([1, 2, 3, 5, 8]))
        # Keep the generated export varied while leaving sprint S28 available
        # for the deliberately visible capacity example.
        sprint = rng.choice(["S27", "S29", "S30"])
        assignee = rng.choice(people)
        if team == "Payments" and n == 7:
            assignee = "Asha Iyer "  # the export retains a trailing-space variant
        due = created + timedelta(days=rng.randrange(21, 76))
        comments = rng.choice([
            "",
            "Needs product copy review",
            "QA sample attached",
            "Waiting on the next export refresh",
            "Carry-over from the previous sprint",
        ])
        history = "Created; In Progress" if status == "In Progress" else "Created"
        rows.append({
            "id": ticket_id,
            "title": rng.choice([
                "Tune retry handling", "Refresh validation copy", "Add audit field",
                "Update service alert", "Review edge-case behavior", "Improve list filtering",
                "Document support response", "Tidy event mapping",
            ]),
            "epic": epic,
            "team": team,
            "assignee": assignee,
            "status": status,
            "priority": rng.choice(PRIORITIES),
            "estimate_points": estimate,
            "sprint": sprint,
            "depends_on": "",
            "created": iso(created),
            "due": iso(due),
            "reopened": "false",
            "status_history": history,
            "comments": comments,
        })


def seeded(ticket_id: str, title: str, epic: str, team: str, assignee: str,
           status: str, priority: str, points: str, sprint: str,
           depends: str, created: str, due: str, comments: str = "") -> dict[str, str]:
    return {
        "id": ticket_id, "title": title, "epic": epic, "team": team,
        "assignee": assignee, "status": status, "priority": priority,
        "estimate_points": points, "sprint": sprint, "depends_on": depends,
        "created": created, "due": due, "reopened": "false",
        "status_history": "Created; In Progress" if status == "In Progress" else "Created",
        "comments": comments,
    }

launch = "Payments and Checkout Launch"
seeded_rows = [
    # The first prerequisite is in another product epic. It is three links
    # upstream of the final launch-readiness ticket.
    seeded("PLT-014", "Provision gateway certificate", "Merchant Console", "Platform", "", "In Progress", "Low", "3", "S28", "", "2027-05-20", "2027-06-23", "Vendor confirmation is in the shared thread"),
    seeded("PAY-021", "Finalize gateway settlement contract", launch, "Payments", "Priya Shah", "To Do", "High", "5", "S28", "PLT-014", "2027-05-21", "2027-06-28", ""),
    seeded("CHK-017", "Connect payment orchestration", launch, "Checkout", "Luca Park", "To Do", "High", "8", "S28", "PAY-021", "2027-05-24", "2027-07-02", ""),
    seeded("RISK-012", "Set launch transaction limits", launch, "Risk", "Eve Grant", "To Do", "Medium", "3", "S29", "", "2027-05-25", "2027-07-08", ""),
    seeded("PLT-032", "Publish production runbook", launch, "Platform", "Ben Ortiz", "To Do", "Medium", "3", "S29", "", "2027-05-26", "2027-07-12", ""),
    seeded("CHK-026", "Approve launch readiness", launch, "Checkout", "Nia Cole", "To Do", "High", "8", "S29", "CHK-017", "2027-05-27", "2027-07-16", ""),
    seeded("PAY-028", "Reconcile retry behavior", launch, "Payments", "Asha Iyer", "To Do", "Medium", "3", "S28", "PAY-021", "2027-05-24", "2027-06-26", ""),
    seeded("PAY-031", "Update transaction retry rules", "Payments Core", "Payments", "Jon Bell", "To Do", "High", "13", "S28", "", "2027-06-19", "2027-07-01", ""),
    seeded("CHK-037", "Add alternative wallet acceptance", launch, "Checkout", "Omar Reed", "To Do", "Medium", "5", "S30", "", "2027-06-03", "2027-07-24", "Product example included in the release review"),
    seeded("PAY-034", "Add dispute export fields", launch, "Payments", "Ari Mendez", "To Do", "Low", "3", "S30", "", "2027-06-04", "2027-07-25", "Export fields requested by operations"),
    seeded("RISK-023", "Add merchant fraud review", launch, "Risk", "Gia Stone", "To Do", "Medium", "2", "S30", "", "2027-06-05", "2027-07-26", "Review item from merchant feedback"),
    seeded("CHK-040", "Refresh checkout copy", "Checkout Experience", "Checkout", "Tessa Yu", "Blocked", "Low", "2", "S29", "CHK-041", "2027-06-10", "2027-07-05", ""),
    seeded("CHK-041", "Approve copy changes", "Checkout Experience", "Checkout", "Tessa Yu", "Done", "Low", "1", "S27", "", "2027-06-01", "2027-06-10", "Approved in the prior sprint"),
]
seeded_by_id = {row["id"]: row for row in seeded_rows}
rows = [seeded_by_id.get(row["id"], row) for row in rows]

# The single reopened item is deliberately represented in the export's history.
for row in rows:
    if row["id"] == "PAY-007":
        row["status"] = "In Progress"
        row["reopened"] = "true"
        row["status_history"] = "Created; Done; Reopened"
        row["comments"] = "Returned after a late test result"
        break

write_csv(FIXTURE / "tickets.csv", rows, FIELDS)

people_rows: list[dict[str, str]] = []
for team, people in TEAMS.items():
    for person in people:
        people_rows.append({"assignee": person, "team": team, "timezone": rng.choice(["UTC-5", "UTC", "UTC+1"])})
write_csv(FIXTURE / "people.csv", people_rows, ["assignee", "team", "timezone"])

capacity_rows: list[dict[str, str]] = []
for sprint in ["S27", "S28", "S29", "S30"]:
    for team, people in TEAMS.items():
        for person in people:
            capacity_rows.append({
                "sprint": sprint,
                "team": team,
                "assignee": person,
                "capacity_points": "1.0" if person == "Jon Bell" else "1.2",
                "workdays": "10",
                "notes": "standard allocation" if person != "Jon Bell" else "shared support rotation",
            })
write_csv(FIXTURE / "team-capacity.csv", capacity_rows,
          ["sprint", "team", "assignee", "capacity_points", "workdays", "notes"])

write_csv(FIXTURE / "holidays.csv", [
    {"date": "2027-06-23", "assignee": "Jon Bell", "reason": "local holiday"},
    {"date": "2027-06-30", "assignee": "Cora Lin", "reason": "local holiday"},
    {"date": "2027-07-08", "assignee": "Gia Stone", "reason": "local holiday"},
], ["date", "assignee", "reason"])

(FIXTURE / "README.md").write_text("""# Payments and checkout launch export

This folder is a working export for the week ending **2027-06-14**. `tickets.csv` is the main input. `roadmap.md` gives the launch scope, dates, sprint calendar and the planning velocity used by the team. `team-capacity.csv` is the two-week capacity sheet; its `capacity_points` values are normalized planning points available from one person during one two-week sprint. `holidays.csv` lists individual absences, `people.csv` is a directory snapshot, and `last-week-status.md` and `release-notes.md` are context from the previous update.

## Ticket columns

`id` is the stable ticket identifier; `title` is the work item name; `epic` is its product grouping; `team` and `assignee` identify ownership; `status` is the workflow state; `priority` is the recorded priority; `estimate_points` is the estimate and may be blank; `sprint` is the planned two-week sprint; `depends_on` is a semicolon-separated list of prerequisite IDs; `created` and `due` are ISO dates; `reopened` records whether an item returned after closure; `status_history` is a short export of state changes; and `comments` contains free-text notes.

## Other files and columns

`team-capacity.csv` has `sprint`, `team`, `assignee`, `capacity_points`, `workdays`, and free-text `notes`. `holidays.csv` has the absence `date`, `assignee`, and `reason`. `people.csv` has the directory `assignee`, `team`, and `timezone`. `export-metadata.txt` records export details. `last-week-status.md` and `release-notes.md` are context documents.

## Reporting conventions

- The four sprint names and their Monday-to-Sunday dates are in `roadmap.md`. The date at the top of this file is today for this update.
- An open ticket is one with status `To Do`, `In Progress`, or `Blocked`. `Done` and `Cancelled` are closed. Blank estimates are excluded from point totals.
- A listed holiday removes one tenth of that person's two-week capacity for the sprint containing the holiday. Capacity is summed by person after that adjustment. Duplicate-looking names are matched after trimming outer spaces.
""", encoding="utf-8")

(FIXTURE / "roadmap.md").write_text("""# Payments and checkout launch roadmap

as_of: 2027-06-14
launch_epic: Payments and Checkout Launch
scope_lock_date: 2027-05-28
planned_launch_date: 2027-06-25
velocity_points_per_sprint: 18

## Sprint calendar

| sprint | start | end |
|---|---|---|
| S27 | 2027-06-07 | 2027-06-20 |
| S28 | 2027-06-21 | 2027-07-04 |
| S29 | 2027-07-05 | 2027-07-18 |
| S30 | 2027-07-19 | 2027-08-01 |
""", encoding="utf-8")

(FIXTURE / "last-week-status.md").write_text("""# Week ending 2027-06-07

## Leadership note

Overall: green

The payments and checkout launch remains on track for 2027-06-25. The teams are finishing routine integration work and have no issue requiring leadership attention this week. The next update will include the refreshed ticket export.
""", encoding="utf-8")

(FIXTURE / "release-notes.md").write_text("""# Draft release notes

The release will include payment retries, checkout wallet handling, transaction-limit controls, and updated operational guidance. Support wording is still being reviewed. This document is a draft and does not define the launch date.
""", encoding="utf-8")

(FIXTURE / "export-metadata.txt").write_text("""Export name: launch-work-items
Generated by: planning export
Rows include archived and cancelled work.
Date format: ISO 8601 calendar date.
""", encoding="utf-8")

print(f"wrote {len(rows)} tickets and {len(capacity_rows)} capacity rows to {FIXTURE}")
