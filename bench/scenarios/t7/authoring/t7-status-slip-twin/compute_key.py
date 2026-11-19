#!/usr/bin/env python3
"""Compute the finance-numbers answer and its grading key from the fixture."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
TICKETS = FIXTURE / "tickets.csv"
ROADMAP = FIXTURE / "roadmap.md"
KEY_PATH = ROOT / "hidden" / "key.json"


def read_rows() -> list[dict[str, str]]:
    with TICKETS.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def points(row: dict[str, str]) -> int:
    value = row.get("estimate_points", "").strip()
    return int(value) if value else 0


def normalized_name(row: dict[str, str]) -> str:
    return row.get("assignee", "").strip()


def sprint_labels() -> list[str]:
    text = ROADMAP.read_text(encoding="utf-8")
    return re.findall(r"^\|\s*(S\d+)\s*\|", text, flags=re.MULTILINE)


def build_numbers(rows: list[dict[str, str]]) -> dict[str, object]:
    labels = sprint_labels()
    last_two = set(labels[-2:])
    assignees = sorted({normalized_name(row) for row in rows if normalized_name(row)})
    epics = sorted({row["epic"] for row in rows})
    open_statuses = {"To Do", "In Progress", "Blocked"}

    closed_points = {name: 0 for name in assignees}
    for row in rows:
        if (
            row["sprint"] in last_two
            and row["status"] == "Done"
            and row.get("reopened", "").strip().lower() != "true"
            and normalized_name(row)
        ):
            closed_points[normalized_name(row)] += points(row)

    open_tickets = {
        epic: sum(1 for row in rows if row["epic"] == epic and row["status"] in open_statuses)
        for epic in epics
    }
    total_open_points = sum(points(row) for row in rows if row["status"] in open_statuses)
    return {
        "closed_points_by_assignee": closed_points,
        "open_tickets_by_epic": open_tickets,
        "total_open_points": total_open_points,
    }


def build_key(rows: list[dict[str, str]], numbers: dict[str, object]) -> dict[str, object]:
    assertions: list[dict[str, object]] = [
        {
            "id": "open-points-total",
            "desc": "total open points treats blank estimates as zero",
            "op": "number",
            "path": "total_open_points",
            "value": numbers["total_open_points"],
            "tol": 0,
        }
    ]

    for epic, count in numbers["open_tickets_by_epic"].items():
        assertions.append(
            {
                "id": "open-epic-" + re.sub(r"[^a-z0-9]+", "-", epic.lower()).strip("-"),
                "desc": f"open ticket count for {epic}",
                "op": "number",
                "path": f"open_tickets_by_epic.{epic}",
                "value": count,
                "tol": 0,
            }
        )

    # These values cover both normalization and the reopened/blank-estimate cases
    # without making the answer depend on an arbitrary map ordering.
    for name in ["Asha Iyer", "Jules Ray", "Eve Grant", "Lana Price", "Nia Cole", "Dev Patel"]:
        assertions.append(
            {
                "id": "closed-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
                "desc": f"closed points for {name} across the last two sprint labels",
                "op": "number",
                "path": f"closed_points_by_assignee.{name}",
                "value": numbers["closed_points_by_assignee"][name],
                "tol": 0,
            }
        )

    return {"output": "reports/finance-numbers.md", "block": "numbers", "assertions": assertions}


def main() -> None:
    rows = read_rows()
    numbers = build_numbers(rows)
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    KEY_PATH.write_text(json.dumps(build_key(rows, numbers), indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
