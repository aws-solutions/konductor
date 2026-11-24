#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# One test entry point for the bench (FW-23, DEBT D-217). Runs, from the repo root:
#   1. the node base set: bench/runner/test and bench/skilleval/test (the command bench/test-base-set.txt names);
#   2. the Python unittest files in bench/physical/test, printed as TAP lines (bench/scripts/unittest-tap.py).
# The arm Python is BENCH_ARM_PYTHON, else <repo>/.venv/bin/python. When it imports mujoco and cedarpy, both parts run
# with it and BENCH_REQUIRE_ARM=1, and any arm test that still skips fails the run (debt review F1: a suite that
# skipped every arm test once read clean). With no arm Python the arm tests skip and the run says so. With an arm
# Python, the live plant-wave case needs PLANT_CS (the private counted set; default $KONDUCTOR_WS/plant-counted-set).
# Usage: bench/scripts/test.sh [--tap]     --tap: node prints TAP too, so the whole output is one TAP stream.
# With KONDUCTOR_WS set (the owner workspace), it also checks that every workspace owner script is a launcher into
# bench/ops (bench/ops/make-launchers.sh --check).
# Exit 0 only when no test failed, no arm test skipped with an arm Python present, and the workspace check passed.
# Free: no model call. Override for tests: R (the repo root).
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
R=${R:-$(cd "$HERE/../.." && pwd -P)}
REPORTER=()
case "${1:-}" in
  --tap) REPORTER=(--test-reporter=tap) ;;
  '') ;;
  *) echo "usage: bench/scripts/test.sh [--tap]" >&2; exit 2 ;;
esac

LOGS=$(mktemp -d "${TMPDIR:-/tmp}/bench-test.XXXXXX")
trap 'rm -rf "$LOGS"' EXIT

ARM_PY=${BENCH_ARM_PYTHON:-$R/.venv/bin/python}
ARM=0
# A venv python that does not start (its base Python was removed, as one Kiro Crew update did) is a broken venv, not
# a missing one: stop with the rebuild command instead of skipping or asking for wheels.
if { [ -L "$ARM_PY" ] || [ -e "$ARM_PY" ]; } && ! "$ARM_PY" -c pass 2>/dev/null && [ -f "$(dirname "$(dirname "$ARM_PY")")/pyvenv.cfg" ]; then
  echo "# $ARM_PY does not run (its base Python is gone?). Rebuild its venv: bash bench/ops/workspace/rebuild-arm-venv.sh --venv $(dirname "$(dirname "$ARM_PY")")" >&2
  exit 2
fi
if [ -x "$ARM_PY" ] && "$ARM_PY" -c 'import mujoco, cedarpy' 2>/dev/null; then
  ARM=1
  export BENCH_ARM_PYTHON=$ARM_PY BENCH_REQUIRE_ARM=1
  # plant-wave.test.js's live case also needs the private counted set; with BENCH_REQUIRE_ARM=1 a missing one fails.
  if [ -z "${PLANT_CS:-}" ] && [ -n "${KONDUCTOR_WS:-}" ]; then export PLANT_CS=$KONDUCTOR_WS/plant-counted-set; fi
  PY=$ARM_PY
elif [ -n "${BENCH_ARM_PYTHON:-}" ]; then
  echo "# BENCH_ARM_PYTHON=$BENCH_ARM_PYTHON cannot import mujoco and cedarpy (set LD_LIBRARY_PATH for libffi?)" >&2
  exit 2
else
  PY=python3
  echo "# no arm Python ($ARM_PY): the arm tests skip"
fi

# The Strands Python (an interpreter with strands-agents; the Strands plugin tests and test_strands_*.py need it):
# BENCH_STRANDS_PYTHON, else the venv bench/ops/workspace/run-physical-ai-wave0.sh uses. With one, any Strands test
# that still skips fails the run; with none, the run says so and counts the skips on the "# strands skips" line.
STRANDS_PY=${BENCH_STRANDS_PYTHON:-$HOME/.cache/konductor-strands/bin/python}
STRANDS=0
if [ -x "$STRANDS_PY" ] && "$STRANDS_PY" -c 'import strands' 2>/dev/null; then
  STRANDS=1
  export BENCH_STRANDS_PYTHON=$STRANDS_PY
else
  echo "# no Strands Python ($STRANDS_PY): the Strands tests skip"
fi

cd "$R"
node_code=0
# NODE_TEST_CONTEXT is set when this script runs under a node test; the inner run must report on its own.
env -u NODE_TEST_CONTEXT node --test --test-concurrency=1 "${REPORTER[@]}" \
  "bench/runner/test/*.test.js" "bench/skilleval/test/*.test.js" 2>&1 | tee "$LOGS/node.log" || node_code=$?
py_code=0
"$PY" bench/scripts/unittest-tap.py bench/physical/test 2>"$LOGS/py.err" | tee "$LOGS/py.tap" || py_code=$?
[ "$py_code" = 0 ] || cat "$LOGS/py.err" >&2
# The Strands Python tests again with the Strands Python (the arm Python has no strands-agents, so they skip above).
if [ "$STRANDS" = 1 ]; then
  "$STRANDS_PY" bench/scripts/unittest-tap.py bench/physical/test 'test_strands_*.py' 2>"$LOGS/st.err" \
    | sed 's/ - py: / - strands py: /; s/^# py /# strands py /' | tee "$LOGS/st.tap" || py_code=$?
  [ "$py_code" = 0 ] || cat "$LOGS/st.err" >&2
fi

st_node=$(grep -c 'SKIP set BENCH_STRANDS_PYTHON' "$LOGS/node.log" || true)
if [ "$STRANDS" = 1 ]; then st_py=$(grep -c '# SKIP' "$LOGS/st.tap" || true)
else st_py=$(grep -c '# SKIP strands-agents is not installed' "$LOGS/py.tap" || true); fi
st_skips=$((st_node + st_py))
echo "# strands skips $st_skips"
st_bad=0
if [ "$STRANDS" = 1 ] && [ "$st_skips" != 0 ]; then
  st_bad=1; echo "# FAIL: $st_skips Strands test(s) skipped although $STRANDS_PY imports strands" >&2
fi
skips=0
if [ "$ARM" = 1 ]; then
  node_skips=$(grep -c 'no Python with' "$LOGS/node.log" || true)
  py_skips=$(grep -Ec '# SKIP .*(MuJoCo|cedarpy)' "$LOGS/py.tap" || true)
  skips=$((node_skips + py_skips))
fi
echo "# arm skips $skips"
[ "$skips" = 0 ] || echo "# FAIL: $skips arm test(s) skipped although $ARM_PY imports mujoco and cedarpy" >&2

# With an owner workspace named (the workspace launchers export KONDUCTOR_WS), its scripts must all be launchers into
# bench/ops: a plain copy there drifts from the versioned one (DEBT D-236).
ops_code=0
if [ -n "${KONDUCTOR_WS:-}" ]; then
  bash bench/ops/make-launchers.sh "$KONDUCTOR_WS" --check > "$LOGS/ops.log" 2>&1 || ops_code=$?
  sed 's/^/# /' "$LOGS/ops.log"
  if [ "$ops_code" = 0 ]; then echo "ok 1 - ops: every workspace owner script is a launcher into bench/ops"
  else echo "not ok 1 - ops: every workspace owner script is a launcher into bench/ops"; fi
fi
[ "$node_code" = 0 ] && [ "$py_code" = 0 ] && [ "$skips" = 0 ] && [ "$st_bad" = 0 ] && [ "$ops_code" = 0 ]
