#!/usr/bin/env python3
"""Derive the grading key solely from the visible fixture files."""
from __future__ import annotations

import csv
import json
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
KEY_PATH = ROOT / "hidden" / "key.json"
OPEN_STATUSES = {"open", "ready", "in progress", "blocked"}


def read_csv(name: str) -> list[dict[str, str]]:
    with (FIXTURE / name).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def tid_number(ticket_id: str) -> int:
    return int(ticket_id.split("-")[1])


def weekdays(start: date, end: date):
    current = start
    while current <= end:
        if current.weekday() < 5:
            yield current
        current += timedelta(days=1)


def capacity_by_sprint(roster, calendar, holidays, on_call):
    holiday_dates = {date.fromisoformat(row["date"]) for row in holidays}
    capacity: dict[str, float] = {}
    by_sprint_days: dict[str, list[date]] = {}
    for sprint in calendar:
        days = [d for d in weekdays(date.fromisoformat(sprint["start"]), date.fromisoformat(sprint["end"])) if d not in holiday_dates]
        by_sprint_days[sprint["sprint"]] = days
        total = 0.0
        for person in roster:
            call_days = set()
            for rotation in on_call:
                if rotation["person"] != person["person"]:
                    continue
                call_days.update(weekdays(date.fromisoformat(rotation["week_start"]), date.fromisoformat(rotation["week_end"])))
            normal = sum(d not in call_days for d in days)
            called = sum(d in call_days for d in days)
            total += float(person["base_points_per_workday"]) * float(person["focus_factor"]) * (normal + 0.5 * called)
        capacity[sprint["sprint"]] = round(total, 10)
    return capacity, by_sprint_days


def main() -> None:
    tickets = read_csv("backlog_export.csv")
    roster = read_csv("team_roster.csv")
    calendar = read_csv("sprint_calendar.csv")
    holidays = read_csv("holidays.csv")
    on_call = read_csv("on_call.csv")
    by_id = {row["ticket_id"]: row for row in tickets}
    open_tickets = [row for row in tickets if row["status"].strip().casefold() in OPEN_STATUSES]
    open_by_id = {row["ticket_id"]: row for row in open_tickets}
    musts = sorted((row for row in open_tickets if row["priority"].strip().casefold() == "must"), key=lambda r: tid_number(r["ticket_id"]))
    cap, sprint_days = capacity_by_sprint(roster, calendar, holidays, on_call)
    sprint_names = [row["sprint"] for row in calendar]

    def estimate(row):
        return None if not row["estimate_points"].strip() else float(row["estimate_points"])

    def deps(row):
        return [x.strip() for x in row["depends_on"].split(";") if x.strip()]

    # Resolve the open dependency closure of the must-have scope.
    closure: set[str] = set()
    pending = [row["ticket_id"] for row in musts]
    while pending:
        ticket_id = pending.pop()
        row = open_by_id.get(ticket_id)
        if row is None or ticket_id in closure:
            continue
        closure.add(ticket_id)
        pending.extend(deps(row))

    skill_rows: dict[str, list[dict[str, str]]] = {}
    for roster_row in roster:
        skill_rows.setdefault(roster_row["skill"].strip().casefold(), []).append(roster_row)
    by_skill = {skill: rows[0] for skill, rows in skill_rows.items() if len(rows) == 1}
    specialist_unfit: list[dict[str, str]] = []
    for row in musts:
        points = estimate(row)
        if points is None:
            continue
        skill = row["skill"].strip().casefold()
        if skill not in by_skill:
            continue
        owner = by_skill[skill]
        bundle_points = points + sum(estimate(by_id[d]) or 0 for d in deps(row) if d in by_id)
        owner_max = 0.0
        for sprint in sprint_names:
            # Reuse the same daily convention for this one person's capacity.
            days = sprint_days[sprint]
            calls = set()
            for rotation in on_call:
                if rotation["person"] == owner["person"]:
                    calls.update(weekdays(date.fromisoformat(rotation["week_start"]), date.fromisoformat(rotation["week_end"])))
            owner_max = max(owner_max, float(owner["base_points_per_workday"]) * float(owner["focus_factor"]) * sum(0.5 if d in calls else 1 for d in days))
        if bundle_points > owner_max:
            specialist_unfit.append(row)

    specialist_ids = {row["ticket_id"] for row in specialist_unfit}
    unestimated = [row["ticket_id"] for row in musts if estimate(row) is None]
    not_fitting = sorted(specialist_ids | set(unestimated), key=tid_number)

    # Commit the ordered, estimated must-have scope and its open prerequisites. A ticket
    # is skipped for that sprint when it would exceed the aggregate capacity; later work
    # gets another sprint. The specialist bundle stays visible in over_allocated.
    scope_ids = {ticket_id for ticket_id in closure if ticket_id in open_by_id and estimate(open_by_id[ticket_id]) is not None}
    scope_ids -= specialist_ids
    scope = sorted((open_by_id[ticket_id] for ticket_id in scope_ids), key=lambda r: tid_number(r["ticket_id"]))
    plans = {sprint: [] for sprint in sprint_names}
    used = {sprint: 0.0 for sprint in sprint_names}
    placed: set[str] = set()
    for sprint in sprint_names:
        for row in scope:
            ticket_id = row["ticket_id"]
            if ticket_id in placed:
                continue
            points = estimate(row)
            if used[sprint] + points <= cap[sprint] + 1e-9:
                plans[sprint].append(ticket_id)
                used[sprint] += points
                placed.add(ticket_id)
    # Keep each dependency before the ticket that uses it, even if the ticket is in a later sprint.
    # The greedy pass already gives that order for this export.

    pulled = sorted((ticket_id for ticket_id in closure if ticket_id in open_by_id and open_by_id[ticket_id]["priority"].strip().casefold() != "must"), key=tid_number)
    payment_row = specialist_unfit[0]
    payment_owner = by_skill[payment_row["skill"].strip().casefold()]
    payment_dep_points = sum(estimate(by_id[d]) or 0 for d in deps(payment_row) if d in by_id)
    bundle_assigned = (estimate(payment_row) or 0) + payment_dep_points
    over_sprint = next(s for s in sprint_names if any(d in plans[s] for d in deps(payment_row)))
    owner_days = sprint_days[over_sprint]
    owner_calls = set()
    for rotation in on_call:
        if rotation["person"] == payment_owner["person"]:
            owner_calls.update(weekdays(date.fromisoformat(rotation["week_start"]), date.fromisoformat(rotation["week_end"])))
    owner_capacity = float(payment_owner["base_points_per_workday"]) * float(payment_owner["focus_factor"]) * sum(0.5 if d in owner_calls else 1 for d in owner_days)

    decoy_could = next(row["ticket_id"] for row in open_tickets if row["priority"].casefold() == "could" and "empty-state illustration" in row["title"])
    decoy_should = next(row["ticket_id"] for row in open_tickets if row["priority"].casefold() == "should" and "notification wording" in row["title"])
    decoy_closed = next(row["ticket_id"] for row in tickets if row["priority"].casefold() == "must" and row["status"].casefold() == "done" and "legacy import note" in row["title"])
    key_ids = sorted(set(not_fitting) | set(pulled) | {decoy_could, decoy_should, decoy_closed}, key=tid_number)

    assertions = [
        {"id": "cap-s1", "desc": "S1 capacity applies workdays, focus and on-call", "op": "number", "path": "capacity_by_sprint.2027-S1", "value": cap["2027-S1"], "tol": 0.5},
        {"id": "cap-s2", "desc": "S2 capacity applies both holidays and on-call", "op": "number", "path": "capacity_by_sprint.2027-S2", "value": cap["2027-S2"], "tol": 0.5},
        {"id": "cap-s3", "desc": "S3 capacity applies its holiday and on-call", "op": "number", "path": "capacity_by_sprint.2027-S3", "value": cap["2027-S3"], "tol": 0.5},
        {"id": "planned-scope", "desc": "Every estimated beta must-have and its open prerequisites are planned in some sprint", "op": "includes", "path": "sprints", "ids": [t for t in plans["2027-S1"] + plans["2027-S2"] + plans["2027-S3"] if t != payment_row["depends_on"].strip()]},
        {"id": "dependency-closure", "desc": "Both open prerequisites are named", "op": "includes", "path": "pulled_in_dependencies", "ids": pulled},
        {"id": "unfit-payment", "desc": "Payment checkout is called out as not fitting", "op": "includes", "path": "not_fitting", "ids": [payment_row["ticket_id"]]},
        {"id": "unestimated", "desc": "Blank estimate is called out", "op": "includes", "path": "unestimated", "ids": unestimated},
        {"id": "specialist-overload", "desc": "The sole payment specialist overload is explicit", "op": "cites", "path": "over_allocated", "field": "person", "ids": [payment_owner["person"]], "where": {"sprint": over_sprint, "assigned": bundle_assigned, "capacity": owner_capacity}},
        {"id": "decoy-dependency", "desc": "An unrelated copy task is not called a dependency", "op": "absent", "path": "pulled_in_dependencies", "ids": [decoy_should]},
        {"id": "decoy-closed", "desc": "A completed historical row is not planned", "op": "absent", "path": "sprints", "ids": [decoy_closed]},
    ]
    key = {"output": "plan/next-three-sprints.md", "block": "sprint-plan", "assertions": assertions}
    KEY_PATH.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
