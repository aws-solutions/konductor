#!/usr/bin/env python3
"""Derive the hidden grading key entirely from the working-folder inputs."""
from __future__ import annotations

import csv
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
OUT = ROOT / "hidden" / "key.json"


def read_text(name: str) -> str:
    return (FIXTURE / name).read_text(encoding="utf-8")


def iso_date(text: str) -> str:
    match = re.search(r"20\d\d-\d\d-\d\d", text)
    if not match:
        raise ValueError(f"no ISO date in {text!r}")
    return match.group(0)


def load_tickets() -> list[dict]:
    data = json.loads(read_text("ticket-export.json"))
    return data["tickets"]


def longest_chain(tickets: list[dict]) -> list[str]:
    by_id = {t["id"]: t for t in tickets}
    open_statuses = {"Open", "In Progress", "Ready", "Review", "Blocked"}
    active = {t["id"] for t in tickets if t["status"] in open_statuses}
    memo: dict[str, list[str]] = {}

    def chain(ticket_id: str, visiting: set[str]) -> list[str]:
        if ticket_id in memo:
            return memo[ticket_id]
        if ticket_id in visiting:
            raise ValueError("dependency cycle")
        visiting.add(ticket_id)
        ticket = by_id[ticket_id]
        predecessors = [d for d in ticket.get("depends_on", []) if d in active]
        candidates = [chain(d, visiting) for d in predecessors]
        best = max(candidates, key=lambda c: (len(c), c), default=[])
        result = best + [ticket_id]
        visiting.remove(ticket_id)
        memo[ticket_id] = result
        return result

    paths = [chain(ticket_id, set()) for ticket_id in active]
    return max(paths, key=lambda c: (len(c), c))


def main() -> None:
    tickets = load_tickets()
    roadmap = read_text("roadmap.md")
    contract = read_text("vendor-contract.md")
    org = read_text("org-chart.md")
    notes = "\n".join(p.read_text(encoding="utf-8") for p in sorted((FIXTURE / "meeting-notes").glob("*.md")))

    open_statuses = {"Open", "In Progress", "Ready", "Review", "Blocked"}
    open_tickets = [t for t in tickets if t["status"] in open_statuses]
    bridge = [t for t in open_tickets if t["component"].casefold() == "session bridge"]
    bridge_ids = [t["id"] for t in bridge]
    assignees = sorted({t["assignee"].strip() for t in bridge if t["assignee"].strip()})
    if len(assignees) != 1:
        raise ValueError(f"expected one bridge assignee, got {assignees}")

    vendor_date = iso_date(re.search(r"v1 response endpoint on (20\d\d-\d\d-\d\d)", contract).group(1))
    vendor_ticket = next(t["id"] for t in open_tickets if "v2 response" in t["title"].casefold())
    unowned = next(t for t in bridge if not t["assignee"].strip())
    chain = longest_chain(tickets)
    if not set(bridge_ids).issubset(set(chain)):
        raise ValueError("session bridge chain is not the longest active chain")
    terminal = chain[-1]

    # The note's settings/diagnostic language points to the existing adjacent ticket;
    # the note itself supplies the added behavior and has no new ticket number.
    scope_ticket = next(t["id"] for t in open_tickets if "diagnostics" in t["title"].casefold())
    if "encrypted diagnostic bundle" not in notes.casefold():
        raise ValueError("scope note missing")
    decoy = "MOB-144" if "MOB-144" in notes else next(t["id"] for t in tickets if t["status"] == "Closed")
    freeze_date = iso_date(re.search(r"Code freeze \| (20\d\d-\d\d-\d\d)", roadmap).group(1))
    holiday_rows = []
    with (FIXTURE / "capacity.csv").open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["public_holiday"] == freeze_date:
                holiday_rows.append(row)
    if not holiday_rows:
        raise ValueError("freeze is not represented as a holiday")

    # These are also used to keep the assertions grounded in computed values.
    chain_points = sum(t["estimate_points"] for t in tickets if t["id"] in chain and isinstance(t["estimate_points"], int))
    if chain_points != 37:
        raise ValueError(f"unexpected chain point total: {chain_points}")
    if date.fromisoformat(tickets[[t["id"] for t in tickets].index(terminal)]["due_date"]) <= date.fromisoformat(freeze_date):
        raise ValueError("terminal ticket should reach beyond the freeze")
    owner_names = {line.split("|")[1].strip() for line in org.splitlines() if line.startswith("|") and "Person" not in line and "---" not in line}
    if "Owen Wright" not in owner_names or "Lena Brooks" not in owner_names or "Sana Patel" not in owner_names:
        raise ValueError("expected owners absent from org chart")

    ids_union = bridge_ids + [vendor_ticket, scope_ticket]
    assertions = [
        {"id": "key-person-cites-chain", "desc": "names several Session Bridge tickets", "op": "cites", "path": "risks", "field": "tickets", "ids": bridge_ids, "min": 3, "where": {"kind": "key-person"}},
        {"id": "vendor-date-cites-ticket", "desc": "ties provider timing and its owner to the compatibility ticket", "op": "cites", "path": "risks", "field": "tickets", "ids": [vendor_ticket], "where": {"kind": "vendor", "trigger_date": vendor_date, "owner": "Sana Patel"}},
        {"id": "unowned-trigger", "desc": "uses the unowned ticket due date as a trigger", "op": "cites", "path": "risks", "field": "tickets", "ids": [unowned["id"]], "where": {"kind": "unowned", "trigger_date": unowned["due_date"]}},
        {"id": "freeze-cites-terminal", "desc": "ties the schedule risk to the end of the dependency chain", "op": "cites", "path": "risks", "field": "tickets", "ids": [terminal], "where": {"kind": "schedule", "trigger_date": freeze_date}},
        {"id": "freeze-owner", "desc": "assigns the freeze risk to the release lead", "op": "cites", "path": "risks", "field": "tickets", "ids": [terminal], "where": {"kind": "schedule", "owner": "Owen Wright"}},
        {"id": "risk-list-precision", "desc": "keeps the register focused on identified work", "op": "precision", "path": "risks", "field": "tickets", "ids": ids_union, "min": 0.5, "maxCount": 9},
        {"id": "resolved-decoy-absent", "desc": "does not carry the resolved entitlement item as a live risk", "op": "absent", "path": "risks", "field": "tickets", "ids": [decoy]},
        {"id": "all-five-risk-kinds", "desc": "includes each material risk kind", "op": "includes", "path": "risks", "ids": ["key-person", "vendor", "unowned", "scope", "schedule"]},
    ]

    key = {"output": "docs/risk-register.md", "block": "risks", "assertions": assertions}
    OUT.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"bridge_ids": bridge_ids, "chain": chain, "chain_points": chain_points, "vendor_ticket": vendor_ticket, "vendor_date": vendor_date, "unowned": unowned["id"], "scope_ticket": scope_ticket, "terminal": terminal, "freeze_date": freeze_date, "decoy": decoy}, indent=2))


if __name__ == "__main__":
    main()
