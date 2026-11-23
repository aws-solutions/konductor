#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-run-pilot-wrappers.sh -- stub run of run-pilot-author.sh and run-pilot-run.sh on their PAID paths, with the
# repo's fake kiro-cli (bench/runner/test/fake-kp-kiro.js): no model, no credits. Own worktree (kp-pilot-stub, removed
# at the end), own work dir, baselines and logs under a new /tmp dir. Checks: both --dry-run passes make no call; step 1
# writes a baseline; step 3 refuses it unsigned (gate 1) and makes no call; after a sign-off it passes the three gates
# and runs the whole quick pilot within the cap; a rerun makes no new call. Then run-pilot-rerun.sh: the unit step
# refuses before the controls part; the controls part reuses the ladder cache, prints each check and stops; the unit
# step runs after both controls passed.
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
  env KP_PIN_FILE="$T/pinned-commit" KP_WT_NAME="$WT_NAME" KP_KIRO_BIN="$FAKE" KP_AUTH_DB="$T/auth.sqlite3" KP_PILOT_WORK="${TW:-$T/work}" \
    KP_BASELINES="$T/baselines" KP_LOG_ROOT="$T/logs" KP_PILOT_LOCK="$T/kp.lock" KP_HEAVY_LOCK="$T/heavy.lock" FAKE_KP_LOG="$T/calls" \
    BENCH_PAID_ENV_KEEP=FAKE_KP_LOG bash "$SELF/$1" "${@:2}" > "$T/out" 2>&1   # paid calls get an allowlisted env (FW-4)
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

# --- the rerun (run-pilot-rerun.sh): controls only on kp-pilot-2 from kp-pilot-1's cache, then the unit step ---
rerun() { KP_REF="$REF" run run-pilot-rerun.sh "$@"; }
: > "$T/calls"
rerun --unit --dry-run; rc=$?
[ "$rc" = 1 ] && grep -q "run the controls part first" "$T/out" && ok "rerun: the unit step refuses before the controls part" || { bad "unit-first rc $rc"; tail -n 20 "$T/out"; }
rerun --dry-run; rc=$?
[ "$rc" = 0 ] && [ "$(grep -c '^gate .*PASS$' "$T/out")" = 4 ] && grep -q '^  dose ladder: 120 calls, 120 cached (free), 0 new' "$T/out" && ok "rerun --dry-run: four gates pass, the ladder comes from the cache" || { bad "rerun dry rc $rc"; tail -n 20 "$T/out"; }
[ "$(grep -vc whoami "$T/calls")" = 0 ] && ok "rerun --dry-run makes no call" || bad "rerun dry calls: $(cat "$T/calls")"
[ -z "$(find "$T/work/runs/kp-pilot-2/judgments" -path '*convention-control*' -type f 2>/dev/null)" ] && ok "rerun: the old convention judgments are not copied" || bad "old convention judgments copied"
rerun; rc=$?
[ "$rc" = 0 ] && grep -q "^both controls passed. STOP here" "$T/out" && grep -q '^  pass  ' "$T/out" && grep -q -- '--unit$' "$T/out" && ok "rerun controls: each control's checks printed, then it stops at the unit step" || { bad "rerun controls rc $rc"; tail -n 30 "$T/out"; }
grep -qx "$REF" "$T/pinned-commit" && grep -q "rerun: convention control fix" "$T/pinned-commit.log" && ok "rerun: the pin moved once, logged" || bad "pin: $(cat "$T/pinned-commit")"
rec2="$T/work/runs/kp-pilot-2/stage-4/context-k-orchestrator-shared.json"
node -e 'const r=require(process.argv[1]);process.exit(r.quick.controls.results.every((x)=>(x.checks||[]).length>0)?0:1)' "$rec2" && ok "rerun record: each control keeps its checks" || bad "no checks in $rec2"
# A unit step killed mid-call, in a second work dir with no cached unit: the controls part, then 15 unit calls saved
# (225 counted), then one reserved call that never settled (15 more, its reply lost): 240 spent. The stub unit has
# 240 calls, so 225 are left (3,375): its full-size cap 3,600 fails gate 4 and 3,615 (15 more) passes. On the real
# pilot (225 calls) the same rule gives 3,375 fails and 3,390 passes.
TW="$T/work2" CONTROLS_CAP=3600 rerun; rc=$?   # no ladder cache here, so the controls cost 3,600 (stub, free)
[ "$rc" = 0 ] || { bad "resume setup: controls part rc $rc"; tail -n 20 "$T/out"; }
env KP_PILOT_WORK="$T/work2" KP_KIRO_BIN="$FAKE" KP_AUTH_DB="$T/auth.sqlite3" KP_BASELINES="$T/baselines" KP_PILOT_RUN=kp-pilot-2 \
  KP_PILOT_LEDGER="$T/work2/unit-ledger.jsonl" KP_PILOT_LOCK="$T/kp.lock" FAKE_KP_LOG="$T/calls" BENCH_PAID_ENV_KEEP=FAKE_KP_LOG \
  bash "$CLONE/.worktrees/$WT_NAME/bench/cap/pilot/run-pilot.sh" --cap 225 > "$T/out" 2>&1
printf '%s\n' '{"label":"answer","model":"claude-sonnet-5.5","counted":15,"reserved":true,"at":"2026-11-23T14:53:37.883Z"}' >> "$T/work2/unit-ledger.jsonl"
TW="$T/work2" UNIT_CAP=3600 rerun --unit --dry-run; rc=$?
[ "$rc" = 1 ] && grep -q "^gate 4, this step fits its cap:        FAIL" "$T/out" && grep -q "ledger spent 240: does not fit" "$T/out" && ok "resume after a kill: 240 spent, the unit's own cap fails gate 4" || { bad "resume at 3600 rc $rc"; tail -n 20 "$T/out"; }
TW="$T/work2" UNIT_CAP=3615 rerun --unit --dry-run; rc=$?
[ "$rc" = 0 ] && grep -q "^gate 4, this step fits its cap:        PASS" "$T/out" && grep -q "cap 3,615, ledger spent 240: fits" "$T/out" && ok "resume after a kill: UNIT_CAP raised by 15 passes gate 4" || { bad "resume at 3615 rc $rc"; tail -n 20 "$T/out"; }
rerun --unit; rc=$?
[ "$rc" = 0 ] && grep -q "^done: the record is" "$T/out" && grep -q "^gate 4, this step fits its cap:        PASS" "$T/out" && ok "rerun --unit: runs after both controls passed, within the resumed cap" || { bad "rerun unit rc $rc"; tail -n 20 "$T/out"; }

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
