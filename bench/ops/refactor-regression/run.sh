#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# The refactor regression net (free, stubs only): the same fake-agent studies on a base commit and on a head commit,
# each in its own detached worktree under a fresh directory outside $HOME, then a diff of run configs, results,
# judgments, reports and compare output (diff.js). Prints the diff as markdown and writes it to --report.
#
#   bench/ops/refactor-regression/run.sh [--base a822e04a] [--head HEAD] [--report FILE] [--keep]
#
# Python: BENCH_ARM_PYTHON (3.12 with cedarpy, for the plant gateway) and BENCH_STRANDS_PYTHON (strands-agents); a
# plant study is skipped without them. LD_LIBRARY_PATH is passed through (the arm venv's libffi). Above a load of 4 the
# studies run under nice. The worktrees are removed at the end unless --keep.
set -euo pipefail

base=a822e04a
head=HEAD
report=
keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base=$2; shift 2 ;;
    --head) head=$2; shift 2 ;;
    --report) report=$2; shift 2 ;;
    --keep) keep=1; shift ;;
    *) echo "usage: run.sh [--base REF] [--head REF] [--report FILE] [--keep]" >&2; exit 64 ;;
  esac
done

here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
work=$(mktemp -d /var/tmp/kd-refreg.XXXXXX)
base_sha=$(git -C "$repo" rev-parse --short=8 "$base")
head_sha=$(git -C "$repo" rev-parse --short=8 "$head")

cleanup() {
  if [ "$keep" = 0 ]; then
    git -C "$repo" worktree remove --force "$work/tree-base" 2>/dev/null || true
    git -C "$repo" worktree remove --force "$work/tree-head" 2>/dev/null || true
  fi
}
trap cleanup EXIT

git -C "$repo" worktree add -q --detach "$work/tree-base" "$base_sha"
git -C "$repo" worktree add -q --detach "$work/tree-head" "$head_sha"

nice_cmd=()
load=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)
if awk -v l="$load" 'BEGIN { exit !(l > 4) }'; then nice_cmd=(nice -n 10); fi

py_args=()
if [ -n "${BENCH_ARM_PYTHON:-}" ]; then py_args+=(--plant-python "$BENCH_ARM_PYTHON"); fi
if [ -n "${BENCH_STRANDS_PYTHON:-}" ]; then py_args+=(--strands-python "$BENCH_STRANDS_PYTHON"); fi

# The driver and its input builders come from the head checkout, so both sides get the same inputs.
driver="$work/tree-head/bench/ops/refactor-regression"
# head2 is a second run of the head: what differs between head and head2 is run-to-run noise (report.js --noise).
for side in base head head2; do
  tree=$work/tree-${side%2}
  "${nice_cmd[@]}" node "$driver/study.js" --tree "$tree" --out "$work/study-$side" "${py_args[@]}" 2> "$work/study-$side.log"
done

args=(--base "$work/study-base" --head "$work/study-head" --noise "$work/study-head2" --base-label "$base_sha" --head-label "$head_sha")
if [ -n "$report" ]; then args+=(--out "$report"); fi
node "$driver/report.js" "${args[@]}"
echo "studies: $work (worktrees $([ "$keep" = 1 ] && echo kept || echo removed))" >&2
