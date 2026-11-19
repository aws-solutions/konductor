#!/usr/bin/env python3
"""Create the invented release-planning fixture with a fixed seed."""
from __future__ import annotations

import csv
import random
import shutil
from datetime import date, timedelta
from pathlib import Path

SEED = 7127
ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
rng = random.Random(SEED)


def write_csv(name: str, headers: list[str], rows: list[list[object]]) -> None:
    with (FIXTURE / name).open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)


def main() -> None:
    if FIXTURE.exists():
        shutil.rmtree(FIXTURE)
    FIXTURE.mkdir(parents=True)

    release_rows = [
        ["RT-27-03", "2027.03", "2027-02-12", "2027-03-26", "main", "Spring train"],
        ["RT-27-05", "2027.05", "2027-03-26", "2027-05-07", "main", "Early summer train"],
        ["RT-27-06", "2027.06", "2027-05-07", "2027-06-18", "main", "Summer train"],
        ["RT-27-07", "2027.07", "2027-06-18", "2027-07-30", "main", "Late summer train"],
        ["RT-27-09", "2027.09", "2027-07-30", "2027-09-10", "main", "Autumn train"],
        ["RT-27-10", "2027.10", "2027-09-10", "2027-10-22", "main", "Late autumn train"],
        ["RT-27-12", "2027.12", "2027-10-22", "2027-12-03", "main", "Year-end train"],
    ]
    write_csv("release-trains.csv", ["train_id", "version", "branch_date", "release_date", "branch_from", "label"], release_rows)

    sprint_rows = []
    start = date(2027, 1, 4)
    for i in range(1, 25):
        s = start + timedelta(days=14 * (i - 1))
        e = s + timedelta(days=13)
        holidays = ""
        if s <= date(2027, 2, 15) <= e:
            holidays = "2027-02-15"
        if s <= date(2027, 4, 2) <= e:
            holidays = (holidays + ";" if holidays else "") + "2027-04-02"
        sprint_rows.append([f"S-27-{i:02d}", s.isoformat(), e.isoformat(), holidays, "two-week sprint"])
    write_csv("sprint-calendar.csv", ["sprint", "start_date", "end_date", "company_holidays", "comment"], sprint_rows)

    throughput = [
        ["S-26-13", "2026-08-03", "2026-08-14", 29, "ordinary", "Accepted work"],
        ["S-26-14", "2026-08-17", "2026-08-28", 31, "ordinary", "Accepted work"],
        ["S-26-15", "2026-08-31", "2026-09-11", 30, "ordinary", "Accepted work"],
        ["S-26-16", "2026-09-14", "2026-09-25", 28, "ordinary", "Accepted work"],
        ["S-26-17", "2026-09-28", "2026-10-09", 32, "ordinary", "Accepted work"],
        ["S-26-18", "2026-10-12", "2026-10-23", 30, "ordinary", "Accepted work"],
        ["S-26-19", "2026-10-26", "2026-11-06", 27, "ordinary", "Accepted work"],
        ["S-26-20", "2026-11-09", "2026-11-20", 30, "ordinary", "Accepted work"],
        ["S-26-21", "2026-11-23", "2026-12-04", 29, "ordinary", "Accepted work"],
        ["S-26-22", "2026-12-07", "2026-12-18", 31, "ordinary", "Accepted work"],
        ["S-26-23", "2026-12-21", "2027-01-01", 30, "ordinary", "Accepted work; holiday week included"],
        ["S-26-24", "2027-01-04", "2027-01-15", 86, "hackathon", "Experimental build day and demo work"],
    ]
    write_csv("throughput-history.csv", ["sprint", "start_date", "end_date", "completed_points", "kind", "comment"], throughput)

    ids = [f"WORK-{1001 + i}" for i in range(90)]
    storage_positions = [3, 11, 20, 27, 35, 43, 51, 58, 66, 7, 30, 47, 63]
    storage_ids = [ids[i] for i in storage_positions]
    storage_points = [8, 13, 5, 8, 13, 5, 8, 13, 8, "", 5, "", 8]
    storage_titles = [
        "Add engine manifest validation",
        "Persist segment metadata",
        "Read the new index format",
        "Write batches to the segment store",
        "Recover the active journal",
        "Expose storage health counters",
        "Add compaction scheduling",
        "Migrate the page cache adapter",
        "Run restart and replay coverage",
        "Document engine configuration",
        "Add snapshot compatibility checks",
        "Wire the service read path",
        "Remove the temporary compatibility shim",
    ]
    storage_by_id = dict(zip(storage_ids, zip(storage_titles, storage_points)))

    rows: list[list[object]] = []
    statuses = ["Open", "In Progress", "Ready", "Blocked"]
    workstreams = ["Query Runtime", "Ingest", "Operations", "Client SDK", "Archive Migration"]
    generic_titles = [
        "Refresh retry guidance", "Tune request batching", "Add audit field", "Update import parser",
        "Improve timeout message", "Add command-line check", "Refresh example fixture", "Review metrics naming",
        "Handle malformed header", "Document recovery path", "Reduce test setup", "Add warning to status page",
    ]
    for i, ticket_id in enumerate(ids):
        if i < 68:
            status = statuses[i % len(statuses)]
        else:
            status = ["Done", "Closed", "Cancelled", "Duplicate", ""][i % 5]
        title = f"{generic_titles[i % len(generic_titles)]} {i + 1}"
        initiative = "General Maintenance"
        workstream = workstreams[i % len(workstreams)]
        points: object = rng.choice([2, 3, 5, 8, 13])
        if i in [14, 18, 23, 36, 40, 55, 60, 64, 70, 82, 88]:
            points = ""
        if i in storage_positions:
            title, points = storage_by_id[ticket_id]
            initiative = "Storage Engine"
            workstream = "Storage Engine"
            status = "In Progress" if i % 2 else "Open"
        depends = ""
        parent_ticket = ""
        if i in [16, 17, 52, 53]:
            parent_ticket = ids[i - 1]
        if i > 0 and i % 9 == 0:
            depends = ids[i - 1]
        if ticket_id == storage_ids[1]:
            depends = storage_ids[0]
        if ticket_id == storage_ids[2]:
            depends = storage_ids[1]
        if ticket_id == storage_ids[3]:
            depends = storage_ids[2]
        if ticket_id == storage_ids[4]:
            depends = storage_ids[3]
        if ticket_id == storage_ids[5]:
            depends = storage_ids[4]
        if ticket_id == storage_ids[6]:
            depends = storage_ids[5]
        if ticket_id == storage_ids[7]:
            depends = storage_ids[6]
        if ticket_id == storage_ids[8]:
            depends = storage_ids[7]
        if ticket_id == storage_ids[9]:
            depends = storage_ids[8]
        if ticket_id == storage_ids[10]:
            depends = storage_ids[9]
        if ticket_id == storage_ids[11]:
            depends = storage_ids[10]
        if ticket_id == storage_ids[12]:
            depends = storage_ids[11]
        created = date(2026, 10, 5) + timedelta(days=(i * 3) % 130)
        updated = created + timedelta(days=(i * 5) % 42)
        comment = [
            "Acceptance notes are in the linked test plan.",
            "Waiting for the next integration run.",
            "Keep the user-facing wording short.",
            "No change to the public wire format.",
        ][i % 4]
        if i == 62:
            title = "Storage archive compaction for retention exports"
            initiative = "Archive Migration"
            workstream = "Archive Migration"
            points = 21
            depends = ids[61]
            comment = "Coordinates with the retention export window."
        rows.append([ticket_id, title, status, points, workstream, initiative, parent_ticket, depends, created.isoformat(), updated.isoformat(), comment])
    write_csv(
        "remaining-work.csv",
        ["ticket_id", "title", "status", "estimate_points", "workstream", "initiative", "parent_ticket", "depends_on", "created_date", "updated_date", "comment"],
        rows,
    )

    capacity_rows = [
        ["Storage Platform", "Ari", "Engineer", "2027-02-01", "2027-05-07", 5, 0.72, "Primary engine work"],
        ["Storage Platform", "Bea", "Engineer", "2027-02-01", "2027-05-07", 4, 0.65, "Shared with operations"],
        ["Storage Platform", "Cato", "Engineer", "2027-02-01", "2027-05-07", 3, 0.48, "Part-time allocation"],
        ["Runtime", "Deni", "Engineer", "2027-02-01", "2027-05-07", 6, 0.80, "Shared services"],
        ["Quality", "Eli", "Tester", "2027-02-01", "2027-05-07", 2, 0.50, "Release verification"],
    ]
    write_csv("team-capacity.csv", ["team", "person", "role", "from_date", "to_date", "people_days_per_week", "allocation", "comment"], capacity_rows)

    comment_rows = []
    for i, ticket_id in enumerate(ids[::5]):
        comment_rows.append([ticket_id, f"2027-01-{(i % 20) + 1:02d}", ["Reviewed with implementation group.", "Test case still needs a sample.", "No customer wording change."][i % 3], "reviewer-" + str((i % 4) + 1)])
    comment_rows.extend([
        [storage_ids[2], "2027-01-19", "Replay test uses the previous journal format.", "reviewer-2"],
        [storage_ids[9], "2027-01-25", "Configuration example is still being edited.", "reviewer-3"],
    ])
    write_csv("ticket-comments.csv", ["ticket_id", "comment_date", "comment", "author_alias"], comment_rows)

    change_rows = [
        ["2026-12-18", "WORK-1021", "estimate_points", "5", "8", "Clarified acceptance examples"],
        ["2027-01-03", "WORK-1046", "status", "Open", "In Progress", "Implementation started"],
        ["2027-01-08", "WORK-1063", "title", "Old parser wording", "Update import parser 63", "Title cleanup"],
        ["2027-01-12", "WORK-1079", "status", "In Progress", "Done", "Merged in maintenance branch"],
        ["2027-01-20", storage_ids[4], "comment", "", "Recovery test added", "Review note"],
    ]
    write_csv("change-log.csv", ["changed_date", "ticket_id", "field", "old_value", "new_value", "reason"], change_rows)

    (FIXTURE / "roadmap.md").write_text(
        """# Platform roadmap\n\nAs of 2027-02-01, the new storage engine is tracked as the **Storage Engine** initiative in the ticket export. Its intended customer capability is the segment store, replay, health reporting, compaction, and the service read path. Archive Migration is a separate initiative that has its own retention-export objective.\n\nThe roadmap does not change the ticket estimates or status values. A release train is considered to contain work that is merged to `main` by its branch date.\n\nThe engine is intended to replace the compatibility path after release review.\n""", encoding="utf-8")

    (FIXTURE / "review-and-stabilisation.md").write_text(
        """# Review and stabilisation rules\n\nThis document is current as of 2027-02-01.\n\n- The release calendar is authoritative for train versions, branch dates, and customer release dates. A train branches six weeks before its listed release date.\n- A ticket is considered open for planning when its status is `Open`, `In Progress`, `Ready`, or `Blocked`. `Done`, `Closed`, `Cancelled`, `Duplicate`, and a blank status are not open.\n- Estimate cells contain whole story points. A blank estimate is not zero. For an open blank estimate, use the median of the non-blank estimates in the same workstream and round a half point up.\n- A dependency named in `depends_on` must be complete before the ticket that names it can be accepted. Ticket IDs in that field are comma-separated.\n- Code for a feature must be merged to `main` no later than the branch date to enter that train. Work merged after branch waits for a later train.\n- A newly introduced customer feature stays behind its feature flag for one complete train. It may be enabled by default only in the following train after review and stabilisation checks pass.\n- The forecast starts with the first sprint beginning after the as-of date. The sprint calendar records dates and company holidays; throughput history is the source for completed story points per ordinary sprint.\n\nThe remaining-work export is a snapshot, not a commitment ledger. Its comments may be stale.\n""", encoding="utf-8")

    (FIXTURE / "status-codes.md").write_text(
        """# Ticket export field notes\n\nThe export uses status text as written by the delivery board. Empty cells are preserved. `Ready` means acceptance criteria are available; `Blocked` means the ticket remains in the active queue but cannot currently move. `Duplicate` is retained for audit history and is not active work.\n\nThe `initiative` and `workstream` columns are maintained separately. The initiative identifies the roadmap grouping; the workstream identifies the team doing the work.\n""", encoding="utf-8")

    (FIXTURE / "README.md").write_text(
        """# Release planning input\n\nThis folder is a snapshot **as of 2027-02-01**, which is the date to use as today. Dates use ISO `YYYY-MM-DD`; story points are whole points unless an estimate cell is empty. The snapshot contains deliberately ordinary board noise, including completed, cancelled, duplicate, and blank-status rows.\n\nFiles:\n\n- `release-trains.csv`: release-train calendar. Columns are train ID, version, branch date, release date, source branch, and label.\n- `sprint-calendar.csv`: two-week sprint dates and listed company holidays.\n- `throughput-history.csv`: the last twelve sprints, with accepted points, row kind, and a short comment.\n- `remaining-work.csv`: ticket export. Columns are ticket ID, title, status, estimate, workstream, initiative, optional parent ticket, dependencies, created and updated dates, and a board comment.\n- `review-and-stabilisation.md`: review, estimate, dependency, branching, flag, and forecast conventions.\n- `roadmap.md`: initiative descriptions and boundaries.\n- `team-capacity.csv`: capacity context for the snapshot window. `team`, `person`, and `role` identify the assignment; `from_date` and `to_date` bound it; `people_days_per_week` and `allocation` give availability; `comment` gives context.\n- `ticket-comments.csv`: selected review comments. `ticket_id` identifies the row; `comment_date`, `comment`, and `author_alias` give the comment record.\n- `change-log.csv`: selected ticket field edits. `changed_date`, `ticket_id`, and `field` identify an edit; `old_value`, `new_value`, and `reason` describe it.\n- `status-codes.md`: meanings of status and grouping columns.\n\nUse the ticket export as the current work list. The separate comment and change files provide context but do not replace the current row.\n""", encoding="utf-8")


if __name__ == "__main__":
    main()
