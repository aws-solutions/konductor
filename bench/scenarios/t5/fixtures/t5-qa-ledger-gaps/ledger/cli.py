"""Command line entry point for a tiny statement preview."""
from __future__ import annotations

import argparse
from datetime import datetime
from decimal import Decimal

from .ledger import Ledger
from .statement import render_text


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="print a simple ledger statement")
    parser.add_argument("account")
    parser.add_argument("--start", required=True, type=datetime.fromisoformat)
    parser.add_argument("--end", required=True, type=datetime.fromisoformat)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    ledger = Ledger()
    ledger.create_account(args.account)
    print(render_text(ledger.statement(args.account, args.start, args.end)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
