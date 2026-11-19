#!/usr/bin/env python3
"""Derive the hidden answer only from the visible fixture."""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
KEY_PATH = ROOT / "hidden" / "key.json"
TEAM_FILES = [("ARC", "data/arc-export.csv"), ("BEAM", "data/beam-export.csv"), ("COVE", "data/cove-export.csv")]
OPEN = {"new", "ready", "in progress", "blocked"}


def read_rows() -> tuple[list[dict], dict[str, list[dict]]]:
    all_rows: list[dict] = []
    by_team: dict[str, list[dict]] = {}
    for team, rel in TEAM_FILES:
        with (FIXTURE / rel).open(newline="", encoding="utf-8") as f:
            rows = [dict(r, team=team) for r in csv.DictReader(f)]
        by_team[team] = rows
        all_rows.extend(rows)
    return all_rows, by_team


def points(row: dict) -> int:
    try:
        return int(row.get("points", "") or 0)
    except ValueError:
        return 0


def is_open(row: dict) -> bool:
    return row.get("status", "").strip().lower() in OPEN


def build_graph(rows: list[dict]) -> dict[str, set[str]]:
    ids = {r["ticket_id"] for r in rows}
    edges: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        source = r["ticket_id"]
        for target in re.findall(r"\b[A-Z]+-\d+\b", r.get("links", "")):
            if target in ids and re.search(r"\bblocks\b", r.get("links", ""), re.I):
                edges[source].add(target)
        for target in re.findall(r"\b[A-Z]+-\d+\b", r.get("depends_on", "")):
            if target in ids:
                edges[target].add(source)
        for target in re.findall(r"\b[A-Z]+-\d+\b", r.get("comments", "")):
            if target in ids and re.search(r"\bneeds\s+" + re.escape(target), r.get("comments", ""), re.I):
                edges[target].add(source)
    return edges


def longest_path(edges: dict[str, set[str]], rows_by_id: dict[str, dict]) -> list[str]:
    # The fixture's dependency graph is acyclic. Ties are resolved by the
    # first appearance in the exports so the answer remains deterministic.
    visiting: set[str] = set()
    memo: dict[str, list[str]] = {}

    def walk(node: str) -> list[str]:
        if node in memo:
            return memo[node]
        if node in visiting:
            return [node]
        visiting.add(node)
        tails = [walk(nxt) for nxt in edges.get(node, ())]
        visiting.remove(node)
        best_tail = max(tails, key=len, default=[])
        memo[node] = [node] + best_tail
        return memo[node]

    candidates = [r["ticket_id"] for r in rows_by_id.values() if r.get("initiative") == "Relay" and is_open(r)]
    best: list[str] = []
    for node in candidates:
        path = walk(node)
        if len(path) > len(best):
            best = path
    return best


def reported_color(team: str) -> str:
    text = (FIXTURE / "docs" / f"status-{team.lower()}.md").read_text(encoding="utf-8")
    m = re.search(r"reports\s+(green|amber|red)", text, re.I)
    return m.group(1).lower() if m else "green"


def derive() -> dict:
    all_rows, by_team = read_rows()
    # The first occurrence is authoritative for duplicate assignment.
    first_by_id: dict[str, dict] = {}
    occurrences: dict[str, list[dict]] = defaultdict(list)
    for row in all_rows:
        occurrences[row["ticket_id"]].append(row)
        first_by_id.setdefault(row["ticket_id"], row)

    duplicate_groups = [[ticket_id] for ticket_id, occurrences_for_id in occurrences.items() if len(occurrences_for_id) > 1]
    graph = build_graph(all_rows)
    path = longest_path(graph, first_by_id)
    blocked = {r["ticket_id"] for r in first_by_id.values() if r.get("initiative") == "Relay" and is_open(r) and r.get("status", "").strip().lower() == "blocked"}

    # A row is affected when it can reach a blocked row or a blocked row can
    # reach it along the dependency direction. This uses the documented color
    # convention and keeps downstream and upstream owners visible.
    reverse: dict[str, set[str]] = defaultdict(set)
    for src, targets in graph.items():
        for dst in targets:
            reverse[dst].add(src)
    affected: set[str] = set(blocked)
    frontier = list(blocked)
    while frontier:
        node = frontier.pop()
        for neighbor in graph.get(node, set()) | reverse.get(node, set()):
            if neighbor not in affected:
                affected.add(neighbor)
                frontier.append(neighbor)

    teams: dict[str, dict] = {}
    for team, _ in TEAM_FILES:
        owned = [r for r in first_by_id.values() if r["team"] == team and r.get("initiative") == "Relay" and is_open(r)]
        remaining = sum(points(r) for r in owned)
        if any(r["ticket_id"] in blocked for r in owned):
            actual = "red"
        elif any(r["ticket_id"] in affected for r in owned):
            actual = "amber"
        else:
            actual = "green"
        teams[team] = {"reported": reported_color(team), "actual": actual, "remaining_points": remaining}

    total_remaining = sum(v["remaining_points"] for v in teams.values())
    with (FIXTURE / "data/capacity.csv").open(newline="", encoding="utf-8") as f:
        capacity = list(csv.DictReader(f))
    sprint_totals: dict[str, int] = defaultdict(int)
    sprint_ends: dict[str, str] = {}
    for row in capacity:
        sprint_totals[row["sprint"]] += int(row["available_points"] or 0)
        sprint_ends[row["sprint"]] = row["end"]
    covered = 0
    forecast = ""
    for sprint in sorted(sprint_totals, key=lambda s: int(s.split("-")[1])):
        covered += sprint_totals[sprint]
        if covered >= total_remaining:
            forecast = sprint_ends[sprint]
            break

    roadmap = (FIXTURE / "roadmap.md").read_text(encoding="utf-8")
    target_match = re.search(r"executive target is \*\*(\d{4}-\d{2}-\d{2})\*\*", roadmap)
    if not target_match:
        raise ValueError("roadmap has no executive target")
    target_date = target_match.group(1)
    decoy_ids = [r["ticket_id"] for r in first_by_id.values() if r.get("initiative") != "Relay" and r.get("status", "").strip().lower() == "blocked"]
    if not decoy_ids:
        raise ValueError("fixture has no blocked out-of-scope decoy")
    overall = "red" if any(v["actual"] == "red" for v in teams.values()) else "amber" if any(v["actual"] == "amber" for v in teams.values()) else "green"
    milestone_at_risk = f"Relay milestone is at risk: forecast {forecast} versus target {target_date}."
    key = {
        "output": "status/program-rollup.md",
        "block": "program-status",
        "assertions": [
            {"id": "overall-color", "desc": "program is red", "op": "equals", "path": "overall", "value": overall},
            {"id": "arc-actual", "desc": "ARC actual color", "op": "equals", "path": "teams.ARC.actual", "value": teams["ARC"]["actual"]},
            {"id": "beam-actual", "desc": "BEAM actual color", "op": "equals", "path": "teams.BEAM.actual", "value": teams["BEAM"]["actual"]},
            {"id": "cove-actual", "desc": "COVE actual color", "op": "equals", "path": "teams.COVE.actual", "value": teams["COVE"]["actual"]},
            {"id": "arc-points", "desc": "ARC remaining points", "op": "number", "path": "teams.ARC.remaining_points", "value": teams["ARC"]["remaining_points"], "tol": 0},
            {"id": "beam-points", "desc": "BEAM remaining points", "op": "number", "path": "teams.BEAM.remaining_points", "value": teams["BEAM"]["remaining_points"], "tol": 0},
            {"id": "cove-points", "desc": "COVE remaining points", "op": "number", "path": "teams.COVE.remaining_points", "value": teams["COVE"]["remaining_points"], "tol": 0},
            {"id": "critical-path-members", "desc": "critical path names its chain", "op": "includes", "path": "critical_path", "ids": path},
            {"id": "critical-path-order", "desc": "critical path keeps dependency order", "op": "order", "path": "critical_path", "ids": path},
            {"id": "blocker-citations", "desc": "blocker cites linked work", "op": "cites", "path": "cross_team_blockers", "field": "tickets", "ids": path, "min": 3},
            {"id": "blocker-precision", "desc": "blocker list is focused", "op": "precision", "path": "cross_team_blockers", "field": "tickets", "ids": path, "min": 0.5, "maxCount": 2},
            {"id": "duplicate-ticket", "desc": "duplicate ticket is disclosed", "op": "includes", "path": "duplicates", "ids": duplicate_groups[0]},
            {"id": "decoy-off-path", "desc": "maintenance decoy is off the path", "op": "absent", "path": "critical_path", "ids": decoy_ids},
            {"id": "decoy-off-blockers", "desc": "maintenance decoy is not a program blocker", "op": "absent", "path": "cross_team_blockers", "field": "tickets", "ids": decoy_ids},
            {"id": "forecast", "desc": "capacity forecast date", "op": "date", "path": "forecast_date", "value": forecast, "tolDays": 14},
        ],
    }
    return key


def main() -> None:
    KEY_PATH.write_text(json.dumps(derive(), indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
