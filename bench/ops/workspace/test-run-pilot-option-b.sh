#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-run-pilot-option-b.sh -- stub run of the 15-task path and option B, on the repo's fake kiro-cli: no model, no
# credits. Own worktree (kp-pilot-stub-b, removed at the end), own pin file, work dir and logs under a new /tmp dir.
# Checks: step 1 with t14 failing twice writes a 15-task draft; option B's dry run plans 2 calls and makes none; the
# paid path makes exactly 2 calls (deepseek writes, glm reviews), moves the pin and logs it; the freeze makes a 16-task
# baseline signed off; a 15-task draft freezes too and step 3's gates pass on it.
#
#   bash scripts/test-run-pilot-option-b.sh [COMMIT]     # COMMIT: what to check out (default the head of this test's own checkout)
set -uo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
W=$KONDUCTOR_WS
CLONE=$W/worktrees/konductor-plant
REF=${1:-$(git -C "$SELF" rev-parse HEAD)}
T=$(mktemp -d /tmp/kp-optb-test.XXXXXX)
WT_NAME=kp-pilot-stub-b
cleanup() { git -C "$CLONE" worktree remove --force "$CLONE/.worktrees/$WT_NAME" 2>/dev/null; chmod -R u+rwX "$T"; rm -rf "$T"; }
trap cleanup EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }
: > "$T/auth.sqlite3"
printf '%s\n' "$REF" > "$T/pinned-commit"
FAKE="$CLONE/.worktrees/$WT_NAME/bench/runner/test/fake-kp-kiro.js"
BL="$T/baselines/context-k-orchestrator-shared/baseline.json"
run() {  # run <script> [args]: one wrapper with every path pointed at the scratch dir and the fake kiro-cli
  env KP_PIN_FILE="$T/pinned-commit" KP_WT_NAME="$WT_NAME" KP_KIRO_BIN="$FAKE" KP_AUTH_DB="$T/auth.sqlite3" \
    KP_PILOT_WORK="$T/work" KP_BASELINES="$T/baselines" KP_LOG_ROOT="$T/logs" KP_PILOT_LOCK="$T/kp.lock" KP_HEAVY_LOCK="$T/heavy.lock" \
    FAKE_KP_LOG="$T/calls" BENCH_PAID_ENV_KEEP=FAKE_KP_LOG,FAKE_KP_FAIL,FAKE_KP_NOFIX "$@" > "$T/out" 2>&1   # paid calls get an allowlisted env (FW-4)
}
calls() { local n; n=$(grep -vc whoami "$T/calls" 2>/dev/null); echo "${n:-0}"; }

# Step 1 with t14 failing its review and its fix: 15 tasks, t14 dropped.
run env FAKE_KP_FAIL=t14 FAKE_KP_NOFIX=t14 bash "$SELF/run-pilot-author.sh"; rc=$?
[ "$rc" = 2 ] && [ -f "${BL%.json}.draft.json" ] && ok "step 1 writes a 15-task draft with t14 dropped" || { bad "step 1 rc $rc"; tail -n 15 "$T/out"; }
cp "${BL%.json}.draft.json" "$T/draft-15.json"

: > "$T/calls"
run env KP_REF="$REF" bash "$SELF/run-pilot-replace.sh" --dry-run; rc=$?
[ "$rc" = 0 ] && grep -q "at most 2 calls, worst case 30 credits" "$T/out" && grep -q "ledger spent 90; cap 120; the worst case fits" "$T/out" && ok "option B dry run: 2 calls, 30 counted, fits the 120 cap after 90" || { bad "dry rc $rc"; tail -n 10 "$T/out"; }
[ "$(calls)" = 0 ] && ok "the dry run made no call" || bad "dry-run calls: $(cat "$T/calls")"

# The paid path: KP_REF stands in for the branch head the pin moves to.
run env KP_REF="$REF" bash "$SELF/run-pilot-replace.sh"; rc=$?
[ "$rc" = 0 ] && grep -q "t14: replaced (pass" "$T/out" && ok "option B paid path replaces t14" || { bad "replace rc $rc"; tail -n 15 "$T/out"; }
[ "$(grep -v whoami "$T/calls" | awk '{print $1, $2}' | tr '\n' ',')" = "deepseek-3.2 write,glm-5 review," ] && ok "exactly 2 calls: deepseek writes, glm reviews" || bad "calls: $(cat "$T/calls")"
grep -q "replace t14" "$T/pinned-commit.log" && ok "the pin move is logged" || bad "no pin log"

run bash "$SELF/run-pilot-freeze.sh" "stub owner"; rc=$?
[ "$rc" = 0 ] && node -e 'const b=require(process.argv[1]);process.exit(b.source.signedOffBy==="stub owner"&&b.batches.reduce((n,x)=>n+x.tasks.length,0)===16&&!b.source.dropped.length?0:1)' "$BL" && ok "the freeze makes a 16-task baseline signed off" || { bad "freeze rc $rc"; tail -n 10 "$T/out"; }
run bash "$SELF/run-pilot-freeze.sh" "stub owner"; rc=$?
[ "$rc" != 0 ] && grep -q "already exists" "$T/out" && ok "a second freeze refuses and changes nothing" || bad "second freeze rc $rc"

# The 15-task path: freeze the draft as it was after step 1, and step 3's gates pass on it.
mv "$BL" "$T/baseline-16.json"
cp "$T/draft-15.json" "${BL%.json}.draft.json"
run bash "$SELF/run-pilot-freeze.sh" "stub owner"; rc=$?
[ "$rc" = 0 ] && grep -q "froze .*: 15 tasks" "$T/out" && ok "a 15-task draft freezes" || { bad "15 freeze rc $rc"; tail -n 10 "$T/out"; }
run bash "$SELF/run-pilot-run.sh" --dry-run; rc=$?
[ "$rc" = 0 ] && [ "$(grep -c '^gate .*PASS$' "$T/out")" = 3 ] && grep -q "tasks: 15; a reading needs 12 of them counted" "$T/out" && grep -q "calls: 537 " "$T/out" && ok "step 3 gates pass on 15 tasks: 537 calls, floor 12 of 15" || { bad "run dry rc $rc"; tail -n 15 "$T/out"; }

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
