#!/usr/bin/env python3
"""Create the invented launch-planning fixture from deterministic bulk data."""
from __future__ import annotations

import csv
import random
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
RNG = random.Random(270726)


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def make_backlog() -> list[dict[str, str]]:
    verbs = ["Refine", "Improve", "Add", "Extend", "Refresh", "Streamline", "Support", "Update"]
    nouns = [
        "queue filters", "workspace labels", "saved searches", "region aliases", "billing notes",
        "list sorting", "record hints", "team mentions", "export history", "activity badges",
        "schedule views", "template cloning", "account notes", "notification rules", "status chips",
    ]
    statuses = ["Backlog", "Ready", "In Progress", "Closed", "Cancelled"]
    priorities = ["Low", "Medium", "High"]
    rows: list[dict[str, str]] = []
    for number in range(1, 73):
        feature_id = f"F-{number:03d}"
        title = f"{RNG.choice(verbs)} {RNG.choice(nouns)}"
        status = RNG.choices(statuses, weights=[32, 25, 16, 18, 9])[0]
        priority = RNG.choices(priorities, weights=[30, 48, 22])[0]
        points = str(RNG.choice([2, 3, 5, 5, 8, 8, 13]))
        value = str(RNG.randint(2, 8))
        evidence = RNG.choice(["", "Support thread", "Interview-01", "Usage review", "Account review"])
        dependency = ""
        if number in {17, 29, 47, 69}:
            dependency = f"F-{number - 1:03d}"
        note = RNG.choice([
            "Sizing to be revisited after design review.",
            "Small wording changes are still expected.",
            "Existing behavior should remain unchanged.",
            "Requested in the spring planning sweep.",
            "No customer date attached.",
        ])
        rows.append({
            "id": feature_id,
            "title": title,
            "status": status,
            "priority": priority,
            "estimate_points": points,
            "value_score": value,
            "dependencies": dependency,
            "customer_evidence": evidence,
            "owner": RNG.choice(["Nora", "Ilan", "Mei", "Sora"]),
            "notes": note,
        })
    return rows


def plant_traps(rows: list[dict[str, str]]) -> None:
    by_id = {row["id"]: row for row in rows}
    plants = {
        "F-004": {
            "title": "Saved workspace views", "status": "Ready", "priority": "High",
            "estimate_points": "5", "value_score": "7", "dependencies": "",
            "customer_evidence": "Interview-03", "notes": "Several teams asked to return to the same operating view.",
        },
        "F-010": {
            "title": "Batch location import", "status": "Ready", "priority": "Medium",
            "estimate_points": "8", "value_score": "8", "dependencies": "",
            "customer_evidence": "Interview-02; Interview-06", "notes": "Import flow needs a clear error report for partial rows.",
        },
        "F-014": {
            "title": "Signed partner export bundle", "status": "Backlog", "priority": "Medium",
            "estimate_points": "8", "value_score": "6", "dependencies": "",
            "customer_evidence": "Account review", "notes": "Export package includes the agreed signature page and delivery manifest.",
        },
        "F-021": {
            "title": "Audit trail filters", "status": "Ready", "priority": "High",
            "estimate_points": "5", "value_score": "7", "dependencies": "",
            "customer_evidence": "Interview-03", "notes": "Keep the first release to actor, date, and action filters.",
        },
        "F-031": {
            "title": "Event schema versioning", "status": "Ready", "priority": "Low",
            "estimate_points": "3", "value_score": "3", "dependencies": "",
            "customer_evidence": "Interview-04", "notes": "Version labels should be visible in the event reference.",
        },
        "F-038": {
            "title": "Role-based approval rules", "status": "In Progress", "priority": "High",
            "estimate_points": "8", "value_score": "8", "dependencies": "",
            "customer_evidence": "Interview-01", "notes": "The first slice covers approve, reject, and delegate actions.",
        },
        "F-044": {
            "title": "Executive vanity wallboard", "status": "Ready", "priority": "High",
            "estimate_points": "13", "value_score": "10", "dependencies": "",
            "customer_evidence": "", "notes": "Leadership asked for a large-screen version for the office lobby.",
        },
        "F-052": {
            "title": "Regional health dashboard", "status": "Backlog", "priority": "High",
            "estimate_points": "13", "value_score": "10", "dependencies": "F-031",
            "customer_evidence": "Interview-03", "notes": "Show service health by region with a simple week-over-week view.",
        },
        "F-057": {
            "title": "Offline mobile approvals", "status": "Ready", "priority": "High",
            "estimate_points": "8", "value_score": "9", "dependencies": "",
            "customer_evidence": "Interview-05", "notes": "Mobile flow should work without a signal and reconcile later.",
        },
        "F-063": {
            "title": "Launch adoption snapshot", "status": "Ready", "priority": "High",
            "estimate_points": "8", "value_score": "8", "dependencies": "",
            "customer_evidence": "Launch brief", "notes": "A compact adoption snapshot is needed for the conference follow-up.",
        },
    }
    for feature_id, changes in plants.items():
        by_id[feature_id].update(changes)


def write_backlog(rows: list[dict[str, str]]) -> None:
    fields = ["id", "title", "status", "priority", "estimate_points", "value_score", "dependencies", "customer_evidence", "owner", "notes"]
    with (FIXTURE / "backlog.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_fixture(rows: list[dict[str, str]]) -> None:
    write_text(FIXTURE / "README.md", """# Conference launch planning inputs

This folder contains the working exports used for the 2027 conference launch cut. The data is current as of **2027-07-26**; that is the date that counts as today. Dates use ISO format and all names are fictional.

- `launch-brief.md`: the launch audience, outcome, conference date, and the small set of launch outcomes requested by product leadership.
- `backlog.csv`: the product backlog. Columns are `id` (stable feature identifier), `title`, `status`, `priority`, `estimate_points` (engineering points, blank means not estimated), `value_score` (1 low to 10 high), `dependencies` (comma-separated feature IDs that must be ready first), `customer_evidence`, `owner`, and `notes`.
- `roadmap.csv`: the current roadmap export. It includes historical and future entries and is not a promise that every row fits this launch window.
- `sales-commitments.md`: commitments made to named accounts, including the requested delivery window and the backlog IDs used in the deal notes.
- `team-capacity.csv`: the engineering team's sprint capacity. `capacity_points` is the usable team total for the sprint after the listed holiday dates. A holiday date is a working day with zero capacity. The four sprints run Monday through Friday on their listed dates; weekends do not consume capacity.
- `interviews/interview-*.md`: short customer conversations. The segment and account context in each note are part of the evidence; a note is not a commitment unless it says so.

Backlog status is case-insensitive. `Backlog`, `Ready`, and `In Progress` are open for planning; `Closed` and `Cancelled` are not available work. A blank estimate is not schedulable until it is estimated. Feature IDs are matched exactly, ignoring case and surrounding spaces. The capacity sheet is the source for available points; do not add points from closed or cancelled backlog rows.
""")
    write_text(FIXTURE / "launch-brief.md", """# Conference launch brief

**As of:** 2027-07-26  
**Conference launch:** 2027-09-20  
**Audience:** regional operations teams at multi-site service organizations

The launch should make the day-to-day regional operating workflow credible to that audience. The first public slice should include the launch adoption snapshot, feature `F-063`, so the conference follow-up has a simple way to discuss early use. The conference date is a public event date; the last planned engineering sprint ends on 2027-09-17.

The product group wants a scope that engineering can start on Monday, with a clear explanation of what is deliberately left out. Estimates are engineering points, not calendar days.
""")
    write_text(FIXTURE / "roadmap.csv", """roadmap_id,feature_id,theme,target_window,roadmap_status,comment
RM-01,F-004,Workspace,2027-Q3,Active,Included in the operating view theme.
RM-02,F-010,Onboarding,2027-Q3,Active,Import improvements are under discussion.
RM-03,F-044,Leadership reporting,2027-Q3,Proposed,Requested for an internal showcase.
RM-04,F-052,Regional insight,2027-Q3,Proposed,Dashboard concept needs a thin first slice.
RM-05,F-057,Mobile workflow,2027-Q4,Planned,Mobile work follows the conference cut.
RM-06,F-063,Adoption,2027-Q3,Active,Follow-up reporting is part of the launch story.
RM-07,F-018,Mobile workflow,2027-Q3,Cancelled,Old date retained in export.
RM-08,F-071,Admin,2027-Q2,Closed,Historical roadmap row.
""")
    write_text(FIXTURE / "sales-commitments.md", """# Sales commitments export

Exported 2027-07-25 from the signed-deal register. A delivery window marked **conference launch** is a customer promise, not a backlog priority label.

## Northline Cooperative
- Segment: regional operations for a multi-site service organization
- Window: conference launch, 2027-09-20
- Agreed launch package: `F-014` signed partner export bundle and `F-010` batch location import
- Commercial note: the export must include a signature page and delivery manifest.

## Alder Field Group
- Segment: field sales teams
- Window: post-launch evaluation
- Requested later: `F-057` offline mobile approvals
- Commercial note: no conference delivery date was agreed.

## Greybridge Services
- Segment: regional operations
- Window: 2027-10 review
- Requested: `F-021` audit trail filters
- Commercial note: this is a follow-up discussion, not a launch promise.
""")
    write_text(FIXTURE / "team-capacity.csv", """sprint_id,start_date,end_date,capacity_points,holiday_dates,notes
S1,2027-07-26,2027-08-06,16,,Normal two-week sprint.
S2,2027-08-09,2027-08-20,16,,Normal two-week sprint.
S3,2027-08-23,2027-09-03,15,2027-08-30,One team holiday on a weekday.
S4,2027-09-06,2027-09-17,16,,Normal two-week sprint.
""")
    write_text(FIXTURE / "interviews" / "interview-01.md", """# Interview 01: regional operations lead

**Date:** 2027-07-08  
**Account type:** multi-site service organization

The operations lead needs approval rules that can be delegated without making every regional manager an administrator. They described approve, reject, and delegate as the useful first slice. They also want the saved operating view to open quickly.

Referenced backlog items: `F-038`, `F-004`.
""")
    write_text(FIXTURE / "interviews" / "interview-02.md", """# Interview 02: regional operations coordinator

**Date:** 2027-07-11  
**Account type:** multi-site service organization

The coordinator currently enters locations one at a time. A batch import with a report of rejected rows would remove the most painful setup work before launch. They did not ask for a mobile-first workflow.

Referenced backlog item: `F-010`.
""")
    write_text(FIXTURE / "interviews" / "interview-03.md", """# Interview 03: regional service director

**Date:** 2027-07-14  
**Account type:** multi-site service organization

The director wants saved workspace views, a searchable audit trail, and a regional health view. They need to compare regions during the weekly operating meeting and find who changed a record.

Referenced backlog items: `F-004`, `F-021`, `F-052`.
""")
    write_text(FIXTURE / "interviews" / "interview-04.md", """# Interview 04: integration analyst

**Date:** 2027-07-16  
**Account type:** multi-site service organization

The analyst can work with the existing event feed if version labels are visible. Without that small bit of clarity, a regional dashboard is hard to interpret during rollout.

Referenced backlog item: `F-031`.
""")
    write_text(FIXTURE / "interviews" / "interview-05.md", """# Interview 05: field sales lead

**Date:** 2027-07-18  
**Account type:** small field sales team

This team would prefer offline mobile approvals and says a bulk location import is not useful for its current workflow. They want the mobile path before investing in regional operating views.

Referenced backlog items: `F-057`, `F-010`.
""")
    write_text(FIXTURE / "interviews" / "interview-06.md", """# Interview 06: regional implementation manager

**Date:** 2027-07-21  
**Account type:** multi-site service organization

The implementation manager repeated the need for a reliable location import and asked that partner exports keep their delivery manifest. They described the first release as a regional operations foundation, not an executive display.

Referenced backlog item: `F-010`.
""")
    # A small ordinary export artifact adds realism without changing the source decisions.
    write_text(FIXTURE / "backlog-export-notes.txt", """Backlog export notes, 2027-07-26

- One row has a blank estimate and remains unschedulable.
- Closed and cancelled rows are retained by the export.
- The owner spelling "Ilan" appears in older rows; do not merge it with another person.
- Values were copied from the planning workbook and are not revenue amounts.
""")


def main() -> None:
    if FIXTURE.exists():
        shutil.rmtree(FIXTURE)
    FIXTURE.mkdir(parents=True)
    rows = make_backlog()
    plant_traps(rows)
    write_backlog(rows)
    write_fixture(rows)


if __name__ == "__main__":
    main()
