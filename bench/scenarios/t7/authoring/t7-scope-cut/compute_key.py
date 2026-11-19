#!/usr/bin/env python3
"""Derive the grading key solely from the synthetic fixture."""
from __future__ import annotations

import csv
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
HIDDEN = ROOT / "hidden"
ACTIVE = {"Open", "In Progress", "Review"}


def read_tickets() -> list[dict[str, str]]:
    with (FIXTURE / "tickets.csv").open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def points(row: dict[str, str]) -> int:
    value = row.get("points", "").strip()
    return int(value) if value else 0


def ids_in(value: str) -> list[str]:
    return re.findall(r"PRJ-\d+", value or "", flags=re.IGNORECASE)


def split_is_offset(row: dict[str, str], by_id: dict[str, dict[str, str]], lock: date) -> bool:
    parent_id = row.get("parent_id", "").strip()
    if not parent_id or parent_id not in by_id:
        return False
    parent = by_id[parent_id]
    if date.fromisoformat(parent["created"]) > lock:
        return False
    # The parent comment is the export's record of the estimate moved to the split.
    pattern = rf"splitting\s+{points(row)}\s+points\s+to\s+{re.escape(row['ticket_id'])}\b"
    return re.search(pattern, parent.get("comments", ""), flags=re.IGNORECASE) is not None


def main() -> None:
    tickets = read_tickets()
    by_id = {row["ticket_id"]: row for row in tickets}
    roadmap = (FIXTURE / "roadmap.md").read_text(encoding="utf-8")
    lock = date.fromisoformat(re.search(r"Scope lock:\s*\*\*(\d{4}-\d{2}-\d{2})", roadmap).group(1))
    launch = re.search(r"Launch date:\s*\*\*(\d{4}-\d{2}-\d{2})", roadmap).group(1)

    added_rows = []
    for row in tickets:
        if row["status"] not in ACTIVE or date.fromisoformat(row["created"]) <= lock:
            continue
        if split_is_offset(row, by_id, lock):
            continue
        added_rows.append(row)
    added_rows.sort(key=lambda r: (r["created"], r["ticket_id"]))
    added_ids = [row["ticket_id"] for row in added_rows]
    added_points = sum(points(row) for row in added_rows)

    with (FIXTURE / "capacity.csv").open(newline="", encoding="utf-8") as handle:
        capacity = list(csv.DictReader(handle))
    slack = sum(
        max(int(row["capacity_points"]) - int(row["holiday_points_lost"]) - int(row["committed_points"]), 0)
        for row in capacity
    )
    points_to_cut = max(added_points - slack, 0)

    stretch = [
        row for row in tickets
        if row["status"] in ACTIVE
        and date.fromisoformat(row["created"]) <= lock
        and "stretch" in {part.strip().lower() for part in row.get("labels", "").split(",")}
    ]
    must_have = {
        row["ticket_id"] for row in tickets
        if "must-have" in {part.strip().lower() for part in row.get("labels", "").split(",")}
    }
    blocked = {
        row["ticket_id"] for row in stretch
        if any(
            row["ticket_id"] in ids_in(other.get("depends_on", ""))
            for other in tickets if other["ticket_id"] in must_have and other["status"] in ACTIVE
        )
    }
    keep_ids = sorted(blocked, key=lambda value: int(value.split("-")[1]))
    candidates = sorted(
        [row for row in stretch if row["ticket_id"] not in blocked],
        key=lambda row: int(row["ticket_id"].split("-")[1]),
    )
    cut_ids: list[str] = []
    cut_total = 0
    for row in candidates:
        if cut_total >= points_to_cut:
            break
        cut_ids.append(row["ticket_id"])
        cut_total += points(row)
    if cut_total != points_to_cut:
        raise RuntimeError(f"stretch candidates do not exactly cover cut target: {cut_total} != {points_to_cut}")

    requests = (FIXTURE / "product-requests.md").read_text(encoding="utf-8")
    cannot_cut = re.findall(r"Customer commitment:\s*\*\*(PRJ-\d+)\*\*", requests, flags=re.IGNORECASE)

    key = {
        "output": "plan/scope-replan.md",
        "block": "replan",
        "assertions": [
            {"id": "added-core", "desc": "Names the first group of net-new active tickets", "op": "includes", "path": "added_after_lock", "ids": ["PRJ-1008", "PRJ-1031", "PRJ-1064"]},
            {"id": "added-later", "desc": "Names the second group of net-new active tickets", "op": "includes", "path": "added_after_lock", "ids": ["PRJ-1097", "PRJ-1128", "PRJ-1156"]},
            {"id": "added-precision", "desc": "Keeps the added-work list focused", "op": "precision", "path": "added_after_lock", "ids": added_ids, "min": 0.8, "maxCount": 8},
            {"id": "split-decoy-one", "desc": "Does not count the first zero-net bug split", "op": "absent", "path": "added_after_lock", "ids": ["PRJ-1019"]},
            {"id": "split-decoy-two", "desc": "Does not count the second zero-net bug split", "op": "absent", "path": "added_after_lock", "ids": ["PRJ-1073"]},
            {"id": "added-points", "desc": "Totals net-new points", "op": "number", "path": "added_points", "value": added_points, "tol": 0},
            {"id": "slack", "desc": "Totals remaining holiday-adjusted slack", "op": "number", "path": "slack_points", "value": slack, "tol": 0},
            {"id": "cut-total", "desc": "Calculates the required reduction", "op": "number", "path": "points_to_cut", "value": points_to_cut, "tol": 0},
            {"id": "cut-items", "desc": "Names the items that supply the reduction", "op": "includes", "path": "cut", "ids": cut_ids},
            {"id": "cut-focus", "desc": "Keeps the dependency-protected stretch item out of cuts", "op": "excludes", "path": "cut", "ids": keep_ids},
            {"id": "keep-protected", "desc": "Keeps the optional-looking dependency", "op": "includes", "path": "keep_despite_optional", "ids": keep_ids},
            {"id": "contract", "desc": "Names the customer commitment that cannot move", "op": "includes", "path": "cannot_cut", "ids": cannot_cut},
            {"id": "contract-not-cut", "desc": "Does not put the customer commitment in cuts", "op": "excludes", "path": "cut", "ids": cannot_cut},
            {"id": "launch-date", "desc": "Preserves the fixed launch date", "op": "date", "path": "date", "value": launch, "tolDays": 0},
            {"id": "cut-precision", "desc": "Keeps the cut list concise", "op": "precision", "path": "cut", "ids": cut_ids, "min": 0.5, "maxCount": 4},
        ],
    }
    HIDDEN.mkdir(parents=True, exist_ok=True)
    (HIDDEN / "key.json").write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
