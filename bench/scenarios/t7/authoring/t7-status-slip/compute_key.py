#!/usr/bin/env python3
"""Derive the hidden grading key only from the supplied fixture files."""
from __future__ import annotations

import csv
import json
import math
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
OUT = ROOT / "hidden" / "key.json"


def read_csv(name: str) -> list[dict[str, str]]:
    with (FIXTURE / name).open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def parse_roadmap() -> tuple[dict[str, str], list[dict[str, str]]]:
    text = (FIXTURE / "roadmap.md").read_text(encoding="utf-8")
    values: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r"^([a-z_]+):\s*(.+?)\s*$", line)
        if match:
            values[match.group(1)] = match.group(2)
    sprints: list[dict[str, str]] = []
    for line in text.splitlines():
        match = re.match(r"^\|\s*(S\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|", line)
        if match:
            sprints.append({"name": match.group(1), "start": match.group(2), "end": match.group(3)})
    return values, sprints


def as_date(value: str) -> date:
    return date.fromisoformat(value.strip())


def points(row: dict[str, str]) -> float:
    raw = row.get("estimate_points", "").strip()
    return float(raw) if raw else 0.0


def is_open(row: dict[str, str]) -> bool:
    return row.get("status", "").strip().lower() in {"to do", "in progress", "blocked"}


def format_number(value: float) -> int | float:
    return int(value) if value.is_integer() else round(value, 4)


tickets = read_csv("tickets.csv")
roadmap, sprints = parse_roadmap()
by_id = {row["id"].strip(): row for row in tickets}
launch_epic = roadmap["launch_epic"]

# Find the longest open dependency chain ending at a launch-epic ticket.
# Dependencies may cross epic boundaries, so an upstream prerequisite can be
# outside the launch epic while still controlling a launch ticket.
open_by_id = {
    row["id"].strip(): row for row in tickets if is_open(row)
}
open_launch = {
    ticket_id: row for ticket_id, row in open_by_id.items()
    if row.get("epic", "").strip() == launch_epic
}

def dependencies(row: dict[str, str]) -> list[str]:
    return [x.strip() for x in row.get("depends_on", "").split(";") if x.strip()]

memo: dict[str, tuple[float, list[str]]] = {}
visiting: set[str] = set()


def best_chain(ticket_id: str) -> tuple[float, list[str]]:
    if ticket_id in memo:
        return memo[ticket_id]
    if ticket_id in visiting:  # The export should be acyclic; avoid a bad cycle looping.
        return 0.0, []
    visiting.add(ticket_id)
    row = open_by_id[ticket_id]
    best_score = 0.0
    best_prefix: list[str] = []
    for dep in dependencies(row):
        if dep in open_by_id:
            score, prefix = best_chain(dep)
            if score > best_score or (score == best_score and len(prefix) > len(best_prefix)):
                best_score, best_prefix = score, prefix
    visiting.remove(ticket_id)
    answer = (best_score + points(row), best_prefix + [ticket_id])
    memo[ticket_id] = answer
    return answer

chains = [best_chain(ticket_id) for ticket_id in open_launch]
remaining, critical_path = max(chains, key=lambda pair: (pair[0], len(pair[1]), pair[1]))
remaining = format_number(remaining)

# Find due-date inversions in dependency links.
date_conflicts: list[tuple[str, str]] = []
for row in tickets:
    if not is_open(row):
        continue
    for dep in dependencies(row):
        if dep in by_id and as_date(row["due"]) < as_date(by_id[dep]["due"]):
            date_conflicts.append((row["id"].strip(), dep))

# Locate the next sprint and calculate person-level adjusted capacity.
as_of = as_date(roadmap["as_of"])
current_index = next(i for i, sprint in enumerate(sprints)
                     if as_date(sprint["start"]) <= as_of <= as_date(sprint["end"]))
next_index = current_index + 1
next_sprint = sprints[next_index]["name"]
capacity_rows = read_csv("team-capacity.csv")
holiday_rows = read_csv("holidays.csv")

holiday_dates: dict[str, list[date]] = defaultdict(list)
for row in holiday_rows:
    holiday_dates[row["assignee"].strip()].append(as_date(row["date"]))

sprint_by_name = {s["name"]: s for s in sprints}
def adjusted_capacity(row: dict[str, str]) -> float:
    raw = float(row["capacity_points"])
    sprint = sprint_by_name[row["sprint"].strip()]
    absences = sum(
        sprint["name"] == row["sprint"].strip()
        and as_date(sprint["start"]) <= d <= as_date(sprint["end"])
        for d in holiday_dates.get(row["assignee"].strip(), [])
    )
    return raw * (1.0 - absences / 10.0)

capacity_by_sprint: dict[str, float | int] = {}
for sprint in sprints:
    total = sum(adjusted_capacity(row) for row in capacity_rows if row["sprint"].strip() == sprint["name"])
    capacity_by_sprint[sprint["name"]] = format_number(total)

assigned_next: dict[str, list[dict[str, str]]] = defaultdict(list)
for row in tickets:
    assignee = row.get("assignee", "").strip()
    if assignee and row.get("sprint", "").strip() == next_sprint and is_open(row) and row.get("estimate_points", "").strip():
        assigned_next[assignee].append(row)

capacity_by_person = {
    row["assignee"].strip(): adjusted_capacity(row)
    for row in capacity_rows if row["sprint"].strip() == next_sprint
}
overloaded = []
for assignee, assigned in assigned_next.items():
    assigned_points = sum(points(row) for row in assigned)
    if assigned_points > capacity_by_person.get(assignee, 0):
        overloaded.append((assigned_points - capacity_by_person[assignee], assignee, assigned))
overloaded.sort(reverse=True, key=lambda item: (item[0], item[1]))
_, overload_owner, overload_rows = overloaded[0]
overload_ids = [row["id"].strip() for row in overload_rows]

# Sum launch work created strictly after the documented lock date.
scope_lock = as_date(roadmap["scope_lock_date"])
scope_rows = [
    row for row in tickets
    if row.get("epic", "").strip() == launch_epic and as_date(row["created"]) > scope_lock
]
scope_added = format_number(sum(points(row) for row in scope_rows))

velocity = int(roadmap["velocity_points_per_sprint"])
longest_chain_sprints = math.ceil(float(remaining) / velocity)
all_launch_points = sum(points(row) for row in open_launch.values())
all_launch_sprints = math.ceil(all_launch_points / velocity)
first_finish_index = next_index + longest_chain_sprints - 1
last_finish_index = next_index + all_launch_sprints - 1
first_finish = as_date(sprints[first_finish_index]["end"])
last_finish = as_date(sprints[last_finish_index]["end"])
# Without a single mandated forecasting convention, key the midpoint of the
# defensible range: the longest chain finish through the all-launch-work finish.
sprints_needed = format_number((longest_chain_sprints + all_launch_sprints) / 2)
revised_tol_days = (last_finish - first_finish).days // 2
revised_launch = (first_finish + (last_finish - first_finish) / 2).isoformat()

# The key describes the structured block only. Ticket IDs are all obtained from
# the computations above, so a fixture edit changes both the answer and key.
decoy_id = next(row["id"].strip() for row in tickets
                if row.get("status", "").strip().lower() == "blocked"
                and any(by_id.get(dep, {}).get("status", "").strip().lower() == "done"
                        for dep in dependencies(row)))
critical_first = critical_path[0]
scope_ids = [row["id"].strip() for row in scope_rows]
conflict_ids = list(dict.fromkeys([x for pair in date_conflicts for x in pair]))
union_ids = list(dict.fromkeys(critical_path + conflict_ids + overload_ids + scope_ids))

assertions = [
    {"id": "overall-red", "desc": "The slipped launch is called red", "op": "equals", "path": "overall", "value": "red"},
    {"id": "risk-list-precision", "desc": "Risk list stays focused on seeded issues", "op": "precision", "path": "risks", "field": "tickets", "ids": union_ids, "min": 0.6, "maxCount": 8},
    {"id": "critical-risk-cites-path", "desc": "A risk names the first prerequisite on the critical chain", "op": "cites", "path": "risks", "field": "tickets", "ids": [critical_first]},
    {"id": "critical-path-order", "desc": "The critical chain runs from prerequisite to launch", "op": "order", "path": "critical_path", "ids": critical_path},
    {"id": "critical-path-points", "desc": "Remaining points on the chain are reported", "op": "number", "path": "reasoning.remaining_points_on_critical_path", "value": remaining, "tol": 0.1},
    {"id": "velocity", "desc": "The stated team velocity matches the roadmap", "op": "number", "path": "reasoning.team_velocity_points_per_sprint", "value": velocity, "tol": 0.1},
    {"id": "sprints-needed", "desc": "The required sprint count is reported", "op": "number", "path": "reasoning.sprints_needed", "value": sprints_needed, "tol": 0.5},
    {"id": "revised-launch", "desc": "The revised date follows the sprint calendar", "op": "date", "path": "revised_launch_date", "value": revised_launch, "tolDays": revised_tol_days},
    {"id": "next-sprint-capacity", "desc": "Adjusted next-sprint capacity is reported", "op": "number", "path": f"capacity_by_sprint.{next_sprint}", "value": capacity_by_sprint[next_sprint], "tol": 0.1},
    {"id": "date-conflict-cited", "desc": "The due-date inversion is named", "op": "cites", "path": "risks", "field": "tickets", "ids": conflict_ids, "min": 2},
    {"id": "date-conflict-kind", "desc": "The inversion has the date-conflict kind", "op": "cites", "path": "risks", "field": "tickets", "ids": conflict_ids, "min": 2, "where": {"kind": "date-conflict"}},
    {"id": "over-allocation-cited", "desc": "The overloaded person's work is named", "op": "cites", "path": "risks", "field": "tickets", "ids": overload_ids},
    {"id": "over-allocation-owner", "desc": "The overloaded owner is identified", "op": "cites", "path": "risks", "field": "tickets", "ids": overload_ids, "where": {"owner": overload_owner}},
    {"id": "scope-cited", "desc": "Late-added launch work is named", "op": "cites", "path": "risks", "field": "tickets", "ids": scope_ids},
    {"id": "scope-total", "desc": "Late-added points are summed", "op": "number", "path": "scope_added_after_lock_points", "value": scope_added, "tol": 0.1},
    {"id": "scope-kind", "desc": "Late-added work has the scope-creep kind", "op": "cites", "path": "risks", "field": "tickets", "ids": scope_ids, "where": {"kind": "scope-creep"}},
    {"id": "done-blocker-decoy-absent", "desc": "The blocked item with a done dependency is not escalated", "op": "absent", "path": "risks", "field": "tickets", "ids": [decoy_id]},
]

key = {"output": "status/leadership-update.md", "block": "status", "assertions": assertions}
OUT.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
print(json.dumps({
    "critical_path": critical_path,
    "remaining": remaining,
    "date_conflicts": date_conflicts,
    "overload_owner": overload_owner,
    "overload_ids": overload_ids,
    "scope_ids": scope_ids,
    "scope_added": scope_added,
    "revised_launch": revised_launch,
    "capacity_by_sprint": capacity_by_sprint,
    "decoy": decoy_id,
}, indent=2))
