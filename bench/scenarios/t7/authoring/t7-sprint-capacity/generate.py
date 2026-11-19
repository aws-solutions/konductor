#!/usr/bin/env python3
"""Create the invented planning fixture with a repeatable bulk export and planted rows."""
from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
SEED = 71207


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def bulk_backlog(rng: random.Random) -> list[dict[str, str]]:
    verbs = ["Refresh", "Tune", "Add", "Review", "Improve", "Document", "Handle", "Update"]
    nouns = ["settings panel", "event filter", "cache hint", "search result", "export view", "retry path", "sample data", "status badge"]
    skills = ["frontend", "backend", "data", "platform", "qa", "security", "payments"]
    priorities = ["Should", "Could", "Should", "Could"]
    statuses = ["Open", "Ready", "In Progress", "Blocked", "Done", "Closed", "Cancelled", "Canceled"]
    rows: list[dict[str, str]] = []
    for number in range(1, 131):
        estimate = str(rng.choice([2, 3, 3, 5, 8, 13]))
        status = rng.choices(statuses, weights=[35, 16, 14, 8, 8, 7, 4, 3])[0]
        priority = rng.choices(priorities, weights=[35, 35, 25, 8])[0]
        comment = rng.choice([
            "Confirm copy with the working group.",
            "Small follow-up from the last review.",
            "Use the existing pattern where possible.",
            "Example payload is in the attached notes.",
            "",
        ])
        rows.append({
            "ticket_id": f"T-{number:03d}",
            "title": f"{rng.choice(verbs)} {rng.choice(nouns)}",
            "priority": priority,
            "estimate_points": estimate,
            "depends_on": "",
            "skill": rng.choice(skills),
            "status": status,
            "comment": comment,
        })
    return rows


def plant(rows: list[dict[str, str]]) -> None:
    """Replace ordinary-looking rows at scattered sequence positions after bulk generation."""
    planted = {
        "T-011": {"title": "Add account entry screen", "priority": "Must", "estimate_points": "5", "depends_on": "", "skill": "frontend", "status": "Ready", "comment": "Keep the first-run copy concise."},
        "T-018": {"title": "Refresh empty-state illustration", "priority": "Could", "estimate_points": "3", "depends_on": "", "skill": "frontend", "status": "Open", "comment": "Use the current neutral palette."},
        "T-023": {"title": "Add request throttling", "priority": "Must", "estimate_points": "8", "depends_on": "", "skill": "backend", "status": "In Progress", "comment": "Record the response header in the API notes."},
        "T-037": {"title": "Add beta test fixtures", "priority": "Should", "estimate_points": "3", "depends_on": "", "skill": "qa", "status": "Ready", "comment": "Keep fixtures small enough for local runs."},
        "T-044": {"title": "Review notification wording", "priority": "Should", "estimate_points": "3", "depends_on": "", "skill": "frontend", "status": "Open", "comment": "A copy review is still pending."},
        "T-049": {"title": "Add retention cleanup job", "priority": "Must", "estimate_points": "4", "depends_on": "", "skill": "data", "status": "Open", "comment": "Use the existing daily job window."},
        "T-061": {"title": "Add audit export", "priority": "Must", "estimate_points": "4", "depends_on": "", "skill": "security", "status": "Ready", "comment": "Export fields should match the account view."},
        "T-068": {"title": "Seed payment sandbox data", "priority": "Should", "estimate_points": "3", "depends_on": "", "skill": "payments", "status": "Open", "comment": "Use non-production card numbers only."},
        "T-074": {"title": "Enable payment sandbox checkout", "priority": "Must", "estimate_points": "8", "depends_on": "T-068", "skill": "payments", "status": "Ready", "comment": "Leave the customer-facing label unchanged."},
        "T-083": {"title": "Add beta readiness checks", "priority": "Must", "estimate_points": "3", "depends_on": "T-037", "skill": "qa", "status": "Open", "comment": "Report failures in the existing summary."},
        "T-096": {"title": "Add beta service dashboard", "priority": "Must", "estimate_points": "", "depends_on": "", "skill": "platform", "status": "Open", "comment": "Use the existing service names."},
        "T-108": {"title": "Add account usage limits", "priority": "Must", "estimate_points": "8", "depends_on": "T-023", "skill": "backend", "status": "Ready", "comment": "Document the default limit in the API notes."},
        "T-113": {"title": "Update beta help panel", "priority": "Must", "estimate_points": "8", "depends_on": "", "skill": "frontend", "status": "Open", "comment": "Keep the panel usable at narrow widths."},
        "T-119": {"title": "Add service health probes", "priority": "Must", "estimate_points": "8", "depends_on": "", "skill": "platform", "status": "In Progress", "comment": "Use the same timeout as the service checks."},
        "T-104": {"title": "Add legacy import note", "priority": "Must", "estimate_points": "5", "depends_on": "", "skill": "data", "status": "Done", "comment": "Released with the earlier beta build."},
    }
    for row in rows:
        if row["ticket_id"] in planted:
            row.update(planted[row["ticket_id"]])


def write_supporting_files() -> None:
    write_csv(FIXTURE / "team_roster.csv", ["person", "skill", "focus_factor", "base_points_per_workday"], [
        {"person": "Ari Vega", "skill": "frontend", "focus_factor": "0.34", "base_points_per_workday": "1"},
        {"person": "Bram Cole", "skill": "backend", "focus_factor": "0.45", "base_points_per_workday": "1"},
        {"person": "Cleo Neri", "skill": "data", "focus_factor": "0.50", "base_points_per_workday": "1"},
        {"person": "Dara Ives", "skill": "platform", "focus_factor": "0.90", "base_points_per_workday": "1"},
        {"person": "Emi Shah", "skill": "qa", "focus_factor": "0.70", "base_points_per_workday": "1"},
        {"person": "Fynn Ruiz", "skill": "security", "focus_factor": "0.50", "base_points_per_workday": "1"},
        {"person": "Gale Park", "skill": "payments", "focus_factor": "0.40", "base_points_per_workday": "1"},
        {"person": "Hana Lo", "skill": "frontend", "focus_factor": "0.10", "base_points_per_workday": "1"},
        {"person": "Ivo Marin", "skill": "backend", "focus_factor": "0.10", "base_points_per_workday": "1"},
    ])
    write_csv(FIXTURE / "sprint_calendar.csv", ["sprint", "start", "end"], [
        {"sprint": "2027-S1", "start": "2027-04-05", "end": "2027-04-16"},
        {"sprint": "2027-S2", "start": "2027-04-19", "end": "2027-04-30"},
        {"sprint": "2027-S3", "start": "2027-05-03", "end": "2027-05-14"},
    ])
    write_csv(FIXTURE / "holidays.csv", ["date", "name"], [
        {"date": "2027-04-09", "name": "Founders Day"},
        {"date": "2027-04-26", "name": "Civic Monday"},
        {"date": "2027-04-27", "name": "Civic Tuesday"},
        {"date": "2027-04-28", "name": "Civic Wednesday"},
        {"date": "2027-04-29", "name": "Civic Thursday"},
        {"date": "2027-05-03", "name": "Spring Holiday"},
    ])
    write_csv(FIXTURE / "on_call.csv", ["person", "week_start", "week_end", "rotation_note"], [
        {"person": "Ari Vega", "week_start": "2027-04-05", "week_end": "2027-04-09", "rotation_note": "primary"},
        {"person": "Gale Park", "week_start": "2027-04-19", "week_end": "2027-04-23", "rotation_note": "primary"},
        {"person": "Dara Ives", "week_start": "2027-04-26", "week_end": "2027-04-30", "rotation_note": "primary"},
        {"person": "Bram Cole", "week_start": "2027-05-10", "week_end": "2027-05-14", "rotation_note": "primary"},
    ])
    write_csv(FIXTURE / "team_aliases.csv", ["export_name", "roster_name", "note"], [
        {"export_name": "Ari V.", "roster_name": "Ari Vega", "note": "old export spelling"},
        {"export_name": "Bram Cole", "roster_name": "Bram Cole", "note": ""},
        {"export_name": "Gale P.", "roster_name": "Gale Park", "note": "old export spelling"},
    ])
    write_csv(FIXTURE / "release_checklist.csv", ["item", "owner", "state"], [
        {"item": "beta copy review", "owner": "Ari Vega", "state": "open"},
        {"item": "service names", "owner": "Dara Ives", "state": "in review"},
        {"item": "sandbox account", "owner": "Gale Park", "state": "open"},
        {"item": "old import note", "owner": "Cleo Neri", "state": "archived"},
    ])
    (FIXTURE / "director_note.md").write_text(
        """# Director note\n\nThe beta target is the end of the three sprints in the calendar. Please plan the next three sprints from the current open backlog. I need the must-have work called out clearly, including anything that cannot honestly fit, and I want dependency work visible rather than assumed away.\n\nThe team keeps its normal focus factors during this window. The person on the on-call rotation has half of their normal capacity during that on-call week.\n""", encoding="utf-8")
    (FIXTURE / "roadmap.md").write_text(
        """# Beta roadmap\n\nThe beta review is scheduled after 2027-05-14. The roadmap uses the words Must, Should and Could in the backlog's priority column. It is a directional list, not a replacement for the ticket export.\n\nThe review needs the account flow, service protections, audit visibility, retention work, usage limits, readiness checks and payment sandbox experience.\n""", encoding="utf-8")
    (FIXTURE / "status_legend.md").write_text(
        """# Backlog export notes\n\nThe export includes open work and historical rows. Count `Open`, `Ready`, `In Progress`, and `Blocked` as open for planning. Do not plan rows marked `Done`, `Closed`, `Cancelled`, or `Canceled`.\n\n`estimate_points` is blank when the ticket has no usable estimate. A blank is not zero. `depends_on` is a semicolon-separated list of ticket IDs; an empty cell means no recorded dependency. Names in the roster are authoritative when matching people.\n""", encoding="utf-8")
    (FIXTURE / "capacity_policy.md").write_text(
        """# Capacity notes\n\nA sprint includes every Monday through Friday from its inclusive start through inclusive end. A listed holiday removes that working day for everybody. For each remaining day, a person's capacity is `base_points_per_workday * focus_factor`; a person on call gets half of that day's capacity. Sprint capacity is the sum of all persons' daily capacity.\n\nA ticket is assigned to the only roster person with the matching skill when there is one.\n""", encoding="utf-8")
    (FIXTURE / "README.md").write_text(
        """# Three-sprint planning inputs\n\nAs of: **2027-04-02**. Dates in this folder are in 2027. The next three sprint dates are in `sprint_calendar.csv`.\n\nFiles:\n- `backlog_export.csv`: the 130-row ticket export. Columns are ticket ID, title, priority, estimate in points, dependency IDs, skill, status, and a free-text comment.\n- `team_roster.csv`: person, one skill tag, focus factor, and normal points per working day.\n- `sprint_calendar.csv`: inclusive sprint names and start/end dates.\n- `holidays.csv`: dates that are not working days.\n- `on_call.csv`: on-call person and inclusive Monday-to-Friday rotation week.\n- `director_note.md`: the request and beta timing.\n- `roadmap.md`: directional beta scope.\n- `status_legend.md`: status and empty-cell conventions for the export.\n- `capacity_policy.md`: the capacity and assignment conventions.\n- `team_aliases.csv`: older name spellings from a separate export.\n- `release_checklist.csv`: small, noisy checklist export; it is not the backlog.\n\nThe backlog contains historical rows, cancelled rows, comments, empty cells, and inconsistent capitalization typical of an export. Use the ticket ID as the stable identifier.\n""", encoding="utf-8")


def main() -> None:
    FIXTURE.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    rows = bulk_backlog(rng)
    plant(rows)
    write_csv(FIXTURE / "backlog_export.csv", ["ticket_id", "title", "priority", "estimate_points", "depends_on", "skill", "status", "comment"], rows)
    write_supporting_files()


if __name__ == "__main__":
    main()
