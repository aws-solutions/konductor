#!/usr/bin/env python3
"""Derive the grading key from fixture inputs, never from authoring constants."""
from __future__ import annotations

import csv
import json
import math
import re
from datetime import date
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
OUT = ROOT / "hidden" / "key.json"
OPEN = {"Open", "In Progress", "Ready", "Blocked"}


def read_csv(name: str) -> list[dict[str, str]]:
    with (FIXTURE / name).open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def iso(s: str) -> date:
    return date.fromisoformat(s[:10])


def main() -> None:
    tickets = read_csv("remaining-work.csv")
    trains = read_csv("release-trains.csv")
    sprints = read_csv("sprint-calendar.csv")
    throughput = read_csv("throughput-history.csv")
    review = (FIXTURE / "review-and-stabilisation.md").read_text(encoding="utf-8")
    readme = (FIXTURE / "README.md").read_text(encoding="utf-8")

    as_of = iso(re.search(r"as of (\d{4}-\d{2}-\d{2})", review, re.I).group(1))
    open_rows = [r for r in tickets if r["status"] in OPEN]
    scope_rows = [r for r in open_rows if r["initiative"].strip().casefold() == "storage engine"]
    known_scope = [int(r["estimate_points"]) for r in scope_rows if r["estimate_points"].strip()]
    workstream_median = median(known_scope)
    remaining_points = sum(int(r["estimate_points"]) if r["estimate_points"].strip() else math.ceil(workstream_median) for r in scope_rows)

    ordinary = [int(r["completed_points"]) for r in throughput if r["kind"].strip().casefold() == "ordinary"]
    throughput_points = median(ordinary)
    sprints_needed = math.ceil(remaining_points / throughput_points)
    future_sprints = sorted((r for r in sprints if iso(r["start_date"]) > as_of), key=lambda r: r["start_date"])
    completion_sprint = future_sprints[sprints_needed - 1]
    completion_date = iso(completion_sprint["end_date"])
    likely = next(r for r in sorted(trains, key=lambda r: r["branch_date"]) if iso(r["branch_date"]) >= completion_date)
    ordered_trains = sorted(trains, key=lambda r: r["branch_date"])
    likely_i = ordered_trains.index(likely)
    committed = ordered_trains[likely_i + 1]

    decoys = [
        r["ticket_id"] for r in open_rows
        if "storage" in r["title"].casefold() and r["initiative"].strip().casefold() != "storage engine"
    ]
    blank_scope_ids = [r["ticket_id"] for r in scope_rows if not r["estimate_points"].strip()]
    dependency_note_id = next(r["ticket_id"] for r in scope_rows if r["depends_on"].strip())

    assertions = [
        {"id": "release-likely", "desc": "Most likely train is the first train whose branch follows the forecast completion.", "op": "equals", "path": "likely_release", "value": likely["version"]},
        {"id": "release-committed", "desc": "Customer promise accounts for the stabilisation train.", "op": "equals", "path": "committed_release", "value": committed["version"]},
        {"id": "likely-branch", "desc": "The likely train's branch date is reported, rather than its release date.", "op": "date", "path": "likely_branch_date", "value": likely["branch_date"], "tolDays": 0},
        {"id": "commit-date", "desc": "The committed customer release date comes from the following train.", "op": "date", "path": "committed_release_date", "value": committed["release_date"], "tolDays": 0},
        {"id": "scope-points", "desc": "Open Storage Engine work is sized with the documented blank-estimate rule.", "op": "number", "path": "remaining_points", "value": remaining_points, "tol": 0},
        {"id": "ordinary-throughput", "desc": "Forward throughput uses comparable ordinary sprints.", "op": "number", "path": "throughput_points_per_sprint", "value": throughput_points, "tol": 1},
        {"id": "sprint-count", "desc": "The forecast states the rounded-up sprint count.", "op": "number", "path": "sprints_needed", "value": sprints_needed, "tol": 0},
        {"id": "scope-decoy-excluded", "desc": "The storage-named ticket from another initiative is identified as excluded.", "op": "includes", "path": "excluded_tickets", "ids": decoys},
        {"id": "scope-kept", "desc": "Unestimated Storage Engine tickets are sized, not excluded from scope.", "op": "excludes", "path": "excluded_tickets", "ids": blank_scope_ids},
    ]
    key = {"output": "docs/storage-engine-forecast.md", "block": "forecast", "assertions": assertions}
    OUT.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"as_of": as_of.isoformat(), "scope_ids": [r["ticket_id"] for r in scope_rows], "remaining_points": remaining_points, "throughput": throughput_points, "sprints": sprints_needed, "completion_date": completion_date.isoformat(), "likely": likely, "committed": committed, "decoys": decoys, "blank_scope_ids": blank_scope_ids}, indent=2))


if __name__ == "__main__":
    main()
