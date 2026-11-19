#!/usr/bin/env python3
"""Create the invented planning fixture for t7-dep-conflicts."""
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
    "Atlas": ("ATL", date(2027, 6, 15), date(2027, 8, 15)),
    "Beacon": ("BCN", date(2027, 7, 1), date(2027, 8, 30)),
    "Cinder": ("CND", date(2027, 7, 10), date(2027, 9, 5)),
    "Delta": ("DLT", date(2027, 8, 1), date(2027, 9, 25)),
}

SPECIAL = {
    "ATL-007": {"status": "Open", "due_date": "2027-07-20", "points": 3},
    "BCN-012": {"status": "In progress", "due_date": "2027-07-25", "points": 5},
    "CND-009": {"status": "Review", "due_date": "2027-08-05", "points": 8},
    "BCN-024": {"status": "Open", "due_date": "2027-08-05", "points": 5},
    "CND-017": {"status": "Open", "due_date": "2027-08-18", "points": 1},
    "DLT-011": {"status": "Blocked", "due_date": "2027-08-22", "points": 3},
    "DLT-025": {"status": "In progress", "due_date": "2027-08-28", "points": 3},
    "CND-030": {"status": "Open", "due_date": "2027-09-01", "points": 2},
    "DLT-039": {"status": "Review", "due_date": "2027-09-05", "points": 2},
    "DLT-041": {"status": "Open", "due_date": "2027-09-10", "points": 2},
    "DLT-043": {"status": "In progress", "due_date": "2027-09-18", "points": 2},
    "DLT-045": {"status": "Open", "due_date": "2027-09-25", "points": 5},
    "CND-004": {"status": "In progress", "due_date": "2027-08-10", "points": 5},
    "DLT-004": {"status": "Open", "due_date": "2027-08-18", "points": 3},
    "CND-028": {"status": "Open", "due_date": "2027-08-15", "points": 3},
    "BCN-020": {"status": "Open", "due_date": "2027-08-12", "points": 3},
    "CND-020": {"status": "Open", "due_date": "2027-08-14", "points": 3},
    "ATL-018": {"status": "Cancelled", "due_date": "2027-07-10", "points": 5,
                 "comment": "Duplicate request; replaced by ATL-019."},
    "ATL-019": {"status": "In progress", "due_date": "2027-07-08", "points": 5,
                 "comment": "Carry-over from the previous request."},
}


def iso(d: date) -> str:
    return d.isoformat()


def make_dirs() -> None:
    (FIXTURE / "data").mkdir(parents=True, exist_ok=True)
    for p in FIXTURE.rglob("*"):
        if p.is_file():
            p.unlink()


def make_tickets() -> dict[str, dict[str, object]]:
    tickets: dict[str, dict[str, object]] = {}
    verbs = ["Update", "Add", "Review", "Refine", "Publish", "Validate", "Align", "Document"]
    nouns = ["service handoff", "schema mapping", "release note", "access check", "event copy",
             "test fixture", "migration guide", "queue rule", "dashboard panel", "client sample"]
    status_values = ["Open", "In progress", "Review", "Done", "Closed", "Cancelled", "Blocked"]
    for team, (prefix, start, end) in TEAMS.items():
        span = (end - start).days
        for n in range(1, 46):
            tid = f"{prefix}-{n:03d}"
            due = start + timedelta(days=rng.randrange(span + 1))
            status = rng.choices(status_values, weights=[24, 18, 12, 20, 14, 3, 9])[0]
            points = rng.choice([1, 2, 3, 3, 5, 8])
            comment_choices = ["", "", "Waiting on a small wording pass.", "Reviewed in the weekly sync.",
                               "Estimate is unchanged.", ""]
            tickets[tid] = {
                "id": tid,
                "team": team,
                "title": f"{rng.choice(verbs)} {rng.choice(nouns)}",
                "status": status,
                "due_date": iso(due),
                "points": points,
                "updated": iso(date(2027, 5, 3) + timedelta(days=rng.randrange(145))),
                "comment": rng.choice(comment_choices),
            }
    for tid, patch in SPECIAL.items():
        tickets[tid].update(patch)
        tickets[tid].setdefault("comment", "")
    return tickets


def write_tickets(tickets: dict[str, dict[str, object]]) -> None:
    rows = list(tickets.values())
    rng.shuffle(rows)
    with (FIXTURE / "data" / "ticket-export.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "team", "title", "status", "due_date", "points", "updated", "comment"])
        writer.writeheader()
        writer.writerows(rows)


def make_dependencies(tickets: dict[str, dict[str, object]]) -> list[tuple[str, str, str]]:
    edges: list[tuple[str, str, str]] = [
        # Three late rows, with the first two also visible in surrounding roadmap work.
        ("ATL-007", "BCN-012", "2027-07-15"),
        ("CND-009", "BCN-024", "2027-07-30"),
        ("CND-017", "DLT-011", "2027-08-10"),
        # The three paths converge on the launch ticket. The CND-017 path is longest.
        ("BCN-012", "CND-004", "2027-08-01"),
        ("CND-004", "DLT-004", "2027-08-20"),
        ("DLT-004", "DLT-045", "2027-09-20"),
        ("BCN-024", "CND-028", "2027-08-20"),
        ("CND-028", "DLT-045", "2027-09-20"),
        ("DLT-011", "DLT-025", "2027-08-25"),
        ("DLT-025", "CND-030", "2027-08-30"),
        ("CND-030", "DLT-039", "2027-09-04"),
        ("DLT-039", "DLT-041", "2027-09-08"),
        ("DLT-041", "DLT-043", "2027-09-15"),
        ("DLT-043", "DLT-045", "2027-09-20"),
        # One genuine two-team cycle.
        ("BCN-020", "CND-020", "2027-08-20"),
        ("CND-020", "BCN-020", "2027-08-22"),
        # A cancelled producer remains in an export row; its replacement is on time.
        ("ATL-018", "BCN-030", "2027-07-12"),
    ]
    reserved = {a for e in edges for a in e[:2]}
    # Add ordinary, acyclic same-team links. Their needed-by dates are safely after the producer due date.
    for team, (prefix, _, _) in TEAMS.items():
        ids = [f"{prefix}-{n:03d}" for n in range(1, 46)
               if f"{prefix}-{n:03d}" not in reserved and f"{prefix}-{n:03d}" != "ATL-018"]
        for producer, consumer in zip(ids, ids[1:]):
            if len(edges) >= 71:
                break
            producer_due = date.fromisoformat(str(tickets[producer]["due_date"]))
            edges.append((producer, consumer, iso(producer_due + timedelta(days=4))))
        if len(edges) >= 71:
            break
    # One additional ordinary link makes the register 72 rows and has no special status.
    if len(edges) < 72:
        edges.append(("ATL-001", "ATL-003", "2027-07-01"))
    assert len(edges) == 72, len(edges)
    rng.shuffle(edges)
    return edges


def write_dependencies(edges: list[tuple[str, str, str]]) -> None:
    with (FIXTURE / "data" / "dependency-register.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["producer_ticket", "consumer_ticket", "needed_by"])
        writer.writerows(edges)


def write_docs() -> None:
    (FIXTURE / "README.md").write_text("""# 2027 planning review inputs

As of **2027-06-30**. Dates in the files are calendar dates in 2027.

Files in this folder:

- `roadmap.md`: quarterly milestones for Atlas, Beacon, Cinder and Delta. Its table columns are `quarter`, `team`, `milestone`, `status`, `target_date`, and `tickets`; the ticket column lists the work represented by each milestone.
- `data/ticket-export.csv`: the ticket export. Columns are `id` (ticket key), `team`, `title`, `status`, `due_date` (the current promised completion date), `points` (the estimate), `updated` (last edit date), and `comment`.
- `data/dependency-register.csv`: hand-maintained dependency rows. Its columns are `producer_ticket`, `consumer_ticket`, and `needed_by`; the producer must provide something to the consumer by that date.
- `data/capacity.csv`: sprint capacity snapshot. Its columns are `sprint`, `start_date`, `end_date`, and one points-capacity column for each team.
- `data/holiday-calendar.csv`: company closure dates. Its columns are `date` and `reason`; a closure is a non-working day for capacity planning.
- `data/release-notes.md`: ordinary notes from the last release review; it has no tabular columns.
- `data/closed-ticket-sample.csv`: a small archived export sample. Its columns are `id`, `team`, `status`, and `closed_date`.

Status spelling is not fully consistent in exports. Treat `Open`, `In progress`, `Review`, and `Blocked` as still open work after trimming whitespace and ignoring case. Treat `Done`, `Closed`, and `Cancelled` as not open. A blank estimate is unknown rather than zero. Ticket IDs are the stable join key; team and title text are not unique. Dependency needed-by dates and ticket due dates are inclusive calendar dates, and `days_late` means the calendar-day difference between the producer due date and needed-by date, with same-day equal to zero. No work is assumed on a closure date. The roadmap target date is the planned date for its milestone, not proof that all linked tickets are complete. If a dependency misses its needed-by date, its calendar-day miss carries to linked launch work; no recovery or parallelism is recorded in these inputs.
""", encoding="utf-8")
    (FIXTURE / "roadmap.md").write_text("""# 2027 roadmap

Planning snapshot: 2027-06-30

| quarter | team | milestone | status | target_date | tickets |
| --- | --- | --- | --- | --- | --- |
| Q2 | Atlas | Atlas foundation | Closed | 2027-06-25 | ATL-001, ATL-002 |
| Q2 | Beacon | Beacon foundation | Closed | 2027-06-25 | BCN-001, BCN-002 |
| Q2 | Cinder | Cinder foundation | Closed | 2027-06-25 | CND-001, CND-002 |
| Q2 | Delta | Delta foundation | Closed | 2027-06-25 | DLT-001, DLT-002 |
| Q3 | Atlas | Atlas ingestion contract | Done | 2027-07-15 | ATL-007, ATL-008 |
| Q3 | Atlas | Atlas reporting polish | Planned | 2027-08-05 | ATL-025, ATL-026 |
| Q3 | Beacon | Beacon account handoff | In progress | 2027-08-15 | BCN-012, BCN-024 |
| Q3 | Beacon | Beacon cleanup | Planned | 2027-08-30 | BCN-030, BCN-031 |
| Q3 | Cinder | Cinder event package | In progress | 2027-08-25 | CND-009, CND-017 |
| Q3 | Cinder | Cinder launch handoff | Planned | 2027-09-04 | CND-030, CND-039 |
| Q3 | Delta | Delta release assembly | In progress | 2027-09-20 | DLT-039, DLT-043 |
| Q3 | Delta | Q3 customer launch | Planned | 2027-09-30 | DLT-045 |
""", encoding="utf-8")
    (FIXTURE / "data" / "capacity.csv").write_text("""sprint,start_date,end_date,Atlas,Beacon,Cinder,Delta
S14,2027-07-05,2027-07-16,18,20,16,14
S15,2027-07-19,2027-07-30,20,18,18,16
S16,2027-08-02,2027-08-13,16,22,20,18
S17,2027-08-16,2027-08-27,22,20,18,20
S18,2027-08-30,2027-09-10,18,18,22,22
S19,2027-09-13,2027-09-24,20,16,20,24
S20,2027-09-27,2027-10-08,18,18,18,20
""", encoding="utf-8")
    (FIXTURE / "data" / "holiday-calendar.csv").write_text("""date,reason
2027-07-05,midyear closure
2027-08-16,regional closure
2027-09-06,early autumn closure
""", encoding="utf-8")
    (FIXTURE / "data" / "release-notes.md").write_text("""# Previous review notes

The June package shipped with the normal set of follow-up tickets. Owners use the ticket export for current due dates, while the roadmap records the intended milestone dates. A few archived tickets can remain in exports after a replacement is created.

The next review covers the Q3 customer launch and the handoffs needed to assemble it.
""", encoding="utf-8")
    (FIXTURE / "data" / "closed-ticket-sample.csv").write_text("""id,team,status,closed_date
ATL-000,Atlas,Closed,2027-05-28
BCN-000,Beacon,Closed,2027-05-29
CND-000,Cinder,Closed,2027-05-30
DLT-000,Delta,Closed,2027-06-01
""", encoding="utf-8")


def main() -> None:
    make_dirs()
    tickets = make_tickets()
    write_tickets(tickets)
    write_dependencies(make_dependencies(tickets))
    write_docs()
    print(f"wrote fixture with {len(tickets)} tickets and 72 dependencies")


if __name__ == "__main__":
    main()
