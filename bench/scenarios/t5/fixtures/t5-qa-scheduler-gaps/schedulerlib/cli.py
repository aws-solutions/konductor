"""Command-line entry points."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

from .persistence import StateStore
from .scheduler import Schedule


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="calendar-workbench")
    sub = parser.add_subparsers(dest="command", required=True)
    schedule = sub.add_parser("schedule")
    schedule.add_argument("expression")
    schedule.add_argument("--after", default=None)
    state = sub.add_parser("state")
    state.add_argument("path", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "schedule":
        after = datetime.fromisoformat(args.after) if args.after else datetime.now()
        print(Schedule(args.expression).next_run(after).isoformat())
        return 0
    print(len(StateStore(args.path).load()))
    return 0
