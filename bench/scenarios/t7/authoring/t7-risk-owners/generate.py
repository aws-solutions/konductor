#!/usr/bin/env python3
"""Create the invented mobile re-platform working folder for this task."""
from __future__ import annotations

import csv
import json
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
SEED = 7127


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def make_ticket(ticket_id: str, rng: random.Random, index: int) -> dict:
    components = ["Identity", "Profile", "Activity Feed", "Settings", "Telemetry", "Search"]
    verbs = ["Polish", "Add", "Tighten", "Refresh", "Handle", "Review", "Wire"]
    nouns = ["empty state", "loading copy", "retry behavior", "accessibility labels", "analytics event", "cache hint", "error message"]
    status = rng.choices(["Open", "In Progress", "Ready", "Review", "Blocked", "Done", "Closed", "Cancelled"],
                         weights=[28, 18, 10, 8, 5, 13, 12, 6])[0]
    assignees = ["Inez Park", "Jon Bell", "Kofi Mensah", "Mira Shah", "Tara Owens", "Yuki Mori", ""]
    created = date(2027, 5, 3) + timedelta(days=rng.randrange(0, 82))
    due = created + timedelta(days=rng.randrange(12, 65))
    return {
        "id": ticket_id,
        "title": f"{rng.choice(verbs)} {rng.choice(nouns)}",
        "status": status,
        "assignee": rng.choice(assignees),
        "team": rng.choice(["Mobile Experience", "Mobile Foundations", "Quality" ]),
        "component": rng.choice(components),
        "estimate_points": rng.choice([1, 2, 3, 5, 8, ""]),
        "depends_on": [],
        "due_date": due.isoformat(),
        "created_at": created.isoformat(),
        "comments": rng.choice([
            "Needs a quick device pass before close.",
            "Copy came from the latest design review.",
            "Waiting on a sample payload.",
            "No further notes.",
            "Please check the older handset too.",
            "Follow-up from the Tuesday sync.",
        ]),
    }


def plant_traps(tickets: list[dict]) -> None:
    by_id = {t["id"]: t for t in tickets}

    # The ordinary-looking Session Bridge tickets form the longest dependency chain.
    bridge = {
        "MOB-014": ("Add session bridge token handoff", "2027-07-02", 5, [], "Priya Nair", "Initial handoff path for the new shell."),
        "MOB-037": ("Wire session bridge refresh callback", "2027-07-16", 5, ["MOB-014"], "Priya Nair", "Uses the callback contract from the shell."),
        "MOB-063": ("Handle session bridge expiry response", "2027-07-30", 8, ["MOB-037"], "Priya Nair", "Keep the existing sign-in copy."),
        "MOB-089": ("Add session bridge retry state", "2027-08-13", 5, ["MOB-063"], "", "Keep the retry state aligned with the restore path."),
        "MOB-112": ("Connect session bridge to account restore", "2027-08-27", 8, ["MOB-089"], "Priya Nair", "The restore screen needs the new state."),
        "MOB-137": ("Verify session bridge on a clean install", "2027-09-03", 3, ["MOB-112"], "Priya Nair", "Include a sign-out and sign-in pass."),
        "MOB-158": ("Run session bridge launch verification", "2027-09-10", 3, ["MOB-137"], "Priya Nair", "Record the result for the release handoff."),
    }
    for ticket_id, (title, due, points, deps, assignee, comments) in bridge.items():
        t = by_id[ticket_id]
        t.update({
            "title": title,
            "status": "In Progress" if ticket_id in {"MOB-014", "MOB-037", "MOB-063"} else "Open",
            "assignee": assignee,
            "team": "Mobile Foundations",
            "component": "Session Bridge",
            "estimate_points": points,
            "depends_on": deps,
            "due_date": due,
            "comments": comments,
        })

    # The provider's v2 work has an ordinary ticket in the export.
    by_id["MOB-052"].update({
        "title": "Update relay client for v2 response envelope",
        "status": "In Progress",
        "assignee": "Diego Alvarez",
        "team": "Mobile Foundations",
        "component": "Relay Adapter",
        "estimate_points": 5,
        "depends_on": [],
        "due_date": "2027-08-13",
        "comments": "Keep the fallback parser while the new response is verified.",
    })
    by_id["MOB-076"].update({
        "title": "Add settings diagnostics entry point",
        "status": "Open",
        "assignee": "Mira Shah",
        "team": "Mobile Experience",
        "component": "Settings",
        "estimate_points": 3,
        "depends_on": [],
        "due_date": "2027-08-20",
        "comments": "Entry point is ready for copy review.",
    })
    # A frightening item is closed and later notes explain why it is not a live risk.
    by_id["MOB-144"].update({
        "title": "Resolve push entitlement on clean install",
        "status": "Closed",
        "assignee": "Kofi Mensah",
        "team": "Quality",
        "component": "Notifications",
        "estimate_points": 2,
        "depends_on": [],
        "due_date": "2027-07-23",
        "comments": "Validated in the release candidate; no follow-up needed.",
    })


def write_fixture() -> None:
    rng = random.Random(SEED)
    FIXTURE.mkdir(parents=True, exist_ok=True)
    tickets = [make_ticket(f"MOB-{i:03d}", rng, i) for i in range(1, 191)]
    plant_traps(tickets)
    (FIXTURE / "ticket-export.json").write_text(json.dumps({"exported_at": "2027-06-01", "tickets": tickets}, indent=2) + "\n", encoding="utf-8")

    write_text(FIXTURE / "README.md", """# Mobile re-platform working folder

As of date: **2027-06-01**. This is the date that counts as today for this folder. Dates are calendar dates in 2027.

Files:
- `roadmap.md`: launch milestones and release dates.
- `ticket-export.json`: the work-item export. Each ticket has `id`, `title`, `status`, `assignee`, `team`, `component`, `estimate_points`, `depends_on`, `due_date`, `created_at`, and `comments`.
- `capacity.csv`: sprint capacity and committed points by team.
- `vendor-contract.md`: the current provider agreement summary.
- `org-chart.md`: program roles and named owners.
- `meeting-notes/`: dated notes from program and delivery meetings.
- `release-checklist.md`: the ordinary launch handoff checklist.
- `design-decisions.md`: small product and platform decisions already recorded.

Ticket columns: `id` is the stable work-item identifier; `title` is its short summary; `status` is its workflow state; `assignee` is the named person doing the work; `team` is the delivery group; `component` is the product area; `estimate_points` is the relative size estimate; `depends_on` lists prerequisite ticket IDs; `due_date` is the recorded target date; `created_at` is the creation date; and `comments` holds the export's free-text note. Capacity columns: `sprint` is the cadence label; `start` and `end` bound the sprint; `team` is the group; `nominal_points` is the listed capacity before commitments; `committed_points` is the planned load; `public_holiday` is a listed non-working date; and `notes` is the sheet comment.

Ticket conventions: statuses `Open`, `In Progress`, `Ready`, `Review`, and `Blocked` are open work. `Done`, `Closed`, and `Cancelled` are not open work. A blank assignee means no owner is assigned, and a blank estimate has no point value. Dependency values are ticket IDs. Names match case-insensitively after trimming spaces.

Capacity conventions: sprint boundaries in `capacity.csv` are inclusive Monday-to-Friday work weeks. Listed public holidays are non-working days and contribute zero capacity. A ticket's due date is a calendar date; no work is assumed on a public holiday. The export includes closed and cancelled historical work as well as current work.
""")

    write_text(FIXTURE / "roadmap.md", """# Mobile re-platform roadmap

As of 2027-06-01, the target for the new mobile shell is a public launch on **2027-09-24**.

| Milestone | Date | Notes |
|---|---|---|
| Internal integration build | 2027-07-16 | First build with the account restore path |
| Provider compatibility check | 2027-08-13 | Confirm the relay response handling |
| Candidate build | 2027-08-27 | Candidate goes to device QA |
| Code freeze | 2027-09-06 | Only release-blocking fixes after this point |
| Store submission | 2027-09-17 | Submission window before public launch |
| Public launch | 2027-09-24 | Target date |

The delivery cadence uses the Monday-to-Friday sprints listed in the capacity sheet. The release lead owns the handoff checklist and the product lead owns launch scope decisions.
""")

    with (FIXTURE / "capacity.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["sprint", "start", "end", "team", "nominal_points", "committed_points", "public_holiday", "notes"])
        rows = [
            ("S1", "2027-06-07", "2027-06-18", "Mobile Foundations", 34, 27, "", "two-week build"),
            ("S2", "2027-06-21", "2027-07-02", "Mobile Foundations", 34, 29, "", "two-week build"),
            ("S3", "2027-07-05", "2027-07-16", "Mobile Foundations", 30, 26, "2027-07-05", "public holiday"),
            ("S4", "2027-07-19", "2027-07-30", "Mobile Foundations", 34, 28, "", "two-week build"),
            ("S5", "2027-08-02", "2027-08-13", "Mobile Foundations", 34, 30, "", "two-week build"),
            ("S6", "2027-08-16", "2027-08-27", "Mobile Foundations", 34, 31, "", "two-week build"),
            ("S7", "2027-08-30", "2027-09-10", "Mobile Foundations", 30, 27, "2027-09-06", "public holiday"),
            ("S8", "2027-09-13", "2027-09-24", "Mobile Foundations", 34, 20, "", "launch sprint"),
            ("S1", "2027-06-07", "2027-06-18", "Mobile Experience", 30, 24, "", "shared design work"),
            ("S2", "2027-06-21", "2027-07-02", "Mobile Experience", 30, 25, "", "shared design work"),
            ("S3", "2027-07-05", "2027-07-16", "Mobile Experience", 27, 22, "2027-07-05", "public holiday"),
            ("S4", "2027-07-19", "2027-07-30", "Mobile Experience", 30, 21, "", "shared design work"),
            ("S5", "2027-08-02", "2027-08-13", "Mobile Experience", 30, 23, "", "shared design work"),
            ("S6", "2027-08-16", "2027-08-27", "Mobile Experience", 30, 25, "", "shared design work"),
            ("S7", "2027-08-30", "2027-09-10", "Mobile Experience", 27, 20, "2027-09-06", "public holiday"),
            ("S8", "2027-09-13", "2027-09-24", "Mobile Experience", 30, 19, "", "launch sprint"),
        ]
        w.writerows(rows)

    write_text(FIXTURE / "vendor-contract.md", """# Provider contract summary

Agreement reviewed 2027-06-01. The relay provider will retire the **v1 response endpoint on 2027-08-20**. Existing clients may continue to make test calls until that date, but production traffic must use the v2 response envelope after retirement. The provider will keep the v2 sandbox available through the launch window.

The delivery contact for compatibility work is Diego Alvarez. Commercial questions go to Sana Patel. The contract does not change the public launch date in the roadmap.
""")

    write_text(FIXTURE / "org-chart.md", """# Program organization

| Person | Role | Area | Current responsibility |
|---|---|---|---|
| Mara Chen | Program Director | Mobile re-platform | Steering review and decisions |
| Owen Wright | Release Lead | Delivery | Release handoff and readiness |
| Priya Nair | Staff Engineer | Mobile Foundations | Session and account platform |
| Diego Alvarez | Integrations Lead | Mobile Foundations | Provider relay compatibility |
| Lena Brooks | Product Lead | Mobile Experience | Launch scope and acceptance |
| Sana Patel | Vendor Manager | Operations | Provider relationship and contract |
| Mira Shah | Design Lead | Mobile Experience | Settings and user-facing flows |
| Kofi Mensah | Quality Lead | Quality | Device and install verification |
| Inez Park | Engineer | Mobile Experience | Profile and activity work |
| Jon Bell | Engineer | Mobile Foundations | Identity and telemetry work |
""")

    write_text(FIXTURE / "release-checklist.md", """# Release handoff checklist

- Candidate build has a clean-install pass on supported devices.
- Store metadata and privacy text are reviewed before submission.
- Provider compatibility is checked against the sandbox response.
- Open launch-blocking work has a named owner.
- Product scope is signed off before the freeze date.
- Release lead records the final go/no-go decision.
""")
    write_text(FIXTURE / "design-decisions.md", """# Recorded design decisions

- 2027-05-18: The new shell keeps the existing account restore language.
- 2027-05-26: Settings diagnostics remains behind the existing support entry point.
- 2027-05-29: Device QA will cover one older Android and one older iOS device.
- 2027-05-31: The first launch candidate uses the current notification permission copy.
""")

    notes = {
        "2027-06-08.md": """# Delivery sync, 2027-06-08

Attendees: Owen Wright, Priya Nair, Lena Brooks.

The shell work is moving into the account restore path. Priya will keep the session handoff examples current while the first integration build comes together. The settings entry point remains a small follow-up for this cycle.
""",
        "2027-06-22.md": """# Integration sync, 2027-06-22

Attendees: Diego Alvarez, Jon Bell, Sana Patel.

The relay adapter can exercise the provider sandbox. The team will retain the old parser during the compatibility check and remove it only after the v2 response has been observed on a device build.
""",
        "2027-07-07.md": """# Product review, 2027-07-07

Attendees: Lena Brooks, Mira Shah, Owen Wright.

The launch build should keep the settings diagnostics entry point. Copy review is still open, but no new screen is planned in this meeting.
""",
        "2027-07-20.md": """# Steering preparation, 2027-07-20

Attendees: Mara Chen, Lena Brooks, Owen Wright.

For the public launch, a person must be able to export an encrypted diagnostic bundle from Settings so support can investigate failed account restores. The group agreed this is part of the customer experience, with Lena taking the product decision.
""",
        "2027-07-29.md": """# Quality sync, 2027-07-29

Attendees: Kofi Mensah, Priya Nair.

Clean-install coverage is the focus for the candidate. The session bridge checks should include sign-out, sign-in, and account restore. Device results will be attached to the release handoff.
""",
        "2027-08-04.md": """# Build triage, 2027-08-04

Attendees: Kofi Mensah, Owen Wright.

MOB-144 looked like a release blocker because a clean install did not receive the push entitlement. The candidate build was held for a device check.
""",
        "2027-08-11.md": """# Build triage follow-up, 2027-08-11

Attendees: Kofi Mensah, Owen Wright, Mara Chen.

The push entitlement was verified on a clean install and in the upgrade path. MOB-144 is closed and no further release action is needed for that item.
""",
    }
    for filename, text in notes.items():
        write_text(FIXTURE / "meeting-notes" / filename, text)


if __name__ == "__main__":
    write_fixture()
    print(f"wrote {len(list((FIXTURE / 'meeting-notes').glob('*.md')))} notes and 190 tickets")
