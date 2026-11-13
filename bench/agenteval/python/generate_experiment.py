# SPDX-License-Identifier: Apache-2.0
"""Generate a Strands experiment that includes expected trajectories.

The strands-evals command line builds its generator without expected trajectories. This helper calls the Python API with
include_expected_trajectory=True and saves the experiment as JSON. agenteval's generate-strands runs it with --trajectories.

Needs Python 3.11+ and the strands-agents-evals package. This script calls a model, so it can cost money and needs the
credentials the library expects in the environment.

Exit codes: 0 ok, 1 any error (messages go to stderr).
"""

import argparse
import asyncio
import sys
from pathlib import Path

EVALUATORS = ("OutputEvaluator", "TrajectoryEvaluator", "InteractionsEvaluator")


class Parser(argparse.ArgumentParser):
    def error(self, message):
        print(f"generate_experiment.py: {message}", file=sys.stderr)
        sys.exit(1)


def parse_args(argv):
    p = Parser(description=__doc__.split("\n\n")[0])
    p.add_argument("--context-file", required=True, help="text describing the agent and its tools")
    p.add_argument("--task-description", required=True, help="short description of the agent's task")
    p.add_argument("--out", required=True, help="experiment file to write; a path without an extension gets .json")
    p.add_argument("--num-cases", type=int, help="number of cases (the library default applies when omitted)")
    p.add_argument("--num-topics", type=int, help="expand into this many topic prompts")
    p.add_argument("--evaluator", choices=EVALUATORS, help="rubric the generator writes")
    p.add_argument("--model", help="model id for the generator")
    args = p.parse_args(argv)
    for name in ("num_cases", "num_topics"):
        value = getattr(args, name)
        if value is not None and value < 1:
            p.error(f"--{name.replace('_', '-')} must be a positive integer")
    return args


def output_path(out):
    path = Path(out)
    if path.suffix == "":
        return path.with_suffix(".json")
    if path.suffix != ".json":
        raise ValueError(f"--out must end in .json, got {out}")
    return path


async def generate(args, path):
    from strands_evals import evaluators
    from strands_evals.generators import ExperimentGenerator

    context = Path(args.context_file).read_text(encoding="utf-8")
    generator = ExperimentGenerator[str, str](
        input_type=str,
        output_type=str,
        include_expected_output=True,
        include_expected_trajectory=True,
        include_metadata=True,
        model=args.model,
    )
    kwargs = {"context": context, "task_description": args.task_description}
    if args.num_cases is not None:
        kwargs["num_cases"] = args.num_cases
    if args.num_topics is not None:
        kwargs["num_topics"] = args.num_topics
    if args.evaluator is not None:
        kwargs["evaluator"] = getattr(evaluators, args.evaluator)
    experiment = await generator.from_context_async(**kwargs)
    experiment.to_file(str(path))
    return len(experiment.cases)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        path = output_path(args.out)
        count = asyncio.run(generate(args, path))
    except ImportError as e:
        print(f"generate_experiment.py: cannot import strands_evals ({e}). Install it with: pip install strands-agents-evals", file=sys.stderr)
        return 1
    except Exception as e:  # any generator, model or file error is reported once and exits 1
        print(f"generate_experiment.py: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    print(f"{count} cases written to {path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
