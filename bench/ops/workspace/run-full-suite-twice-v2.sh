#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# KR k485f5870: two full bench suite runs with TMPDIR=/tmp on the current origin/feat/bench-pilot-nk head.
# Reading = new failures (fail in both runs, not in the agreed base set) + flaky tests (fail in one run only)
#         + leaked dirs (kbench-* / kplant-* in /tmp after the runs that were not there before)
#         + broken runs (timed out, no totals, or arm tests skipped). Exit 0 only at 0.
# v2 (review 2026-11-23 F1): the arm plant now runs. Each run is the bench's one test entry point,
# bench/scripts/test.sh --tap (FW-23), with BENCH_ARM_PYTHON and LD_LIBRARY_PATH: the node suite with
# BENCH_REQUIRE_ARM=1, then the Python plant tests (bench/physical/test) as "py:" TAP lines, in one TAP stream.
# An arm test that still skips (node or Python) makes the run broken. No arm venv: STOP.
# Free: no model call. Runs under the heavy lock, nice 19, a hard timeout per run.
# The suite runs in its own detached worktree (never worktrees/pilot); it is re-pointed at the head each time.
# Output: reports/full-suite-<ts>/summary.txt, run-N.tap, failures-N.txt.
# Overrides (tests use them): R (a checkout to use as is: no fetch, no worktree), SUITE_CMD (the suite command),
# ARM_PYTHON, ARM_FFI, LOCK, RUN_TIMEOUT (seconds, default 7200), LOCK_WAIT (seconds, default 3600),
# OUT_ROOT, LEAK_DIR (default /tmp).
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

WS=$KONDUCTOR_WS
CLONE=$WS/worktrees/konductor-plant
WT=$CLONE/.worktrees/full-suite
BRANCH=feat/bench-pilot-nk
LOCK=${LOCK:-/var/tmp/konductor-heavy.lock}
RUN_TIMEOUT=${RUN_TIMEOUT:-7200}
LOCK_WAIT=${LOCK_WAIT:-3600}
OUT_ROOT=${OUT_ROOT:-$WS/reports}
LEAK_DIR=${LEAK_DIR:-/tmp}
ARM_PYTHON=${ARM_PYTHON:-/home/$USER/.cache/konductor-arm/venv/bin/python}
ARM_FFI=${ARM_FFI:-/local/apollo/package/local_1/AL2023_x86_64/Libffi/Libffi-119967.0-0/lib}
# The private counted set: plant-wave.test.js runs its full prepare-only case only with it (D-182 assumes no host path).
PLANT_CS=${PLANT_CS:-$WS/plant-counted-set}
# A bench dir in LEAK_DIR after the runs counts as a leak only if it is still there LEAK_SETTLE seconds later. LEAK_DIR
# is shared with every session on the host, so a dir that goes away was a live run's own dir, not one a test left.
LEAK_SETTLE=${LEAK_SETTLE:-120}
# The agreed command, from bench/test-base-set.txt: node base set, then the Python plant tests.
SUITE_CMD=${SUITE_CMD:-bash bench/scripts/test.sh --tap}
TS=$(date -u +%Y%m%d-%H%M%S)
OUT=$OUT_ROOT/full-suite-$TS
REPO=${R:-}
HEAD_SHA=""
mkdir -p "$OUT"
say() { echo "[full-suite $(date -u +%H:%M:%S)] $*" | tee -a "$OUT/run.log"; }
die() { say "STOP: $*"; echo "STOP: $*" > "$OUT/summary.txt"; exit 2; }

# ---- the arm venv: without it the arm tests cannot run, so the reading would say nothing about the arm
"$ARM_PYTHON" -c pass 2>/dev/null || [ ! -f "$(dirname "$(dirname "$ARM_PYTHON")")/pyvenv.cfg" ] \
  || die "$ARM_PYTHON does not run (its base Python is gone?); rebuild it: bash $KONDUCTOR_WS/scripts/rebuild-arm-venv.sh --venv $(dirname "$(dirname "$ARM_PYTHON")")"
LD_LIBRARY_PATH="$ARM_FFI" "$ARM_PYTHON" -c 'import mujoco, cedarpy' 2>/dev/null \
  || die "$ARM_PYTHON cannot import mujoco and cedarpy (LD_LIBRARY_PATH=$ARM_FFI); set ARM_PYTHON to the arm venv's python"
[ -d "$PLANT_CS/release/tasks" ] || die "no counted set at $PLANT_CS (it must hold release/tasks): set PLANT_CS, or the live plant-wave test skips"

# ---- the checkout: a detached worktree at the current origin head
if [ -z "$REPO" ]; then
  [ -d "$CLONE/.git" ] || die "no clone at $CLONE"
  git -C "$CLONE" fetch -q origin "$BRANCH" || die "git fetch failed"
  HEAD_SHA=$(git -C "$CLONE" rev-parse "origin/$BRANCH")
  if [ -e "$WT" ]; then
    [ -z "$(git -C "$WT" status --porcelain)" ] || die "$WT has changes; it is this script's own worktree, look before reusing it"
    git -C "$WT" checkout -q --detach "$HEAD_SHA"
  else
    git -C "$CLONE" worktree add -q --detach "$WT" "$HEAD_SHA"
  fi
  REPO=$WT
else
  HEAD_SHA=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo "not a git checkout")
fi
BASE_SET=$REPO/bench/test-base-set.txt
say "head $HEAD_SHA in $REPO; arm python $ARM_PYTHON"

# ---- leaked-dir count: bench temp dirs in LEAK_DIR, by name
leak_list() { find "$LEAK_DIR" -maxdepth 1 -mindepth 1 \( -name 'kbench-*' -o -name 'kplant-*' \) -printf '%f\n' 2>/dev/null | sort; }
leak_list > "$OUT/leaks-before.txt"

# ---- failing test names: TAP "not ok N - name" at any depth; Python tests read "py: <test id>"
failures_of() { sed -n 's/^ *not ok [0-9][0-9]* - \(.*\)$/\1/p' "$1" | sed 's/ # .*$//' | sort -u; }

run_once() {   # run_once N
  local n=$1 code=0 armskips
  local env=(env TMPDIR=/tmp LD_LIBRARY_PATH="$ARM_FFI" BENCH_ARM_PYTHON="$ARM_PYTHON" PLANT_CS="$PLANT_CS")
  say "run $n: start (timeout ${RUN_TIMEOUT}s)"
  (cd "$REPO" && "${env[@]}" timeout -k 60 "$RUN_TIMEOUT" nice -n 19 bash -c "$SUITE_CMD") > "$OUT/run-$n.tap" 2>&1 || code=$?
  failures_of "$OUT/run-$n.tap" > "$OUT/failures-$n.txt"
  say "run $n: exit $code, $(grep -c . "$OUT/failures-$n.txt" || true) failing test(s), $(grep -E '^# (pass|fail|skipped|py tests|py fail)' "$OUT/run-$n.tap" | tr '\n' ' ')"
  # A run that timed out, ended with no node or no Python totals (it crashed), or skipped arm tests cannot read as clean.
  if [ "$code" = 124 ] || [ "$code" = 137 ]; then echo "run $n timed out after ${RUN_TIMEOUT}s" >> "$OUT/broken-runs.txt"
  else
    grep -Eq '^# tests [1-9]' "$OUT/run-$n.tap" || echo "run $n ended (exit $code) with no test totals" >> "$OUT/broken-runs.txt"
    grep -Eq '^# py tests [1-9]' "$OUT/run-$n.tap" || echo "run $n python tests ended (exit $code) with no totals" >> "$OUT/broken-runs.txt"
  fi
  armskips=$(grep -Ec '# SKIP (no Python with|.*(MuJoCo|cedarpy))' "$OUT/run-$n.tap" || true)
  [ "$armskips" = 0 ] || echo "run $n skipped $armskips arm test(s) with an arm python set" >> "$OUT/broken-runs.txt"
  return 0
}

# ---- both runs under the heavy lock
exec 9>"$LOCK"
say "waiting for the heavy lock $LOCK (up to ${LOCK_WAIT}s)"
flock -x -w "$LOCK_WAIT" 9 || die "could not take the heavy lock within ${LOCK_WAIT}s"
run_once 1
run_once 2
flock -u 9
leak_list > "$OUT/leaks-after.txt"

# ---- the reading
grep -v '^#' "$BASE_SET" 2>/dev/null | sed '/^[[:space:]]*$/d' | sort -u > "$OUT/base-set.txt" || true
comm -12 "$OUT/failures-1.txt" "$OUT/failures-2.txt" | comm -23 - "$OUT/base-set.txt" > "$OUT/new-failures.txt"
# A test that fails in one run only is flaky, base set or not.
comm -3 "$OUT/failures-1.txt" "$OUT/failures-2.txt" | sed 's/^\t//' | sort -u > "$OUT/flaky.txt"
comm -13 "$OUT/leaks-before.txt" "$OUT/leaks-after.txt" > "$OUT/leak-candidates.txt"
if [ -s "$OUT/leak-candidates.txt" ]; then
  say "$(grep -c . "$OUT/leak-candidates.txt") new bench dir(s) in $LEAK_DIR; checking again in ${LEAK_SETTLE}s"
  sleep "$LEAK_SETTLE"
fi
: > "$OUT/leaked-dirs.txt"; : > "$OUT/leaks-transient.txt"
while read -r d; do
  if [ -e "$LEAK_DIR/$d" ]; then echo "$d" >> "$OUT/leaked-dirs.txt"; else echo "$d" >> "$OUT/leaks-transient.txt"; fi
done < "$OUT/leak-candidates.txt"
count() { grep -c . "$1" || true; }
NEW=$(count "$OUT/new-failures.txt")
FLAKY=$(count "$OUT/flaky.txt")
LEAKED=$(count "$OUT/leaked-dirs.txt")
BROKEN=$( [ -f "$OUT/broken-runs.txt" ] && count "$OUT/broken-runs.txt" || echo 0)
TOTAL=$((NEW + FLAKY + LEAKED + BROKEN))
{
  echo "KR k485f5870 reading: $TOTAL"
  echo "head: $HEAD_SHA"
  echo "new failures (both runs, not in the base set): $NEW"
  echo "flaky (one run only): $FLAKY"
  echo "leaked kbench-*/kplant-* dirs in $LEAK_DIR: $LEAKED"
  echo "broken runs (timed out, no totals, or arm tests skipped; counted too): $BROKEN"
  for n in 1 2; do
    echo "run $n: $(grep -E '^# (tests|pass|fail|skipped|py tests|py pass|py fail|py skipped)' "$OUT/run-$n.tap" | tr '\n' ' ')"
  done
  [ -s "$OUT/leaks-transient.txt" ] && echo "not counted: $(grep -c . "$OUT/leaks-transient.txt") dir(s) gone within ${LEAK_SETTLE}s (another process's live dir): $(tr '\n' ' ' < "$OUT/leaks-transient.txt")"
  for f in new-failures flaky leaked-dirs broken-runs; do
    [ -s "$OUT/$f.txt" ] && { echo "--- $f"; cat "$OUT/$f.txt"; }
  done
  true
} > "$OUT/summary.txt"
say "summary: $OUT/summary.txt"
cat "$OUT/summary.txt"
[ "$TOTAL" = 0 ]
