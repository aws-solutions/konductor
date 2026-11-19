#!/usr/bin/env python3
"""Create the ordinary, noisy migration-planning fixture."""
from __future__ import annotations

import csv
import json
import random
from datetime import date, timedelta
from pathlib import Path

SEED = 741203
ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
random.seed(SEED)
FIXTURE.mkdir(parents=True, exist_ok=True)


def write_csv(name: str, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    with (FIXTURE / name).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


sprints = [
    ("S1", "2027-01-04", "2027-01-15"),
    ("S2", "2027-01-18", "2027-01-29"),
    ("S3", "2027-02-01", "2027-02-12"),
    ("S4", "2027-02-15", "2027-02-26"),
    ("S5", "2027-03-01", "2027-03-12"),
    ("S6", "2027-03-15", "2027-03-26"),
    ("S7", "2027-03-29", "2027-04-09"),
    ("S8", "2027-04-12", "2027-04-23"),
    ("S9", "2027-04-26", "2027-05-07"),
]
write_csv(
    "sprints.csv",
    ["sprint", "start_date", "end_date", "working_days"],
    [{"sprint": n, "start_date": s, "end_date": e, "working_days": 10} for n, s, e in sprints],
)
write_csv(
    "release-calendar.csv",
    ["stage", "version", "date", "notes"],
    [
        {"stage": "target", "version": "8.0.0", "date": "2027-03-31", "notes": "requested migration date"},
        {"stage": "alpha", "version": "8.0.0-alpha1", "date": "2027-01-25", "notes": "internal integration build"},
        {"stage": "beta", "version": "8.0.0-beta1", "date": "2027-03-01", "notes": "feature-complete candidate"},
        {"stage": "release candidate", "version": "8.0.0-rc1", "date": "2027-04-19", "notes": "stabilization build"},
        {"stage": "feature freeze", "version": "8.0.0", "date": "2027-04-12", "notes": "new feature work stops"},
        {"stage": "final", "version": "8.0.0", "date": "2027-05-03", "notes": "public release"},
    ],
)

people = [
    ("Asha Nair", "Data Foundations", 10),
    ("Bruno Ives", "Data Foundations", 9),
    ("Celia Park", "Data Foundations", 11),
    ("Dae Okafor", "Runtime Migration", 10),
    ("Elin Voss", "Runtime Migration", 9),
    ("Farah Chen", "Runtime Migration", 11),
    ("Gio Santos", "Release Operations", 10),
    ("Hana Reed", "Release Operations", 9),
]
write_csv(
    "capacity.csv",
    ["sprint", "person", "team", "nominal_points", "working_days"],
    [
        {"sprint": sprint, "person": person, "team": team, "nominal_points": points, "working_days": 10}
        for sprint, _, _ in sprints
        for person, team, points in people
    ],
)
write_csv(
    "pto.csv",
    ["person", "start_date", "end_date", "note"],
    [
        {"person": "Dae Okafor", "start_date": "2027-03-29", "end_date": "2027-04-02", "note": "planned leave"},
        {"person": "Hana Reed", "start_date": "2027-04-12", "end_date": "2027-04-14", "note": "planned leave"},
    ],
)
write_csv(
    "holidays.csv",
    ["date", "name"],
    [
        {"date": "2027-01-01", "name": "New year holiday"},
        {"date": "2027-01-18", "name": "Civic day"},
        {"date": "2027-02-15", "name": "Founders day"},
        {"date": "2027-03-31", "name": "Spring observance"},
        {"date": "2027-04-02", "name": "Good Friday"},
        {"date": "2027-05-31", "name": "Memorial observance"},
    ],
)
write_csv(
    "team-calendar.csv",
    ["team", "ordinary_workdays", "handoff_acceptance_weekdays", "timezone"],
    [
        {"team": "Data Foundations", "ordinary_workdays": "Mon-Fri", "handoff_acceptance_weekdays": "Tue,Wed", "timezone": "UTC-5"},
        {"team": "Runtime Migration", "ordinary_workdays": "Mon-Fri", "handoff_acceptance_weekdays": "Tue,Wed", "timezone": "UTC-5"},
        {"team": "Release Operations", "ordinary_workdays": "Mon-Fri", "handoff_acceptance_weekdays": "Mon,Thu", "timezone": "UTC-5"},
        {"team": "Analytics", "ordinary_workdays": "Mon-Fri", "handoff_acceptance_weekdays": "Tue,Thu", "timezone": "UTC-5"},
    ],
)
write_csv(
    "status-codes.csv",
    ["status", "counts_as_open", "meaning"],
    [
        {"status": "Open", "counts_as_open": "yes", "meaning": "accepted work not started"},
        {"status": "In Progress", "counts_as_open": "yes", "meaning": "work underway"},
        {"status": "Blocked", "counts_as_open": "yes", "meaning": "work cannot proceed today"},
        {"status": "Ready", "counts_as_open": "yes", "meaning": "queued for an owner"},
        {"status": "Closed", "counts_as_open": "no", "meaning": "completed and accepted"},
        {"status": "Cancelled", "counts_as_open": "no", "meaning": "removed from scope"},
    ],
)

teams = ["Data Foundations", "Runtime Migration", "Release Operations", "Analytics"]
people_by_team = {
    "Data Foundations": ["Asha Nair", "Bruno Ives", "Celia Park"],
    "Runtime Migration": ["Dae Okafor", "Elin Voss", "Farah Chen"],
    "Release Operations": ["Gio Santos", "Hana Reed"],
    "Analytics": ["Mina Cole", "Noah Singh"],
}
verbs = ["Map", "Validate", "Partition", "Backfill", "Reconcile", "Instrument", "Review", "Tune", "Document", "Rotate"]
nouns = ["source rows", "tenant keys", "load window", "schema aliases", "retry policy", "audit stream", "cutover notes", "query sample", "archive path", "checkpoint"]
statuses = ["Open", "Open", "Open", "In Progress", "Ready", "Blocked", "Closed", "Cancelled"]
base_tickets: list[dict[str, object]] = []
for number in range(1, 151):
    team = random.choice(teams)
    owner = random.choice(people_by_team[team])
    created = date(2027, 1, 2) + timedelta(days=random.randint(0, 52))
    estimate = random.choice([1, 2, 3, 5, 8, 13])
    status = random.choice(statuses)
    if number % 19 == 0:
        comment = ""
    elif number % 23 == 0:
        comment = "check naming in source export"
    else:
        comment = random.choice([
            "sample rows attached",
            "waiting for the next import window",
            "reviewed with an operator",
            "",
        ])
    base_tickets.append(
        {
            "id": f"MIG-{number:03d}",
            "title": f"{random.choice(verbs)} {random.choice(nouns)}",
            "status": status,
            "team": team,
            "owner": owner,
            "estimate_points": estimate,
            "depends_on": [],
            "planned_sprint": random.choice([s[0] for s in sprints[:8]]),
            "due_date": "",
            "created_at": created.isoformat(),
            "updated_at": (created + timedelta(days=random.randint(0, 30))).isoformat(),
            "comment": comment,
        }
    )
# A few ordinary dependencies and spelling noise make the export less tidy without making a long chain.
for number in [17, 39, 64, 97, 118, 147]:
    ticket = base_tickets[number - 1]
    ticket["depends_on"] = [f"MIG-{number - 1:03d}"]
base_tickets[6]["status"] = "In progress"
base_tickets[54]["comment"] = "owner confirmed; no estimate in original intake"
(FIXTURE / "tickets.json").write_text(json.dumps(base_tickets, indent=2) + "\n", encoding="utf-8")

(FIXTURE / "README.md").write_text(
    "# Migration planning export\n\n"
    "As of **2027-02-12**. This is a working-folder export for the data-platform migration.\n\n"
    "## Files\n\n"
    "- `tickets.json`: the ticket export. Each object has an id, title, status, team, owner, point estimate, dependency ids, planned sprint, optional due date, timestamps, and a free-text comment.\n"
    "- `release-calendar.csv`: dated alpha, beta, release-candidate, feature-freeze, and final milestones.\n"
    "- `sprints.csv`: Monday-to-Friday two-week sprint windows and their ten ordinary working days.\n"
    "- `capacity.csv`: one row per person per sprint. `nominal_points` is that person's capacity for a full sprint before holidays or leave; `working_days` is the ordinary ten-day window.\n"
    "- `pto.csv`: inclusive planned leave dates.\n"
    "- `holidays.csv`: holidays that remove a working day for every listed contributor.\n"
    "- `team-calendar.csv`: ordinary workdays and the weekdays on which each team accepts a cross-team handoff.\n"
    "- `status-codes.csv`: the status vocabulary and whether each value counts as open work. The export contains a few capitalization and spelling inconsistencies.\n\n"
    "## Conventions\n\n"
    "Statuses marked `yes` in `status-codes.csv` are open; `Closed` and `Cancelled` are not. Blank point estimates are unknown rather than zero. A holiday or a day of inclusive PTO removes one point of capacity for that person for that day, and an overlap is counted once. Names match after trimming spaces and ignoring letter case.\n\n"
    "The sprint dates and weekday names in `sprints.csv` are authoritative. `planned_sprint` is the roadmap placement in the export, not a guarantee that work finishes there. Dependencies point from a ticket to work that must be accepted before it can start. `due_date`, when present, is the date requested by the consuming work. A team can do ordinary work on its listed workdays, but a cross-team handoff waits for an acceptance weekday in the receiving team's row.\n\n"
    "All dates use ISO format. The target under discussion is March 31, 2027; the release calendar is the source for the freeze and final dates.\n",
    encoding="utf-8",
)
