#!/usr/bin/env python3
"""Derive the grading key from the planning inputs, never from planted memory."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
KEY_PATH = ROOT / "hidden" / "key.json"
ID_RE = re.compile(r"\bF-\d{3}\b", re.IGNORECASE)
OPEN_STATUSES = {"backlog", "ready", "in progress"}


def ids_in(text: str) -> list[str]:
    return [match.upper() for match in ID_RE.findall(text)]


def read_backlog() -> dict[str, dict[str, str]]:
    with (FIXTURE / "backlog.csv").open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return {row["id"].upper(): row for row in rows}


def commitment_ids() -> list[str]:
    text = (FIXTURE / "sales-commitments.md").read_text(encoding="utf-8")
    northline = text.split("## Northline Cooperative", 1)[1].split("## ", 1)[0]
    return ids_in(northline)


def target_interview_ids() -> list[str]:
    found: list[str] = []
    for path in sorted((FIXTURE / "interviews").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        if "multi-site service organization" in text:
            for feature_id in ids_in(text):
                if feature_id not in found:
                    found.append(feature_id)
    return found


def dependency_closure(seed: list[str], backlog: dict[str, dict[str, str]]) -> tuple[list[str], list[str]]:
    referenced = {
        dep.strip().upper()
        for feature_id in seed
        for dep in backlog[feature_id].get("dependencies", "").split(",")
        if dep.strip()
    }
    # A feature named as a prerequisite is counted as pulled in rather than as
    # an independent selection, even if a customer note also mentions it.
    roots = [feature_id for feature_id in seed if feature_id not in referenced]
    selected: list[str] = []
    pulled: list[str] = []

    def visit(feature_id: str) -> None:
        if feature_id in selected:
            return
        for dep in backlog[feature_id].get("dependencies", "").split(","):
            dep = dep.strip().upper()
            if dep:
                visit(dep)
                if dep not in pulled:
                    pulled.append(dep)
        selected.append(feature_id)

    for feature_id in roots:
        visit(feature_id)
    return selected, pulled


def main() -> None:
    backlog = read_backlog()
    launch_text = (FIXTURE / "launch-brief.md").read_text(encoding="utf-8")
    launch_ids = ids_in(launch_text)
    seeds: list[str] = []
    for feature_id in commitment_ids() + target_interview_ids() + launch_ids:
        if feature_id in backlog and feature_id not in seeds:
            if backlog[feature_id]["status"].strip().lower() in OPEN_STATUSES:
                seeds.append(feature_id)
    selected, pulled = dependency_closure(seeds, backlog)
    selected_set = set(selected)
    all_ids = list(backlog)
    out = [feature_id for feature_id in all_ids if feature_id not in selected_set]

    capacity = 0
    with (FIXTURE / "team-capacity.csv").open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            capacity += int(row["capacity_points"])
    planned = sum(int(backlog[feature_id]["estimate_points"]) for feature_id in selected)
    must_haves = commitment_ids()

    assertions = [
        {"id": "committed-export-in", "desc": "The signed launch export commitment is in scope", "op": "includes", "path": "in", "ids": [must_haves[0]]},
        {"id": "committed-export-must-have", "desc": "The signed launch export is called out as a must-have", "op": "includes", "path": "must_haves", "ids": [must_haves[0]]},
        {"id": "committed-import-in", "desc": "The committed launch import is in scope", "op": "includes", "path": "in", "ids": [must_haves[1]]},
        {"id": "target-dashboard-in", "desc": "The high-value regional dashboard is in scope", "op": "includes", "path": "in", "ids": ["F-052"]},
        {"id": "dashboard-prerequisite", "desc": "The dashboard prerequisite is pulled into the plan", "op": "includes", "path": "dependencies_pulled_in", "ids": pulled},
        {"id": "internal-wallboard-out", "desc": "The internal-only wallboard is not in scope", "op": "absent", "path": "in", "ids": ["F-044"]},
        {"id": "field-mobile-out", "desc": "The field-sales mobile request is not in scope", "op": "excludes", "path": "in", "ids": ["F-057"]},
        {"id": "capacity-total", "desc": "Capacity reflects the four dated sprints and holiday", "op": "number", "path": "capacity_points", "value": capacity, "tol": 0},
        {"id": "planned-total", "desc": "Planned points cover the required features and stay within capacity", "op": "number", "path": "planned_points", "value": (planned + capacity) / 2, "tol": (capacity - planned) / 2},
        {"id": "launch-snapshot-in", "desc": "The launch follow-up snapshot is in scope", "op": "includes", "path": "in", "ids": launch_ids},
        {"id": "approval-rules-in", "desc": "The target segment approval workflow is in scope", "op": "includes", "path": "in", "ids": ["F-038"]},
        {"id": "audit-filters-in", "desc": "The target segment audit workflow is in scope", "op": "includes", "path": "in", "ids": ["F-021"]},
        {"id": "must-have-import", "desc": "The committed import is explicitly marked a must-have", "op": "includes", "path": "must_haves", "ids": [must_haves[1]]},
        {"id": "out-list-has-decoy", "desc": "The internal-only wallboard is listed out", "op": "includes", "path": "out", "ids": ["F-044"]},
    ]
    key = {"output": "docs/launch-scope.md", "block": "launch-scope", "assertions": assertions}
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    KEY_PATH.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
