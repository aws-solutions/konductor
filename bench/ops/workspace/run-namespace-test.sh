#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# DEBT D-165: runs ONLY the namespace case of bench/runner/test/real-run.test.js on the current origin/feat/bench-pilot-nk
# head, with TMPDIR=/tmp, and keeps the full output. Run it from the owner's terminal: the agent sandbox blocks unshare,
# so there the case skips. Free, no model call, no heavy lock (a fake agent and one pytest run; no browser, no MuJoCo).
# Output: reports/ns-test-<ts>.log. Exit: the test's own exit code (124 on the 20-minute timeout).
# Overrides (tests use them): R (a checkout to use as is: no fetch, no worktree), OUT_ROOT, NS_TIMEOUT (seconds).
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

WS=$KONDUCTOR_WS
CLONE=$WS/worktrees/konductor-plant
WT=$CLONE/.worktrees/ns-test
BRANCH=feat/bench-pilot-nk
OUT_ROOT=${OUT_ROOT:-$WS/reports}
NS_TIMEOUT=${NS_TIMEOUT:-1200}
CASE='inside the namespace the run still scores correctly with the offline check'
LOG=$OUT_ROOT/ns-test-$(date -u +%Y%m%d-%H%M%S).log
REPO=${R:-}
mkdir -p "$OUT_ROOT"

if [ -z "$REPO" ]; then
  git -C "$CLONE" fetch -q origin "$BRANCH"
  head=$(git -C "$CLONE" rev-parse "origin/$BRANCH")
  if [ -e "$WT" ]; then
    [ -z "$(git -C "$WT" status --porcelain)" ] || { echo "STOP: $WT has changes" | tee "$LOG"; exit 2; }
    git -C "$WT" checkout -q --detach "$head"
  else
    git -C "$CLONE" worktree add -q --detach "$WT" "$head"
  fi
  REPO=$WT
fi

{
  echo "== D-165 namespace test, $(date -u +%FT%TZ)"
  echo "head: $(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo 'not a git checkout')"
  echo "== environment the test sees"
  echo "node $(node --version); python3 $(command -v python3 || echo MISSING)"
  python3 --version 2>&1 || true
  python3 -m pytest --version 2>&1 || true
  unshare --user --map-root-user true 2>&1 && echo "unshare --user: works" || echo "unshare --user: refused (the case will skip)"
  echo "== the test (timeout ${NS_TIMEOUT}s)"
} 2>&1 | tee "$LOG"

code=0
(cd "$REPO" && TMPDIR=/tmp timeout -k 30 "$NS_TIMEOUT" nice -n 19 \
  node --test --test-reporter=tap --test-name-pattern="$CASE" bench/runner/test/real-run.test.js) 2>&1 | tee -a "$LOG" || code=${PIPESTATUS[0]}
code=${code:-0}
echo "== exit $code; log: $LOG" | tee -a "$LOG"
exit "$code"
