#!/usr/bin/env python3
"""Derive the grading key solely from the fixture files."""
from __future__ import annotations

import csv
import json
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture"
KEY_PATH = ROOT / "hidden" / "key.json"
OPEN_STATUSES = {"open", "in progress", "blocked", "ready"}


def read_csv(name: str) -> list[dict[str, str]]:
    with (FIXTURE / name).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def iso_day(value: str) -> date:
    return date.fromisoformat(value)


def norm(value: str) -> str:
    return " ".join(value.strip().lower().split())


def release_dates() -> dict[str, date]:
    return {norm(row["stage"]): iso_day(row["date"]) for row in read_csv("release-calendar.csv")}


def open_tickets() -> dict[str, dict[str, object]]:
    raw = json.loads((FIXTURE / "tickets.json").read_text(encoding="utf-8"))
    allowed = {norm(row["status"]) for row in read_csv("status-codes.csv") if norm(row["counts_as_open"]) == "yes"}
    return {
        ticket["id"]: ticket
        for ticket in raw
        if norm(str(ticket.get("status", ""))) in allowed and ticket["id"]
    }


def longest_chain(tickets: dict[str, dict[str, object]]) -> list[str]:
    memo: dict[str, tuple[int, list[str]]] = {}

    def best(ticket_id: str) -> tuple[int, list[str]]:
        if ticket_id in memo:
            return memo[ticket_id]
        ticket = tickets[ticket_id]
        candidates: list[tuple[int, list[str]]] = [(0, [])]
        for predecessor in ticket.get("depends_on", []):
            if predecessor in tickets:
                candidates.append(best(predecessor))
        points, path = max(candidates, key=lambda item: (item[0], item[1]))
        result = (points + int(ticket["estimate_points"] or 0), path + [ticket_id])
        memo[ticket_id] = result
        return result

    chains = [best(ticket_id) for ticket_id in tickets]
    connected = [item for item in chains if len(item[1]) >= 2]
    return max(connected, key=lambda item: (item[0], item[1]))[1]


def pto_by_person() -> dict[str, list[tuple[date, date]]]:
    result: dict[str, list[tuple[date, date]]] = {}
    for row in read_csv("pto.csv"):
        result.setdefault(norm(row["person"]), []).append((iso_day(row["start_date"]), iso_day(row["end_date"])))
    return result


def holidays() -> set[date]:
    return {iso_day(row["date"]) for row in read_csv("holidays.csv")}


def is_pto(person: str, day: date, pto: dict[str, list[tuple[date, date]]]) -> bool:
    return any(start <= day <= end for start, end in pto.get(norm(person), []))


def working(day: date, person: str, pto: dict[str, list[tuple[date, date]]], holiday_days: set[date]) -> bool:
    return day.weekday() < 5 and day not in holiday_days and not is_pto(person, day, pto)


def sprint_rows() -> dict[str, dict[str, str]]:
    return {row["sprint"]: row for row in read_csv("sprints.csv")}


def capacity_by_sprint() -> dict[str, int]:
    pto = pto_by_person()
    holiday_days = holidays()
    totals: dict[str, int] = {}
    for row in read_csv("capacity.csv"):
        start = iso_day(sprint_rows()[row["sprint"]]["start_date"])
        end = iso_day(sprint_rows()[row["sprint"]]["end_date"])
        day = start
        unavailable = 0
        while day <= end:
            if day.weekday() < 5 and (day in holiday_days or is_pto(row["person"], day, pto)):
                unavailable += 1
            day += timedelta(days=1)
        totals[row["sprint"]] = totals.get(row["sprint"], 0) + max(0, int(row["nominal_points"]) - unavailable)
    return totals


def team_handoffs() -> dict[str, set[int]]:
    names = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4}
    result: dict[str, set[int]] = {}
    for row in read_csv("team-calendar.csv"):
        result[row["team"]] = {names[norm(day)] for day in row["handoff_acceptance_weekdays"].split(",")}
    return result


def first_available(day: date, ticket: dict[str, object], pto: dict[str, list[tuple[date, date]]], holiday_days: set[date]) -> date:
    while not working(day, str(ticket["owner"]), pto, holiday_days):
        day += timedelta(days=1)
    return day


def finish_date(start: date, points: int, ticket: dict[str, object], pto: dict[str, list[tuple[date, date]]], holiday_days: set[date]) -> date:
    day = start
    done = 0
    while True:
        if working(day, str(ticket["owner"]), pto, holiday_days):
            done += 1
            if done >= points:
                return day
        day += timedelta(days=1)


def earliest_chain_date(chain: list[str], tickets: dict[str, dict[str, object]]) -> date:
    pto = pto_by_person()
    holiday_days = holidays()
    sprint_map = sprint_rows()
    handoffs = team_handoffs()
    finished: dict[str, date] = {}
    for ticket_id in chain:
        ticket = tickets[ticket_id]
        candidate = iso_day(sprint_map[str(ticket["planned_sprint"])]["start_date"])
        predecessors = [p for p in ticket.get("depends_on", []) if p in finished]
        cross_team = False
        if predecessors:
            predecessor = max(predecessors, key=lambda p: finished[p])
            ready = finished[predecessor] + timedelta(days=1)
            previous_team = tickets[predecessor]["team"]
            if previous_team != ticket["team"]:
                cross_team = True
                accepted = handoffs[str(ticket["team"])]
                while ready.weekday() not in accepted:
                    ready += timedelta(days=1)
            candidate = max(candidate, ready)
        if cross_team:
            accepted = handoffs[str(ticket["team"])]
            while candidate.weekday() not in accepted or not working(candidate, str(ticket["owner"]), pto, holiday_days):
                candidate += timedelta(days=1)
            start = candidate
        else:
            start = first_available(candidate, ticket, pto, holiday_days)
        finished[ticket_id] = finish_date(start, int(ticket["estimate_points"]), ticket, pto, holiday_days)
    return finished[chain[-1]]


def main() -> None:
    releases = release_dates()
    tickets = open_tickets()
    chain = longest_chain(tickets)
    earliest = earliest_chain_date(chain, tickets)
    capacities = capacity_by_sprint()
    key_ids = chain
    assertions = [
        {"id": "target-missed", "desc": "March 31 is not achievable", "op": "equals", "path": "can_hit_target", "value": False},
        {"id": "earliest-completion", "desc": "gives the earliest realistic completion", "op": "date", "path": "earliest_date", "value": earliest.isoformat(), "tolDays": 5},
        {"id": "chain-members", "desc": "names the open dependency chain", "op": "includes", "path": "critical_path", "ids": key_ids},
        {"id": "chain-order", "desc": "keeps dependency order", "op": "order", "path": "critical_path", "ids": key_ids},
        {"id": "leave-ticket", "desc": "calls out the leave-owned chain ticket", "op": "cites", "path": "drivers", "field": "tickets", "ids": ["MIG-071"]},
        {"id": "handoff-tickets", "desc": "calls out both sides of the handoff", "op": "cites", "path": "drivers", "field": "tickets", "ids": ["MIG-057", "MIG-071"], "min": 2},
        {"id": "late-stage-handoff", "desc": "calls out the release handoff", "op": "cites", "path": "drivers", "field": "tickets", "ids": ["MIG-088", "MIG-109"], "min": 2},
        {"id": "freeze-conflict", "desc": "calls out the dependency date conflict", "op": "cites", "path": "drivers", "field": "tickets", "ids": ["MIG-126"]},
        {"id": "driver-precision", "desc": "keeps drivers focused on chain work", "op": "precision", "path": "drivers", "field": "tickets", "ids": key_ids, "min": 0.5, "maxCount": 8},
        {"id": "decoy-not-critical", "desc": "does not put the large independent epic on the chain", "op": "absent", "path": "critical_path", "field": "", "ids": ["MIG-142"]},
        {"id": "decoy-not-driver", "desc": "does not call the independent epic a date driver", "op": "absent", "path": "drivers", "field": "tickets", "ids": ["MIG-142"]},
        {"id": "capacity-s2", "desc": "accounts for the January holiday", "op": "number", "path": "capacity_by_sprint.S2", "value": capacities["S2"], "tol": 0},
        {"id": "capacity-s4", "desc": "accounts for the February holiday", "op": "number", "path": "capacity_by_sprint.S4", "value": capacities["S4"], "tol": 0},
        {"id": "capacity-s7", "desc": "accounts for the chain sprint leave and holidays", "op": "number", "path": "capacity_by_sprint.S7", "value": capacities["S7"], "tol": 1},
        {"id": "capacity-s8", "desc": "accounts for the later planned leave", "op": "number", "path": "capacity_by_sprint.S8", "value": capacities["S8"], "tol": 1},
    ]
    KEY_PATH.write_text(json.dumps({"output": "docs/march-forecast.md", "block": "forecast", "assertions": assertions}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
