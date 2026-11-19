#!/usr/bin/env python3
"""Overlay the authored planning facts on the ordinary export."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "fixture" / "tickets.json"
tickets = json.loads(path.read_text(encoding="utf-8"))
by_id = {ticket["id"]: ticket for ticket in tickets}

patches = {
    "MIG-014": {
        "title": "Map source schema aliases",
        "status": "Open",
        "team": "Data Foundations",
        "owner": "Asha Nair",
        "estimate_points": 8,
        "depends_on": [],
        "planned_sprint": "S4",
        "due_date": "",
        "comment": "source samples are in the migration bundle",
    },
    "MIG-032": {
        "title": "Build backfill planner",
        "status": "In Progress",
        "team": "Data Foundations",
        "owner": "Bruno Ives",
        "estimate_points": 13,
        "depends_on": ["MIG-014"],
        "planned_sprint": "S5",
        "due_date": "",
        "comment": "planner uses the accepted alias table",
    },
    "MIG-057": {
        "title": "Validate migrated partitions",
        "status": "Ready",
        "team": "Data Foundations",
        "owner": "Celia Park",
        "estimate_points": 8,
        "depends_on": ["MIG-032"],
        "planned_sprint": "S6",
        "due_date": "",
        "comment": "validation cases are staged",
    },
    "MIG-071": {
        "title": "Package cutover adapter",
        "status": "Open",
        "team": "Runtime Migration",
        "owner": "Dae Okafor",
        "estimate_points": 8,
        "depends_on": ["MIG-057"],
        "planned_sprint": "S7",
        "due_date": "",
        "comment": "adapter inputs follow the partition report",
    },
    "MIG-088": {
        "title": "Run rollback rehearsal",
        "status": "Open",
        "team": "Runtime Migration",
        "owner": "Elin Voss",
        "estimate_points": 5,
        "depends_on": ["MIG-071"],
        "planned_sprint": "S7",
        "due_date": "",
        "comment": "rehearsal uses the cutover adapter",
    },
    "MIG-109": {
        "title": "Record production rehearsal",
        "status": "Open",
        "team": "Release Operations",
        "owner": "Gio Santos",
        "estimate_points": 3,
        "depends_on": ["MIG-088"],
        "planned_sprint": "S8",
        "due_date": "",
        "comment": "release notes need the rehearsal record",
    },
    "MIG-126": {
        "title": "Accept release dependency",
        "status": "Open",
        "team": "Release Operations",
        "owner": "Hana Reed",
        "estimate_points": 2,
        "depends_on": ["MIG-109"],
        "planned_sprint": "S8",
        "due_date": "2027-04-14",
        "comment": "consumer requested acceptance before its cutoff",
    },
    "MIG-142": {
        "title": "Consolidate historical query reports",
        "status": "Open",
        "team": "Analytics",
        "owner": "Mina Cole",
        "estimate_points": 55,
        "depends_on": [],
        "planned_sprint": "S8",
        "due_date": "",
        "comment": "report examples are being collected",
    },
}

for ticket_id, patch in patches.items():
    by_id[ticket_id].update(patch)
path.write_text(json.dumps(tickets, indent=2) + "\n", encoding="utf-8")
