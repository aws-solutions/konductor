#!/usr/bin/env python3
"""Build the invented program-rollup fixture with deterministic noise."""
from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
RNG = random.Random(71027)

TEAM_INFO = {
    "ARC": (101, "Arc Services", "arc-export.csv"),
    "BEAM": (201, "Beam Data", "beam-export.csv"),
    "COVE": (301, "Cove Client", "cove-export.csv"),
}
STATUSES = ["Done", "Done", "Done", "Closed", "In Progress", "Ready", "New"]
WORDS = ["handoff", "ledger", "session", "mapping", "retry", "routing", "schema", "cache", "export", "guard"]


def ticket_rows(team: str, start: int) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for i in range(90):
        number = start + i
        ticket_id = f"{team}-{number}"
        # A few ordinary rows belong to a neighboring maintenance stream.
        initiative = "Relay" if i % 13 != 3 else "Harbor"
        if i % 17 in (0, 5):
            status = ["New", "Ready", "In Progress"][(i + len(team)) % 3]
        else:
            status = "Done"
        points = str([2, 3, 5, 8, 13][(i * 3 + len(team)) % 5])
        sprint_no = 7 + (i % 7)
        updated = date(2027, 7, 5) + timedelta(days=(i * 3 + len(team)) % 57)
        title = f"{RNG.choice(WORDS).title()} {RNG.choice(['polish', 'service', 'rules', 'review', 'adapter'])}"
        comments = RNG.choice([
            "Acceptance notes are in the linked design.",
            "Waiting for the usual test fixture refresh.",
            "Small follow-up from the weekly review.",
            "No customer-visible wording needed.",
            "One empty estimate was retained from the export.",
            "",
        ])
        rows.append({
            "ticket_id": ticket_id,
            "title": title,
            "initiative": initiative,
            "status": status,
            "points": points,
            "sprint": f"S-{sprint_no:02d}",
            "updated": updated.isoformat(),
            "links": "",
            "depends_on": "",
            "comments": comments,
            "owner": RNG.choice(["Mira", "Jon", "Priya", "Sol", "Tess"]),
        })
    return rows


def plant(rows_by_team: dict[str, list[dict[str, str]]]) -> None:
    def row(team: str, ticket_id: str) -> dict[str, str]:
        return next(x for x in rows_by_team[team] if x["ticket_id"] == ticket_id)

    # The planted rows remain ordinary-looking rows at ordinary sequence positions.
    a117 = row("ARC", "ARC-117")
    a117.update(title="Session handoff adapter", initiative="Relay", status="In Progress", points="8",
                sprint="S-09", comments="The receiving contract is still being exercised.", links="blocks BEAM-224")

    a143 = row("ARC", "ARC-143")
    a143.update(title="Schema mapping review", initiative="Relay", status="Ready", points="5",
                sprint="S-10", comments="Review sample is ready for the next pass.")

    # The completed S-09 rows in this export total 74, while the team paragraph says 24.
    a168 = row("ARC", "ARC-168")
    a168.update(title="Retry guard service", initiative="Relay", status="In Progress", points="5",
                sprint="S-10", comments="The last edge case is under test.")

    b224 = row("BEAM", "BEAM-224")
    b224.update(title="Ledger handoff consumer", initiative="Relay", status="Blocked", points="13",
                sprint="S-09", depends_on="ARC-117", comments="Waiting on the handoff contract.")

    b257 = row("BEAM", "BEAM-257")
    b257.update(title="Export retry rules", initiative="Relay", status="In Progress", points="8",
                sprint="S-10", comments="The normal retry cases are covered.")

    c331 = row("COVE", "COVE-331")
    c331.update(title="Client session bridge", initiative="Relay", status="Ready", points="8",
                sprint="S-10", comments="needs BEAM-224; sample payload is available.")

    c342 = row("COVE", "COVE-342")
    c342.update(title="Bridge acceptance checks", initiative="Relay", status="In Progress", points="8",
                sprint="S-11", comments="needs COVE-331; checking the mobile retry case.")

    # A visually severe but out-of-scope row is intentionally not on the Relay path.
    c354 = row("COVE", "COVE-354")
    c354.update(title="Cache rollback audit", initiative="Harbor", status="Blocked", points="13",
                sprint="S-09", comments="Waiting for a separate maintenance window.")

    # Make one duplicate appear in the second team's export with the same ordinary fields.
    duplicate = dict(a143)
    duplicate["owner"] = "Tess"
    rows_by_team["COVE"][42] = duplicate

    # Add a few realistic blanks and odd spellings without changing the planted facts.
    for team, idx in [("ARC", 6), ("BEAM", 12), ("COVE", 74)]:
        rows_by_team[team][idx]["points"] = ""
    rows_by_team["ARC"][28]["status"] = "In progress"
    rows_by_team["BEAM"][61]["status"] = "cancelled"
    rows_by_team["COVE"][11]["comments"] = "Imported from an older queue; owner field was blank."
    rows_by_team["COVE"][11]["owner"] = ""


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["ticket_id", "title", "initiative", "status", "points", "sprint", "updated", "links", "depends_on", "comments", "owner"]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_docs() -> None:
    (FIXTURE / "docs").mkdir(parents=True, exist_ok=True)
    (FIXTURE / "data").mkdir(parents=True, exist_ok=True)
    (FIXTURE / "README.md").write_text("""# Relay program working folder

This folder is a small working set for the Relay milestone. The usable reporting date is **2027-08-30**; dates before it are historical and dates after it are planning dates.

Files and columns:

- `roadmap.md` names the milestone, target date, scope tags, and scope-lock date.
- `data/arc-export.csv`, `data/beam-export.csv`, and `data/cove-export.csv` are raw team exports. Each row has `ticket_id`, `title`, `initiative`, `status`, `points`, `sprint`, `updated`, `links`, `depends_on`, `comments`, and `owner`. `points` is the team's estimate and may be blank. `links` and `depends_on` are not interchangeable export fields; free-text comments can also mention another ticket.
- `data/capacity.csv` gives each team's published available points by sprint. `working_days` excludes the listed holiday, and `available_points` already reflects that loss.
- `docs/program-conventions.md` records the reporting conventions. The three `docs/status-*.md` files are the teams' own one-paragraph updates.
- `docs/change-log.txt` is a small historical note included because exports often arrive with unrelated working material.

The three CSVs are separate team extracts, not a clean database. Preserve the ticket IDs as written when citing work.
""", encoding="utf-8")
    (FIXTURE / "roadmap.md").write_text("""# Relay milestone roadmap

## Relay handoff milestone

The executive target is **2027-10-15**. The scope lock was **2027-08-20**. Relay work is identified by `initiative=Relay`; Harbor work is a separate maintenance stream. The milestone needs the handoff service, ledger consumer, and client bridge to be usable together. The roadmap is a planning view, so the team exports remain the source for current status and estimates.

The reporting date falls during S-09, which ran 2027-08-23 through 2027-09-03; the most recent completed sprint was S-08, 2027-08-09 through 2027-08-20. The next published sprint after the reporting date is S-10, 2027-09-06 through 2027-09-17. S-11 runs 2027-09-20 through 2027-10-01, S-12 runs 2027-10-04 through 2027-10-15, S-13 runs 2027-10-18 through 2027-10-29, S-14 runs 2027-11-01 through 2027-11-12, and S-15 runs 2027-11-15 through 2027-11-26. Sprint weeks are Monday through Friday.

A small amount of Relay work was added after the 2027-08-20 lock in the normal course of triage. The exports, rather than this paragraph, show which rows exist and whether they remain open.
""", encoding="utf-8")
    (FIXTURE / "docs/program-conventions.md").write_text("""# Reporting conventions

The reporting date is 2027-08-30. Count `New`, `Ready`, `In Progress`, `Blocked`, and the spelling `In progress` as open. Count `Done` and `Closed` as complete; `Cancelled` and `cancelled` do not contribute to remaining work. A blank point estimate contributes zero points. A duplicate ticket ID in separate extracts is one work item: assign it to the first team in the README file order, ARC before BEAM before COVE, for the team rollup and count its points once for the program.

A reported color is the color in a team's own status paragraph. For the actual color, a team is red when it owns an open Relay row marked Blocked; it is amber when an open Relay row is part of a dependency chain that reaches a blocked or late Relay row owned by another team; otherwise it is green. The program is red if any team is red, amber if no team is red but at least one is amber, and green otherwise.

For forecast consistency, use the published capacity rows in `data/capacity.csv`. `working_days` excludes the listed holiday and `available_points` is the adjusted point allowance; do not subtract the holiday twice. The milestone is at risk when the forecast is after the roadmap target.

Dependencies may be represented by an ARC `links` value such as `blocks X-123`, a BEAM `depends_on` value, or a sentence in comments using `needs X-123`. Treat a dependency as upstream-to-downstream. Do not infer a dependency from an ordinary word that merely resembles a ticket ID.
""", encoding="utf-8")
    (FIXTURE / "docs/status-arc.md").write_text("""# Arc Services update

Arc Services reports **green** for Relay as of 2027-08-30. The team says its last sprint velocity was **24 points**, with the handoff adapter moving through review and no escalation requested. It expects the remaining work to fit inside the published plan.
""", encoding="utf-8")
    (FIXTURE / "docs/status-beam.md").write_text("""# Beam Data update

Beam Data reports **green** for Relay as of 2027-08-30. The team says the ledger work is tracking to the next integration window, with routine test cleanup still open. No schedule change was included in its update.
""", encoding="utf-8")
    (FIXTURE / "docs/status-cove.md").write_text("""# Cove Client update

Cove Client reports **green** for Relay as of 2027-08-30. The client bridge is described as ready for normal acceptance work, and the team expects to stay within its current sprint sequence. No exception was called out.
""", encoding="utf-8")
    (FIXTURE / "docs/change-log.txt").write_text("2027-08-12  Re-exported the three queues after owner names were normalized.\n2027-08-26  Removed one cancelled maintenance row from a local view; raw extracts retain history.\n", encoding="utf-8")

    cap_rows = []
    sprint_data = [
        ("S-10", "2027-09-06", "2027-09-17", "2027-09-06", 14),
        ("S-11", "2027-09-20", "2027-10-01", "", 15),
        ("S-12", "2027-10-04", "2027-10-15", "", 14),
        ("S-13", "2027-10-18", "2027-10-29", "", 15),
        ("S-14", "2027-11-01", "2027-11-12", "", 14),
        ("S-15", "2027-11-15", "2027-11-26", "", 15),
    ]
    for team, multiplier in [("ARC", 1), ("BEAM", 1), ("COVE", 1)]:
        for sprint, start, end, holiday, points in sprint_data:
            cap_rows.append({"team": team, "sprint": sprint, "start": start, "end": end, "working_days": "9" if holiday else "10", "holiday": holiday, "available_points": str(points * multiplier)})
    with (FIXTURE / "data/capacity.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["team", "sprint", "start", "end", "working_days", "holiday", "available_points"])
        writer.writeheader()
        writer.writerows(cap_rows)


def main() -> None:
    FIXTURE.mkdir(exist_ok=True)
    rows = {team: ticket_rows(team, start) for team, (start, _, _) in TEAM_INFO.items()}
    plant(rows)
    for team, (_, _, filename) in TEAM_INFO.items():
        write_csv(FIXTURE / "data" / filename, rows[team])
    write_docs()


if __name__ == "__main__":
    main()
