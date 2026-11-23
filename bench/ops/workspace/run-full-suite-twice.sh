#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SUPERSEDED by scripts/run-full-suite-twice-v2.sh (review 2026-11-23); kept for reference, use the v2 script.
# KR k485f5870: two full bench suite runs with TMPDIR=/tmp on the current origin/feat/bench-pilot-nk head.
# Reading = new failures (fail in both runs, not in the agreed base set) + flaky tests (fail in one run only)
#         + leaked dirs (kbench-* / kplant-* in /tmp after the runs that were not there before). Exit 0 only at 0.
# Free: no model call. Runs under the heavy lock, nice 19, a hard timeout per run.
# The suite runs in its own detached worktree (never worktrees/pilot); it is re-pointed at the head each time.
# Output: reports/full-suite-<ts>/summary.txt, run-1.tap, run-2.tap, failures-1.txt, failures-2.txt.
# Overrides (tests use them): R (a checkout to use as is: no fetch, no worktree), SUITE_CMD (the suite command),
# LOCK, RUN_TIMEOUT (seconds, default 7200), LOCK_WAIT (seconds, default 3600), OUT_ROOT, LEAK_DIR (default /tmp).
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
# The agreed command, from bench/test-base-set.txt.
SUITE_CMD=${SUITE_CMD:-node --test --test-concurrency=1 --test-reporter=tap "bench/runner/test/*.test.js" "bench/skilleval/test/*.test.js"}
TS=$(date -u +%Y%m%d-%H%M%S)
OUT=$OUT_ROOT/full-suite-$TS
REPO=${R:-}
HEAD_SHA=""
mkdir -p "$OUT"
say() { echo "[full-suite $(date -u +%H:%M:%S)] $*" | tee -a "$OUT/run.log"; }
die() { say "STOP: $*"; echo "STOP: $*" > "$OUT/summary.txt"; exit 2; }

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
say "head $HEAD_SHA in $REPO"

# ---- leaked-dir count: bench temp dirs in LEAK_DIR, by name
leak_list() { find "$LEAK_DIR" -maxdepth 1 -mindepth 1 \( -name 'kbench-*' -o -name 'kplant-*' \) -printf '%f\n' 2>/dev/null | sort; }
leak_list > "$OUT/leaks-before.txt"

# ---- failing test names of one TAP file ("not ok N - name", any depth), sorted and unique
failures_of() { sed -n 's/^ *not ok [0-9][0-9]* - \(.*\)$/\1/p' "$1" | sed 's/ # .*$//' | sort -u; }

run_once() {   # run_once N
  local n=$1 code=0
  say "run $n: start (timeout ${RUN_TIMEOUT}s)"
  (cd "$REPO" && TMPDIR=/tmp timeout -k 60 "$RUN_TIMEOUT" nice -n 19 bash -c "$SUITE_CMD") > "$OUT/run-$n.tap" 2>&1 || code=$?
  failures_of "$OUT/run-$n.tap" > "$OUT/failures-$n.txt"
  say "run $n: exit $code, $(grep -c . "$OUT/failures-$n.txt" || true) failing test(s), $(grep -E '^# (pass|fail|skipped)' "$OUT/run-$n.tap" | tr '\n' ' ')"
  # A run that timed out, or ended with no TAP totals (it crashed), cannot read as clean.
  if [ "$code" = 124 ] || [ "$code" = 137 ]; then echo "run $n timed out after ${RUN_TIMEOUT}s" >> "$OUT/broken-runs.txt"
  elif ! grep -Eq '^# tests [1-9]' "$OUT/run-$n.tap"; then echo "run $n ended (exit $code) with no test totals" >> "$OUT/broken-runs.txt"; fi
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
comm -13 "$OUT/leaks-before.txt" "$OUT/leaks-after.txt" > "$OUT/leaked-dirs.txt"
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
  echo "broken runs (timed out after ${RUN_TIMEOUT}s or no test totals; counted too): $BROKEN"
  echo "run 1: $(grep -E '^# (tests|pass|fail|skipped)' "$OUT/run-1.tap" | tr '\n' ' ')"
  echo "run 2: $(grep -E '^# (tests|pass|fail|skipped)' "$OUT/run-2.tap" | tr '\n' ' ')"
  for f in new-failures flaky leaked-dirs broken-runs; do
    [ -s "$OUT/$f.txt" ] && { echo "--- $f"; cat "$OUT/$f.txt"; }
  done
  true
} > "$OUT/summary.txt"
say "summary: $OUT/summary.txt"
cat "$OUT/summary.txt"
[ "$TOTAL" = 0 ]
