#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Stub test of run-standard-quality-pack.sh (free): STANDARD_DIR points at a fake judge tree whose bench.js only records
# its arguments, so no model is called. Cases: no judge bench stops; --plan passes --plan to a judged unit and leaves an
# unjudged one out; a live pass with no credentials stops before any call.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
SCRIPT=$HERE/run-standard-quality-pack.sh
T=$(mktemp -d "${KIROCREW_SCRATCH:-/tmp}/sqp.XXXX")
trap 'find "$T" -mindepth 1 -delete; rmdir "$T"' EXIT
fails=0
want() {  # want LABEL WANT_EXIT PATTERN: the last run's exit code and log
  if [ "$code" = "$2" ] && grep -q -- "$3" "$T/log"; then echo "ok   $1"
  else echo "FAIL $1: exit $code (want $2), pattern '$3'"; fails=$((fails + 1)); fi
}
run() { code=0; STANDARD_DIR=$T/s AWS_PROFILE_NAME=none-such bash "$SCRIPT" "$@" > "$T/log" 2>&1 || code=$?; }

run --plan
want "no judge bench stops" 1 "STOP: no judge bench"

B=$T/s/judge/bench
mkdir -p "$B/bench/runner" "$T/s/judge/runs/r1-b1" "$T/s/judge/runs/r1-b2" "$T/s/judge/packs/b1"
touch "$T/s/judge/runs/r1-b1.done"
echo 'console.log("args " + process.argv.slice(2).join(" "));' > "$B/bench/runner/bench.js"
run --plan
want "plan calls the judge with --plan and --criteria-pack quality" 0 "plan only: nothing was called"
grep -q -- "--plan" "$T/s/judge/runs/r1-b1-quality.log" && grep -q -- "--criteria-pack quality" "$T/s/judge/runs/r1-b1-quality.log" \
  && echo "ok   the stub saw --plan and the pack" || { echo "FAIL the stub args"; fails=$((fails + 1)); }
grep -q "r1-b2: not judged yet" "$T/log" && echo "ok   an unjudged unit is left out" || { echo "FAIL unjudged unit"; fails=$((fails + 1)); }

run
want "a live pass with no credentials stops before any call" 1 "credentials for profile none-such expired"
[ ! -e "$T/s/judge/runs/r1-b1-quality.log" ] || [ "$(grep -c . "$T/s/judge/runs/r1-b1-quality.log")" -gt 0 ] || true
[ "$fails" = 0 ] && echo "ALL PASS" || { echo "$fails FAILED"; exit 1; }
