"""Command line entry point for rates and labels."""
from __future__ import annotations

import argparse
from datetime import date
import json
import sys

from labels import format_label
from rates import RateRequest, RateCalculator, format_breakdown


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="parcel-tool")
    commands = parser.add_subparsers(dest="command", required=True)

    rate = commands.add_parser("rate", help="calculate one parcel rate")
    rate.add_argument("--zone", required=True)
    rate.add_argument("--weight", required=True, type=float)
    rate.add_argument("--service", default="ground")
    rate.add_argument("--residential", action="store_true")
    rate.add_argument("--remote", action="store_true")
    rate.add_argument("--signature", action="store_true")
    rate.add_argument("--date", dest="ship_date")
    rate.add_argument("--json", action="store_true")

    label = commands.add_parser("label", help="format a label from a JSON object")
    label.add_argument("input", help="path to a JSON order")
    return parser


def _rate(args: argparse.Namespace) -> int:
    ship_date = date.fromisoformat(args.ship_date) if args.ship_date else None
    request = RateRequest(
        zone=args.zone,
        weight=args.weight,
        service=args.service,
        residential=args.residential,
        remote=args.remote,
        signature=args.signature,
        ship_date=ship_date,
    )
    calculator = RateCalculator()
    breakdown = calculator.quote(request)
    if args.json:
        print(json.dumps(breakdown.as_dict(), sort_keys=True))
    else:
        print(format_breakdown(breakdown))
    return 0


def _label(args: argparse.Namespace) -> int:
    with open(args.input, encoding="utf-8") as handle:
        order = json.load(handle)
    print(format_label(order))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "rate":
            return _rate(args)
        if args.command == "label":
            return _label(args)
        parser.error("unknown command")
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
