#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-run-pilot-wrappers.sh -- stub run of run-pilot-author.sh and run-pilot-run.sh on their PAID paths, with the
# repo's fake kiro-cli (bench/runner/test/fake-kp-kiro.js): no model, no credits. Own worktree (kp-pilot-stub, removed
# at the end), own work dir, baselines and logs under a new /tmp dir. Checks: both --dry-run passes make no call; step 1
# writes a baseline; step 3 refuses it unsigned (gate 1) and makes no call; after a sign-off it passes the three gates
# and runs the whole quick pilot within the cap; a rerun makes no new call.
#
#   bash scripts/test-run-pilot-wrappers.sh [COMMIT]     # COMMIT: what to check out (default the arm-free-prep head)
set -uo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
W=$KONDUCTOR_WS
CLONE=$W/worktrees/konductor-plant
REF=${1:-$(git -C "$CLONE/.worktrees/arm-free-prep" rev-parse HEAD)}
T=$(mktemp -d /tmp/kp-wrap-test.XXXXXX)
WT_NAME=kp-pilot-stub
cleanup() { git -C "$CLONE" worktree remove --force "$CLONE/.worktrees/$WT_NAME" 2>/dev/null; chmod -R u+rwX "$T"; rm -rf "$T"; }
trap cleanup EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }
: > "$T/auth.sqlite3"
# The pin: both steps must run on this commit, whatever the branch head is (a push between the steps changes nothing).
printf '%s\n' "$REF" > "$T/pinned-commit"
FAKE="$CLONE/.worktrees/$WT_NAME/bench/runner/test/fake-kp-kiro.js"
run() {  # run <script> [args]: one wrapper with every path pointed at the scratch dir and the fake kiro-cli
  env KP_PIN_FILE="$T/pinned-commit" KP_WT_NAME="$WT_NAME" KP_KIRO_BIN="$FAKE" KP_AUTH_DB="$T/auth.sqlite3" KP_PILOT_WORK="$T/work" \
    KP_BASELINES="$T/baselines" KP_LOG_ROOT="$T/logs" KP_PILOT_LOCK="$T/kp.lock" KP_HEAVY_LOCK="$T/heavy.lock" FAKE_KP_LOG="$T/calls" \
    bash "$SELF/$1" "${@:2}" > "$T/out" 2>&1
}
BL="$T/baselines/context-k-orchestrator-shared/baseline.json"

# The fake must exist in the checkout: the first wrapper run creates it, so a first dry run sets it up.
run run-pilot-author.sh --dry-run; rc=$?
[ "$rc" = 0 ] && grep -q "dry run, no call made: at most 8 calls, worst case 120 credits" "$T/out" && ok "author --dry-run: plan, no call" || { bad "author dry run rc $rc"; cat "$T/out"; }
: > "$T/calls"
run run-pilot-author.sh; rc=$?
[ "$rc" = 0 ] && [ -f "$BL" ] && ok "author paid path writes the baseline" || { bad "author paid rc $rc"; tail -n 20 "$T/out"; }
grep -c 'glm-5\|deepseek-3.2' "$T/calls" | grep -qx 4 && ok "author made 4 calls (write and review per batch)" || bad "author calls: $(cat "$T/calls")"
ls "$T/logs" | grep -q '^kp-pilot-author-[0-9-]*$' && ok "author log under the log root" || bad "logs: $(ls "$T/logs")"
grep -qx "$REF" "$T"/logs/kp-pilot-author-[0-9]*/commit.txt && ok "step 1 ran on the pinned commit and recorded it" || bad "step 1 commit: $(cat "$T"/logs/kp-pilot-author-[0-9]*/commit.txt)"

: > "$T/calls"
run run-pilot-run.sh; rc=$?
[ "$rc" = 1 ] && grep -q "gate 1, baseline fresh and signed off: FAIL" "$T/out" && grep -q "STOP: not started" "$T/out" && ok "run refuses an unsigned baseline" || { bad "unsigned rc $rc"; tail -n 20 "$T/out"; }
[ "$(grep -vc whoami "$T/calls")" = 0 ] && ok "no model call before the gates pass" || bad "calls before the gates: $(cat "$T/calls")"

node -e 'const f=process.argv[1],fs=require("fs");const b=JSON.parse(fs.readFileSync(f));b.source.signedOffBy="stub owner";fs.writeFileSync(f,JSON.stringify(b,null,2))' "$BL"
run run-pilot-run.sh --dry-run; rc=$?
[ "$rc" = 0 ] && [ "$(grep -c '^gate .*PASS$' "$T/out")" = 3 ] && ok "run --dry-run: the three gates pass after the sign-off" || { bad "signed dry run rc $rc"; tail -n 20 "$T/out"; }
run run-pilot-run.sh; rc=$?
[ "$rc" = 0 ] && grep -q "done: the record is under" "$T/out" && ok "run paid path finishes the quick pilot on the fake" || { bad "run rc $rc"; tail -n 20 "$T/out"; }
grep -q "^waiting for the heavy lock $T/heavy.lock" "$T/out" && ok "step 3 held the heavy lock while it spent" || bad "no heavy lock line"
for c in "$T"/logs/kp-pilot-run-[0-9]*/commit.txt; do grep -qx "$REF" "$c" || bad "step 3 commit $(cat "$c")"; done; ok "step 3 ran on the same pinned commit"
rec=$(find "$T/work/runs" -name 'context-k-orchestrator-shared.json' | head -1)
node -e 'const r=require(process.argv[1]);process.exit(r.quick.commit===process.argv[2]&&r.quick.controls.passed?0:1)' "$rec" "$REF" && ok "the record names the pinned commit, and both controls passed" || bad "record commit or controls: $rec"
n=$(grep -vc whoami "$T/calls")
spent=$(node -e 'console.log(require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).reduce((s,l)=>s+JSON.parse(l).counted,0))' "$T/work/run-ledger.jsonl")
[ "$spent" -le 8760 ] && ok "run: $n calls, $spent counted credits, within 8,760" || bad "spent $spent"
run run-pilot-run.sh; rc=$?
[ "$rc" = 0 ] && [ "$(grep -vc whoami "$T/calls")" = "$n" ] && ok "a rerun makes no new call" || bad "rerun rc $rc, calls $(grep -vc whoami "$T/calls")"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
