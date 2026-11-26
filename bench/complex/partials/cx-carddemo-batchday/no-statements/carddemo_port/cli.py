"""Command line: `python -m carddemo_port post|interest|report|statements --in DIR --out DIR`.

Prints counts only, never card numbers or amounts.
Exit codes: 0 ok, 4 posting rejected some transactions, 2 bad input or config.
"""
import argparse
import sys
from datetime import date, datetime

from carddemo_port import jobs
from carddemo_port.errors import ConfigError, DataError


def _run_date(text):
    try:
        return datetime.strptime(text, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise argparse.ArgumentTypeError("must be YYYY-MM-DD") from None


def _parser():
    parser = argparse.ArgumentParser(prog="carddemo_port", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="job", required=True)
    for name in ("post", "interest", "report"):
        job = sub.add_parser(name)
        job.add_argument("--in", dest="in_dir", required=True, help="directory with the input files")
        job.add_argument("--out", dest="out_dir", required=True, help="new or empty output directory")
        if name == "interest":
            job.add_argument("--run-date", type=_run_date, default=date.today().isoformat())
        if name == "report":
            job.add_argument("--start", type=_run_date, required=True, help="first date, YYYY-MM-DD")
            job.add_argument("--end", type=_run_date, required=True, help="last date, YYYY-MM-DD")
    return parser


def main(argv=None):
    parser = _parser()
    args = parser.parse_args(argv)
    if args.job == "report" and args.start > args.end:
        parser.error("--start is after --end")
    now = datetime.now()
    try:
        if args.job == "post":
            summary = jobs.run_post(args.in_dir, args.out_dir, now)
        elif args.job == "interest":
            summary = jobs.run_interest(args.in_dir, args.out_dir, args.run_date, now)
        elif args.job == "report":
            summary = jobs.run_report(args.in_dir, args.out_dir, args.start, args.end)
        else:
            raise SystemExit(2)
    except (DataError, ConfigError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    for key, value in summary.items():
        print("%s: %d" % (key, value))
    return 4 if summary.get("rejected") else 0
