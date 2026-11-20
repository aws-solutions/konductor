#!/usr/bin/env python3
"""Build the synthetic planning inputs for t7-scope-cut."""
from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
SEED = 271828


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def build_bulk_tickets() -> list[dict[str, str]]:
    rng = random.Random(SEED)
    epics = ["Access", "Billing", "Collaboration", "Compliance", "Data", "Messaging", "Onboarding", "Platform"]
    title_parts = [
        "Improve", "Update", "Adjust", "Support", "Handle", "Refresh", "Clarify", "Tune",
        "Add", "Polish", "Review", "Simplify", "Track", "Validate", "Expose",
    ]
    subjects = [
        "workspace search", "import summary", "role picker", "quota panel", "audit view",
        "notification copy", "settings drawer", "retry handling", "empty state", "export history",
        "member table", "webhook status", "date selector", "error details", "activity feed",
    ]
    labels = ["ui", "api", "platform", "docs", "security", "data", "ops", "quality", ""]
    owners = ["Mira", "Jon", "Talia", "Ravi", "Nora", "Eli"]
    statuses = ["Open", "In Progress", "Review", "Closed", "Cancelled"]
    rows: list[dict[str, str]] = []
    lock = date(2027, 5, 7)
    for number in range(1001, 1169):
        # Most ordinary records predate lock; late ordinary records are historical noise.
        if rng.random() < 0.83:
            created = date(2027, 4, 1) + timedelta(days=rng.randrange((lock - date(2027, 4, 1)).days))
            status = rng.choices(statuses[:3], weights=[5, 3, 1])[0]
        else:
            created = date(2027, 5, 8) + timedelta(days=rng.randrange(27))
            status = rng.choice(["Closed", "Cancelled"])
        points = "" if rng.random() < 0.07 else str(rng.randint(1, 8))
        label = rng.choice(labels)
        if rng.random() < 0.12 and label:
            label = label + "," + rng.choice(["small", "cleanup", "q2"])
        comment = rng.choice([
            "Follow up with design.", "Acceptance notes are in the ticket.", "No external dependency.",
            "Check the old behavior before merging.", "Small wording pass remains.", "",
        ])
        rows.append({
            "ticket_id": f"PRJ-{number}",
            "title": f"{rng.choice(title_parts)} {rng.choice(subjects)}",
            "epic": rng.choice(epics),
            "status": status,
            "created": created.isoformat(),
            "points": points,
            "labels": label,
            "parent_id": "",
            "depends_on": "",
            "comments": comment,
            "owner": rng.choice(owners),
        })
    # Preserve one ordinary intake typo, as a real export may do.
    rows[136]["title"] = "Review notfication copy"
    return rows


def plant_traps(rows: list[dict[str, str]]) -> None:
    by_id = {r["ticket_id"]: r for r in rows}

    def set_ticket(ticket_id: str, **values: str) -> None:
        by_id[ticket_id].update(values)

    # Two ordinary pre-lock parents carry an estimate reduction that offsets a later bug split.
    set_ticket(
        "PRJ-1004", points="5", comments="Estimate adjusted from 8 to 5 after splitting 3 points to PRJ-1019.",
        created="2027-04-08", status="In Progress", epic="Data",
    )
    set_ticket(
        "PRJ-1022", points="3", comments="Estimate adjusted from 5 to 3 after splitting 2 points to PRJ-1073.",
        created="2027-04-19", status="Open", epic="Platform",
    )

    set_ticket(
        "PRJ-1008", title="Enable account export permission", epic="Access", status="In Progress",
        created="2027-05-10", points="3", labels="security,customer", parent_id="", depends_on="",
        comments="Requested for an account with an existing export workflow.", owner="Mira",
    )
    set_ticket(
        "PRJ-1019", title="Handle retry state after import split", epic="Data", status="In Progress",
        created="2027-05-13", points="3", labels="bugfix", parent_id="PRJ-1004", depends_on="",
        comments="Split follow-up for the import retry issue.", owner="Ravi",
    )
    set_ticket(
        "PRJ-1031", title="Add audit event filters", epic="Compliance", status="Open",
        created="2027-05-12", points="5", labels="observability", parent_id="", depends_on="",
        comments="The audit view needs filters for the requested review workflow.", owner="Nora",
    )
    set_ticket(
        "PRJ-1046", title="Polish permission summary panel", epic="Access", status="Open",
        created="2027-04-22", points="7", labels="stretch,ui", parent_id="", depends_on="",
        comments="A small presentation pass for the permission summary.", owner="Mira",
    )
    set_ticket(
        "PRJ-1064", title="Validate bulk member invitations", epic="Onboarding", status="In Progress",
        created="2027-05-14", points="8", labels="admin,scope-added", parent_id="", depends_on="",
        comments="Reject duplicate and expired invitations before sending.", owner="Talia",
    )
    set_ticket(
        "PRJ-1073", title="Separate webhook retry bug follow-up", epic="Platform", status="Open",
        created="2027-05-22", points="2", labels="bugfix", parent_id="PRJ-1022", depends_on="",
        comments="Split follow-up for the webhook retry issue.", owner="Eli",
    )
    set_ticket(
        "PRJ-1097", title="Send mobile approval notice", epic="Messaging", status="Open",
        created="2027-05-20", points="5", labels="messaging,scope-added", parent_id="", depends_on="",
        comments="Use the existing approval notification template.", owner="Jon",
    )
    set_ticket(
        "PRJ-1102", title="Retain approval audit trail", epic="Compliance", status="Open",
        created="2027-04-26", points="4", labels="must-have,api", parent_id="", depends_on="PRJ-1046",
        comments="The release audit record needs the permission summary data.", owner="Nora",
    )
    set_ticket(
        "PRJ-1114", title="Refresh legacy import help text", epic="Data", status="Open",
        created="2027-04-30", points="5", labels="stretch,docs", parent_id="", depends_on="",
        comments="Update examples in the legacy import help panel.", owner="Ravi",
    )
    set_ticket(
        "PRJ-1128", title="Configure regional retention settings", epic="Compliance", status="In Progress",
        created="2027-05-27", points="5", labels="compliance", parent_id="", depends_on="",
        comments="Requested for regional retention configuration.", owner="Nora",
    )
    set_ticket(
        "PRJ-1156", title="Show usage threshold alert", epic="Billing", status="Open",
        created="2027-06-02", points="3", labels="billing,scope-added", parent_id="", depends_on="",
        comments="Add a warning before a workspace reaches its usage threshold.", owner="Jon",
    )
    set_ticket(
        "PRJ-1162", title="Clean up old provisioning notes", epic="Platform", status="Open",
        created="2027-05-04", points="7", labels="stretch,cleanup", parent_id="", depends_on="",
        comments="Remove stale provisioning examples from the operator notes.", owner="Eli",
    )


def write_tickets(rows: list[dict[str, str]]) -> None:
    path = FIXTURE / "tickets.csv"
    fields = ["ticket_id", "title", "epic", "status", "created", "points", "labels", "parent_id", "depends_on", "comments", "owner"]
    rows.sort(key=lambda r: int(r["ticket_id"].split("-")[1]))
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_fixture_docs() -> None:
    write_text(FIXTURE / "README.md", """# Workspace planning inputs

As of date: **2027-06-04**. Dates in these files use the Gregorian calendar and `YYYY-MM-DD` format. The planning horizon ends at the launch date in `roadmap.md`.

Files in this folder:

- `tickets.csv`: exported work items. Columns are ticket id, title, epic, status, created date, current remaining estimate in points, free-text labels, parent ticket, ticket dependencies, comments, and owner.
- `roadmap.md`: release milestones and the current scope notes.
- `capacity.csv`: point capacity, organization-holiday loss, and already committed points for each remaining sprint.
- `sprint-calendar.csv`: sprint boundaries and working-day notes.
- `product-requests.md`: three dated product requests and their supporting context.
- `status-guide.md`: meanings used by the ticket export.
- `team-roster.csv`: team names and working areas for interpreting owners.
- `release-readout.md`: a short, non-authoritative status snapshot included with the export.

Ticket conventions: `Open`, `In Progress`, and `Review` are active statuses; `Closed` and `Cancelled` are not active work. A blank points cell means zero remaining points for aggregate planning. Labels are free text and may be blank. `created` is the calendar date on which the ticket entered the export's system. A dependency in `depends_on` names work that must be available first. For a split bug, the parent comment records the earlier estimate and the points moved into the split; the parent row shows its current reduced estimate.

Capacity conventions: `capacity_points` is the sprint's point capacity before the listed organization holiday loss. `holiday_points_lost` is already expressed in points, and `committed_points` is the launch work committed at the 2027-05-07 scope lock; it does not include work added after the lock. All three sprints are still ahead of the as-of date. Only the listed holiday loss is deducted from capacity; there is no separate weekend deduction in these rows. The sprint calendar defines the weekday boundaries used by the sheet.
""")
    write_text(FIXTURE / "roadmap.md", """# North-window release roadmap

## Milestones

- Scope lock: **2027-05-07**
- Launch date: **2027-07-16**

The launch date is a fixed customer-facing date for this planning exercise. The release horizon uses the three sprints in `sprint-calendar.csv`. Work already closed or cancelled is historical record rather than remaining launch work.

The ticket export is the working inventory for estimates. A `stretch` label identifies work that may be deferred when the release is full. The labels are maintained by several people and are not a complete record of why a ticket exists.

The capacity sheet records the team's remaining point capacity and its current commitments. Product requests are recorded separately because they were submitted through the product review notes rather than this roadmap page.
""")
    write_text(FIXTURE / "capacity.csv", """sprint,start,end,capacity_points,holiday_points_lost,committed_points,notes
S12,2027-06-07,2027-06-18,44,0,37,regular two-week sprint
S13,2027-06-21,2027-07-02,48,4,41,one organization holiday
S14,2027-07-05,2027-07-16,45,2,36,one organization holiday
""")
    write_text(FIXTURE / "sprint-calendar.csv", """sprint,start_weekday,start,end,end_weekday,working_day_note
S12,Monday,2027-06-07,2027-06-18,Friday,ten weekdays before local holiday adjustments
S13,Monday,2027-06-21,2027-07-02,Friday,ten weekdays with one organization holiday
S14,Monday,2027-07-05,2027-07-16,Friday,ten weekdays with one organization holiday
""")
    write_text(FIXTURE / "product-requests.md", """# Product requests recorded after the scope review

Requests below were entered after the roadmap review. The ticket references are included for traceability; the ticket export remains the source for titles, status, dates, and estimates.

## Request A — 2027-05-09 — customer export permission

Customer commitment: **PRJ-1008** must be available for an account with an existing export workflow. The request is limited to the permission gate described in the ticket.

## Request B — 2027-05-11 — administration and approvals

Please cover the audit filters in **PRJ-1031**, duplicate and expired invitation checks in **PRJ-1064**, and the mobile approval notice in **PRJ-1097**. These are one product request across three existing epics.

## Request C — 2027-05-26 — regional usage controls

Please include regional retention configuration in **PRJ-1128** and the usage threshold warning in **PRJ-1156**. The request is intended for the current release review.
""")
    write_text(FIXTURE / "status-guide.md", """# Ticket status guide

`Open` means accepted work not yet started. `In Progress` means implementation has started. `Review` means implementation is waiting for review or verification. `Closed` means the work is complete. `Cancelled` means the work was withdrawn. Status is a workflow field, not a priority ranking.
""")
    write_text(FIXTURE / "team-roster.csv", """owner,area,backup
Mira,access and identity,Jon
Jon,billing and messaging,Mira
Talia,onboarding and collaboration,Eli
Ravi,data and imports,Talia
Nora,compliance and audit,Ravi
Eli,platform and operations,Nora
""")
    write_text(FIXTURE / "release-readout.md", """# Release readout

Prepared 2027-06-04 for the weekly review.

The export contains a mixture of active, completed, and withdrawn records. Estimates are the current values in the export and may differ from an earlier planning snapshot. Owners are listed for routing questions; this note does not override the roadmap, capacity sheet, or product request notes.
""")


def main() -> None:
    FIXTURE.mkdir(parents=True, exist_ok=True)
    rows = build_bulk_tickets()
    plant_traps(rows)
    write_tickets(rows)
    write_fixture_docs()


if __name__ == "__main__":
    main()
