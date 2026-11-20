import argparse
from pathlib import Path

from .aggregation import analyze
from .formatting import render_summary


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create an endpoint report from NDJSON")
    parser.add_argument("--input", required=True, dest="input_path")
    parser.add_argument("--output", required=True, dest="output_path")
    args = parser.parse_args(argv)
    summary = analyze(args.input_path)
    output = Path(args.output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render_summary(summary), encoding="utf-8")
    return 0
