#!/usr/bin/env python3
"""Create the ordinary, noisy source exports for the program brief fixture."""
from __future__ import annotations

import csv
import random
from pathlib import Path

SEED = 2714
ROOT = Path(__file__).resolve().parents[1] / "fixture"


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def make_tickets(rng: random.Random) -> None:
    teams = ["Atlas", "Beacon", "Cedar", "Platform", "Growth"]
    titles = [
        "Clarify release approval message", "Add retry detail to deployment view",
        "Refresh service ownership list", "Improve rollback status text",
        "Export recent release activity", "Allow a second reviewer on a release",
        "Document staging promotion steps", "Show failed check links",
        "Add filter for service name", "Correct timestamp on release history",
        "Support a dry run for scheduled releases", "Clean up old environment labels",
        "Add a release summary to the weekly report", "Improve permission error copy",
        "Record the initiating user on a release", "Make release notes easier to scan",
    ]
    statuses = ["Open", "In Progress", "Waiting", "Closed", "Cancelled", "Done"]
    rows: list[dict[str, object]] = []
    for number in range(1, 101):
        status = rng.choices(statuses, weights=[38, 18, 8, 16, 6, 14])[0]
        estimate = "" if number % 11 == 0 else rng.choice([1, 2, 3, 5, 8])
        rows.append({
            "id": f"REQ-{number:03d}",
            "title": rng.choice(titles),
            "status": status,
            "votes": rng.randint(0, 21),
            "requester": rng.choice(["service-team", "release-ops", "support", "quality", "product"]),
            "team": rng.choice(teams),
            "estimate_points": estimate,
            "created": f"2027-{rng.randint(1, 3):02d}-{rng.randint(1, 27):02d}",
            "updated": f"2027-{rng.randint(3, 4):02d}-{rng.randint(1, 12):02d}",
            "comment": rng.choice([
                "Needs a small wording pass before review.",
                "Waiting for an example from a service owner.",
                "The current screen is usable but easy to miss.",
                "Please check this against the staging workflow.",
                "No customer deadline recorded.",
                "This came from the weekly operations notes.",
            ]),
        })
    write_csv(ROOT / "open-requests.csv", list(rows[0]), rows)


def make_inventories() -> None:
    fields = ["tool", "version", "owner_team", "environments", "audit_retention_days", "auth_mode", "status", "notes"]
    write_csv(ROOT / "atlas-tools.csv", fields, [
        {"tool": "ForgeRun", "version": "4.2", "owner_team": "Atlas", "environments": "staging|production", "audit_retention_days": 365, "auth_mode": "OIDC", "status": "active", "notes": "Release history is required for regulated service releases."},
        {"tool": "PatchBoard", "version": "1.8", "owner_team": "Atlas", "environments": "staging", "audit_retention_days": 90, "auth_mode": "OIDC", "status": "active", "notes": "Used for rehearsal jobs only."},
        {"tool": "OldRunner", "version": "0.9", "owner_team": "Atlas", "environments": "production", "audit_retention_days": 14, "auth_mode": "token", "status": "retiring", "notes": "No new services after March."},
    ])
    write_csv(ROOT / "beacon-tools.csv", fields, [
        {"tool": "Shipline", "version": "7.8", "owner_team": "Beacon", "environments": "staging|production", "audit_retention_days": 30, "auth_mode": "OIDC", "status": "active", "notes": "The team uses a separate approval queue."},
        {"tool": "HarborStep", "version": "2.3", "owner_team": "Beacon", "environments": "staging", "audit_retention_days": 60, "auth_mode": "SSO", "status": "active", "notes": "A few legacy jobs still use this."},
        {"tool": "Relay", "version": "1.1", "owner_team": "Beacon", "environments": "production", "audit_retention_days": 7, "auth_mode": "token", "status": "retiring", "notes": "Cancelled replacement work is retained for history."},
    ])
    write_csv(ROOT / "cedar-tools.csv", fields, [
        {"tool": "LaunchPad", "version": "2.9", "owner_team": "Cedar", "environments": "staging|production", "audit_retention_days": 30, "auth_mode": "SSO", "status": "active", "notes": "Most jobs are manually approved."},
        {"tool": "Greenway", "version": "3.0", "owner_team": "Cedar", "environments": "staging", "audit_retention_days": 180, "auth_mode": "OIDC", "status": "active", "notes": "Used by two newer services."},
        {"tool": "QuickDrop", "version": "0.6", "owner_team": "Cedar", "environments": "production", "audit_retention_days": 1, "auth_mode": "token", "status": "retiring", "notes": "Keep the row until the final archive."},
    ])


def make_capacity() -> None:
    fields = ["sprint", "start", "end", "holidays", "Atlas_engineer_days", "Beacon_engineer_days", "Cedar_engineer_days", "Identity_Services_engineer_days"]
    rows = [
        ["S27-08", "2027-04-12", "2027-04-23", "", 8, 8, 8, 4],
        ["S27-09", "2027-04-26", "2027-05-07", "", 8, 8, 8, 4],
        ["S27-10", "2027-05-10", "2027-05-21", "", 8, 8, 8, 4],
        ["S27-11", "2027-05-24", "2027-06-04", "2027-05-31", 7, 7, 7, 3],
        ["S27-12", "2027-06-07", "2027-06-18", "2027-06-18", 7, 7, 7, 3],
        ["S27-13", "2027-06-21", "2027-07-02", "", 8, 8, 8, 4],
        ["S27-14", "2027-07-05", "2027-07-16", "2027-07-05", 7, 7, 7, 3],
        ["S27-15", "2027-07-19", "2027-07-30", "", 8, 8, 8, 4],
        ["S27-16", "2027-08-02", "2027-08-13", "", 8, 8, 8, 4],
        ["S27-17", "2027-08-16", "2027-08-27", "", 8, 8, 8, 4],
    ]
    write_csv(ROOT / "capacity-2027.csv", fields, [dict(zip(fields, row)) for row in rows])


def make_base_docs() -> None:
    (ROOT / "atlas-roadmap.md").write_text("""# Atlas roadmap\n\nAs of 2027-04-12. Quarter labels use calendar quarters.\n\n| Quarter | Work | Owner | Status | Dependency |\n|---|---|---|---|---|\n| 2027-Q2 | Refresh release checklist | Atlas | planned | REQ-006 |\n| 2027-Q3 | Service deployment improvements | Atlas | planned | REQ-014 |\n| 2027-Q4 | Archive old release reports | Atlas | proposed | REQ-022 |\n""", encoding="utf-8")
    (ROOT / "beacon-roadmap.md").write_text("""# Beacon roadmap\n\nAs of 2027-04-12. Quarter labels use calendar quarters.\n\n| Quarter | Work | Owner | Status | Dependency |\n|---|---|---|---|---|\n| 2027-Q2 | Improve approval queue | Beacon | planned | REQ-009 |\n| 2027-Q3 | Release workflow improvements | Beacon | planned | REQ-018 |\n| 2027-Q4 | Remove an old queue | Beacon | proposed | REQ-026 |\n""", encoding="utf-8")
    (ROOT / "cedar-roadmap.md").write_text("""# Cedar roadmap\n\nAs of 2027-04-12. Quarter labels use calendar quarters.\n\n| Quarter | Work | Owner | Status | Dependency |\n|---|---|---|---|---|\n| 2027-Q2 | Document service promotion | Cedar | planned | REQ-011 |\n| 2027-Q3 | Cedar service release wave | Cedar | planned | REQ-019 |\n| 2027-Q4 | Simplify test cleanup | Cedar | proposed | REQ-031 |\n""", encoding="utf-8")
    (ROOT / "leadership-memo.md").write_text("""# Leadership memo\n\nAs of 2027-04-12. Leadership wants one shared deployment tool for production deployment orchestration across Atlas, Beacon, and Cedar. The target is all in-scope services running on it by 2027-08-27.\n\nThe program includes service registration, approvals, production promotion, rollback, and deployment history. It does not include feature flag controls, CI build systems, or data migrations. Deployment audit records must be retrievable for at least 365 days, and the tool must support OIDC sign-in and approval history.\n\nThe requested program staffing is 2 dedicated engineers from each product team and 1 engineer from Identity Services.\n\nSuggested checkpoints are tool decision on 2027-05-14, pilot ready on 2027-06-18, first product cutover on 2027-07-30, and all in-scope teams on the shared tool on 2027-08-27.\n""", encoding="utf-8")
    (ROOT / "headcount.csv").write_text("""team,engineering_headcount,available_program_engineers,notes\nAtlas,9,1,One engineer can start in April.\nBeacon,8,1,One engineer is shared with a support rotation.\nCedar,7,1,One engineer can start in May.\nIdentity Services,5,1,The service owner has a partial allocation.\n""", encoding="utf-8")


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    make_tickets(rng)
    make_inventories()
    make_capacity()
    make_base_docs()


if __name__ == "__main__":
    main()
