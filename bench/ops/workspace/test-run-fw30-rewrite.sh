#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-run-fw30-rewrite.sh -- stub run of run-fw30-rewrite.sh on its PAID path with the repo's fake kiro-cli
# (bench/runner/test/fake-kp-kiro.js): no model, no credits. Own worktree (fw30-stub, removed at the end), own work
# dir, baselines and logs under a new scratch dir. Checks: --dry-run plans 8 calls with deepseek-3.2 writing and makes
# no call; a cap over 120 is refused; the paid path writes the baseline with deepseek-3.2 as writer and glm-5 as
# reviewer; a rerun makes no new call.
#
#   bash scripts/test-run-fw30-rewrite.sh [COMMIT]     # COMMIT: what to check out (default the head of this checkout)
set -uo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLONE=$KONDUCTOR_WS/worktrees/konductor-plant
REF=${1:-$(git -C "$SELF" rev-parse HEAD)}
# cap unit-author refuses a work dir under the home folder, so the scratch dir is under /var/tmp.
T=$(mktemp -d /var/tmp/fw30-test.XXXXXX)
WT_NAME=fw30-stub
cleanup() { git -C "$CLONE" worktree remove --force "$CLONE/.worktrees/$WT_NAME" 2>/dev/null; chmod -R u+rwX "$T"; rm -rf "$T"; }
trap cleanup EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }
: > "$T/auth.sqlite3"
printf '%s\n' "$REF" > "$T/pinned-commit"
FAKE="$CLONE/.worktrees/$WT_NAME/bench/runner/test/fake-kp-kiro.js"
run() {  # run [args]: the wrapper with every path pointed at the scratch dir and the fake kiro-cli
  env KP_PIN_FILE="$T/pinned-commit" KP_WT_NAME="$WT_NAME" KP_KIRO_BIN="$FAKE" KP_AUTH_DB="$T/auth.sqlite3" KP_PILOT_WORK="$T/work" \
    KP_BASELINES="$T/baselines" KP_LOG_ROOT="$T/logs" FW30_LOCK="$T/fw30.lock" KP_HEAVY_LOCK="$T/heavy.lock" FAKE_KP_LOG="$T/calls" "$@" \
    > "$T/out" 2>&1
}
BL="$T/baselines/context-k-orchestrator-shared/baseline.json"

run bash "$SELF/run-fw30-rewrite.sh" --dry-run; rc=$?
[ "$rc" = 0 ] && grep -q "dry run, no call made: at most 8 calls, worst case 120 credits" "$T/out" && grep -q "^b1 write   deepseek-3.2" "$T/out" \
  && ok "--dry-run: 8 calls planned, deepseek-3.2 writes" || { bad "dry run rc $rc"; cat "$T/out"; }
[ ! -s "$T/calls" ] || [ "$(grep -vc whoami "$T/calls")" = 0 ] && ok "--dry-run makes no model call" || bad "dry-run calls: $(cat "$T/calls")"
run env FW30_CAP=200 bash "$SELF/run-fw30-rewrite.sh" --dry-run; rc=$?
[ "$rc" = 64 ] && grep -q "over the 120" "$T/out" && ok "a cap over 120 is refused" || bad "cap 200 rc $rc"
: > "$T/calls"
run bash "$SELF/run-fw30-rewrite.sh"; rc=$?
[ "$rc" = 0 ] && [ -f "$BL" ] && ok "paid path writes the baseline" || { bad "paid rc $rc"; tail -n 20 "$T/out"; }
node -e 'const b=require(process.argv[1]);process.exit(b.source.writtenBy==="deepseek-3.2"&&b.source.reviewedBy==="glm-5"&&b.source.briefs==="briefs-fw30.json"?0:1)' "$BL" \
  && ok "the baseline records deepseek-3.2 as writer, glm-5 as reviewer, briefs-fw30.json" || bad "baseline source: $(node -e 'console.log(JSON.stringify(require(process.argv[1]).source))' "$BL" 2>&1)"
grep -q "^waiting for the heavy lock $T/heavy.lock" "$T/out" && ok "the paid path held the heavy lock" || bad "no heavy lock line"
n=$(grep -vc whoami "$T/calls")
run bash "$SELF/run-fw30-rewrite.sh"; rc=$?
[ "$(grep -vc whoami "$T/calls")" = "$n" ] && ok "a rerun makes no new call" || bad "rerun rc $rc, calls $(grep -vc whoami "$T/calls")"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
