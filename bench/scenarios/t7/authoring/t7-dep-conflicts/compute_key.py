#!/usr/bin/env python3
"""Compute the grading key from fixture data only."""
from __future__ import annotations

import csv
import json
import re
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
OUT = ROOT / "hidden" / "key.json"
OPEN = {"open", "in progress", "review", "blocked"}


def read_tickets() -> dict[str, dict[str, str]]:
    with (FIXTURE / "data" / "ticket-export.csv").open(newline="", encoding="utf-8") as f:
        return {row["id"].strip(): row for row in csv.DictReader(f)}


def read_dependencies() -> list[dict[str, str]]:
    with (FIXTURE / "data" / "dependency-register.csv").open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def is_open(row: dict[str, str]) -> bool:
    return row.get("status", "").strip().casefold() in OPEN


def read_roadmap() -> list[dict[str, str]]:
    rows = []
    text = (FIXTURE / "roadmap.md").read_text(encoding="utf-8")
    for line in text.splitlines():
        if not line.startswith("|") or line.startswith("| ---") or line.startswith("| team"):
            continue
        cells = [x.strip() for x in line.strip().strip("|").split("|")]
        if len(cells) == 6:
            rows.append(dict(zip(["quarter", "team", "milestone", "status", "target_date", "tickets"], cells)))
    return rows


def key_assertions(conflicts, cycles, driver, launch_planned, launch_if_unresolved, stale):
    by_pair = {(x["producer"], x["consumer"]): x for x in conflicts}
    assertions = []
    pairs = [("ATL-007", "BCN-012"), ("CND-009", "BCN-024"), ("CND-017", "DLT-011")]
    # One check for all three conflicts (version 3, D-86): a list that names only the obvious ones earns nothing here.
    assertions.append({
        "id": "conflicts-all-named",
        "desc": "Names all three late dependencies",
        "op": "includes", "path": "conflicts", "ids": [p for p, _ in pairs],
    })
    for producer, consumer in pairs:
        item = by_pair[(producer, consumer)]
        assertions.append({
            "id": f"conflict-{producer.lower()}-dates",
            "desc": f"Reports dates and lateness for {producer} to {consumer}",
            "op": "cites", "path": "conflicts", "field": "producer", "ids": [producer],
            "where": {"consumer": consumer, "producer_due": item["producer_due"],
                      "needed_by": item["needed_by"], "days_late": item["days_late"]},
        })
    assertions.extend([
        {"id": "cycle-between-beacon-and-cinder", "desc": "Reports the two-team dependency cycle",
         "op": "includes", "path": "cycles", "ids": ["BCN-020", "CND-020"]},
        {"id": "launch-driver-producer", "desc": "Identifies the dependency that drives the launch",
         "op": "equals", "path": "launch_driver.producer", "value": driver["producer"]},
        {"id": "launch-driver-consumer", "desc": "Identifies the launch dependency consumer",
         "op": "equals", "path": "launch_driver.consumer", "value": driver["consumer"]},
        {"id": "planned-launch-date", "desc": "Reports the roadmap launch date",
         "op": "date", "path": "launch_date_planned", "value": launch_planned, "tolDays": 0},
        {"id": "unresolved-launch-date", "desc": "Reports the launch date if the driver remains unresolved",
         "op": "date", "path": "launch_date_if_unresolved", "value": launch_if_unresolved, "tolDays": 1},
        {"id": "stale-done-milestone", "desc": "Names a milestone marked done while linked work remains open",
         "op": "includes", "path": "stale_milestones", "ids": stale},
        {"id": "cancelled-producer-decoy-absent", "desc": "Does not treat the cancelled producer as a live conflict",
         "op": "absent", "path": "conflicts", "field": "producer", "ids": ["ATL-018"]},
        {"id": "conflict-list-precision", "desc": "Keeps the conflict list focused on actual late dependencies",
         "op": "precision", "path": "conflicts", "field": None,
         "ids": ["ATL-007", "BCN-012", "CND-009", "BCN-024", "CND-017", "DLT-011"],
         "min": 0.5, "maxCount": 6},
    ])
    # The grader treats a null field as no field, so omit it from the serialized op.
    for a in assertions:
        if a.get("field") is None:
            a.pop("field", None)
    return assertions


def main() -> None:
    tickets = read_tickets()
    deps = read_dependencies()
    roadmap = read_roadmap()
    graph: dict[str, list[str]] = {}
    for row in deps:
        graph.setdefault(row["producer_ticket"], []).append(row["consumer_ticket"])

    conflicts = []
    for row in deps:
        producer = row["producer_ticket"].strip()
        consumer = row["consumer_ticket"].strip()
        p = tickets[producer]
        if p.get("status", "").strip().casefold() == "cancelled":
            continue
        producer_due = date.fromisoformat(p["due_date"])
        needed = date.fromisoformat(row["needed_by"])
        if producer_due > needed:
            conflicts.append({
                "producer": producer,
                "consumer": consumer,
                "producer_due": producer_due.isoformat(),
                "needed_by": needed.isoformat(),
                "days_late": (producer_due - needed).days,
            })
    conflicts.sort(key=lambda x: (x["producer"], x["consumer"]))

    # Find simple directed cycles, omitting the repeated closing node.
    cycles = []
    seen_cycles = set()
    def walk(node, stack, active):
        active.add(node)
        stack.append(node)
        for nxt in graph.get(node, []):
            if nxt in active:
                cycle = tuple(stack[stack.index(nxt):])
                canonical = min(cycle[i:] + cycle[:i] for i in range(len(cycle)))
                if canonical not in seen_cycles:
                    seen_cycles.add(canonical)
                    cycles.append(list(canonical))
            elif nxt not in stack:
                walk(nxt, stack, active)
        stack.pop()
        active.remove(node)
    for node in sorted(graph):
        walk(node, [], set())
    cycles.sort()

    launch_row = next(r for r in roadmap if "customer launch" in r["milestone"].casefold())
    launch_ticket = launch_row["tickets"].split(",")[0].strip()
    planned = date.fromisoformat(launch_row["target_date"])
    memo: dict[tuple[str, tuple[str, ...]], int] = {}
    def tail(node: str, stack: tuple[str, ...] = ()) -> int:
        if node == launch_ticket:
            return 0
        if node in stack:
            return -10**6
        key = (node, stack)
        if key in memo:
            return memo[key]
        best = -10**6
        for nxt in graph.get(node, []):
            best = max(best, 1 + tail(nxt, stack + (node,)))
        memo[key] = best
        return best

    scored = []
    for item in conflicts:
        score = tail(item["consumer"])
        scored.append((score, item))
    scored = [x for x in scored if x[0] > -10**5]
    score, driver = max(scored, key=lambda x: (x[0], -x[1]["days_late"]))
    unresolved = planned + timedelta(days=driver["days_late"])

    stale = []
    for row in roadmap:
        if row["status"].strip().casefold() != "done":
            continue
        ids = [x.strip() for x in row["tickets"].split(",") if x.strip()]
        if any(tid in tickets and is_open(tickets[tid]) for tid in ids):
            stale.append(row["milestone"])

    key = {
        "output": "plan/dependency-review.md",
        "block": "conflicts",
        "assertions": key_assertions(conflicts, cycles, driver, planned.isoformat(), unresolved.isoformat(), stale),
    }
    OUT.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"conflicts": conflicts, "cycles": cycles, "driver": driver, "chain_score": score,
                      "launch_date_if_unresolved": unresolved.isoformat(), "stale": stale}, indent=2))


if __name__ == "__main__":
    main()
