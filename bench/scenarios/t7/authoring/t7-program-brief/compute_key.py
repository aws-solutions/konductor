#!/usr/bin/env python3
"""Derive the grading key only from the visible fixture files."""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
FIXTURE = HERE / "fixture"
OUT = HERE / "hidden" / "key.json"


def read_csv(name: str) -> list[dict[str, str]]:
    with (FIXTURE / name).open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def text(name: str) -> str:
    return (FIXTURE / name).read_text(encoding="utf-8")


def derive() -> dict:
    memo = text("leadership-memo.md")
    tickets = read_csv("open-requests.csv")
    headcount = read_csv("headcount.csv")

    # The shared service id comes from the request export, not from authoring data.
    identity_rows = [
        row for row in tickets
        if "deployment identity" in row["title"].lower()
        and row["status"].strip().lower() in {"open", "in progress", "waiting"}
    ]
    identity_id = identity_rows[0]["id"]
    owner_match = re.search(r"through the ([A-Z][A-Za-z ]+?) endpoint", identity_rows[0]["comment"])
    identity_owner = owner_match.group(1).strip() if owner_match else "Identity Services"

    # Find the duplicate roadmap commitment by quarter and work text.
    commitments: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    for roadmap in sorted(FIXTURE.glob("*-roadmap.md")):
        team = roadmap.stem.split("-")[0].title()
        for line in roadmap.read_text(encoding="utf-8").splitlines():
            if not line.startswith("|") or line.startswith("|---") or "Quarter" in line:
                continue
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if len(cells) != 5:
                continue
            quarter, work, owner, _status, _dependency = cells
            commitments[(quarter, work.casefold())].append((owner, work))
    conflict_quarter, conflict_work, conflict_owners = None, None, []
    for (quarter, work_key), owners in commitments.items():
        unique = []
        for owner, work in owners:
            if owner not in unique:
                unique.append(owner)
        if len(unique) > 1:
            conflict_quarter, conflict_work, conflict_owners = quarter, owners[0][1], unique
            break

    # The retention floor is the largest active inventory value, while the memo
    # supplies the sign-in requirement and the program's explicit scope.
    retention_values = []
    for inventory in ("atlas-tools.csv", "beacon-tools.csv", "cedar-tools.csv"):
        for row in read_csv(inventory):
            if row["status"].strip().lower() == "active" and row["audit_retention_days"].strip():
                retention_values.append(int(row["audit_retention_days"]))
    retention_floor = max(retention_values)
    auth_requirement = re.search(r"support ([A-Z]+) sign-in", memo).group(1)

    required_each = int(re.search(r"(\d+) dedicated engineers from each product team", memo).group(1))
    required_shared = int(re.search(r"and (\d+) engineer from Identity Services", memo).group(1))
    product_teams = [row["team"] for row in headcount if row["team"] != "Identity Services"]
    required = required_each * len(product_teams) + required_shared
    available = sum(int(row["available_program_engineers"]) for row in headcount)
    headcount_gap = required - available

    milestone_pairs = re.findall(
        r"(?:decision|pilot ready|first product cutover|all in-scope teams on the shared tool) on (\d{4}-\d{2}-\d{2})",
        memo,
    )
    milestone_names = [
        "Tool decision", "Pilot ready", "First product cutover", "All in-scope teams on shared tool"
    ]
    milestones = [{"name": name, "date": date} for name, date in zip(milestone_names, milestone_pairs)]

    decoy_rows = [row for row in tickets if "feature flag" in row["title"].lower()]
    decoy_id = decoy_rows[0]["id"]

    workstreams = [
        "Tool selection and governance",
        "Identity integration",
        "Migration and cutover",
    ]
    shared_dependency = f"{identity_owner} auth and secrets service ({identity_id})"
    conflict_about = f"{conflict_work} in {conflict_quarter}"

    assertions = [
        {"id": "identity-ticket", "desc": "Names the shared identity dependency ticket", "op": "includes", "path": "shared_dependencies", "ids": [identity_id]},
        {"id": "identity-owner", "desc": "Names the single identity service owner", "op": "includes", "path": "shared_dependencies", "ids": [identity_owner]},
        {"id": "shared-dep-in-workstreams", "desc": "A workstream depends on the shared identity ticket", "op": "cites", "path": "workstreams", "field": "depends_on", "ids": [identity_id]},
        {"id": "roadmap-teams", "desc": "Names both teams in the roadmap conflict", "op": "cites", "path": "conflicts", "field": "between", "ids": conflict_owners, "min": len(conflict_owners)},
        {"id": "conflict-precision", "desc": "Keeps the conflicts list focused on the seeded conflict", "op": "precision", "path": "conflicts", "field": "between", "ids": conflict_owners, "min": 0.5, "maxCount": 3},
        {"id": "staffing-gap", "desc": "Reports the engineering staffing gap", "op": "number", "path": "headcount_gap", "value": headcount_gap, "tol": 0},
        {"id": "retention-constraint", "desc": "Carries the audit retention floor", "op": "includes", "path": "constraints", "ids": [f"{retention_floor} days"]},
        {"id": "auth-constraint", "desc": "Carries the required sign-in constraint", "op": "includes", "path": "constraints", "ids": [auth_requirement]},
        {"id": "final-milestone-date", "desc": "Dates the all-teams checkpoint from the memo", "op": "cites", "path": "milestones", "field": "date", "ids": [milestones[-1]["date"]]},
        {"id": "feature-flag-decoy", "desc": "Does not turn the out-of-scope high-vote request into a workstream", "op": "absent", "path": "workstreams", "ids": [decoy_id]},
        {"id": "decoy-out-of-scope", "desc": "Lists the high-vote request as out of scope", "op": "includes", "path": "out_of_scope", "ids": [decoy_id]},
    ]

    return {
        "output": "docs/program-brief.md",
        "block": "program",
        "assertions": assertions,
    }


def main() -> None:
    OUT.write_text(json.dumps(derive(), indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
