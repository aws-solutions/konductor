"""Command line entry point."""

import argparse
import sys
from .database import ReportDatabase
from .formatters import write_csv, write_json
from .report import ReportBuilder
from .validation import validate_month


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Write a monthly customer order report")
    result.add_argument("--db", required=True, help="SQLite database path")
    result.add_argument("--month", required=True, help="month in YYYY-MM form")
    result.add_argument("--format", choices=("csv", "json"), required=True)
    result.add_argument("--output", required=True, help="output path, or - for stdout")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        month = validate_month(args.month)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    rows = ReportBuilder(ReportDatabase(args.db)).iter_rows(month)
    if args.format == "csv":
        write_csv(rows, args.output)
    else:
        write_json(rows, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
