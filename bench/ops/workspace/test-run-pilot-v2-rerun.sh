#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-run-pilot-v2-rerun.sh -- stub run of run-pilot-v2-rerun.sh on its PAID path with the repo's fake kiro-cli
# (bench/runner/test/fake-kp-kiro.js): no model, no credits. Own worktrees (removed at the end), own work dir,
# baselines and logs under a new scratch dir. Setup on the fake: a signed-off 15-task v1, a full paid run kp-pilot-2 on
# it (so the controls are saved), then the v2 rewrite and a sign-off. Checks: no v2, no review mark or a mark for other
# tasks each stop before any call; --skip-fable-review passes gate 0; --plan passes all gates with the controls 0 new
# and makes no call; a cap too small fails gate 5; the paid path runs, both unit arms got the role line, the controls
# made no call, it held the heavy lock and pinned the commit once; a rerun makes no new call.
#
#   bash scripts/test-run-pilot-v2-rerun.sh [COMMIT]     # COMMIT: what to check out (default the head of this checkout)
set -uo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLONE=$KONDUCTOR_WS/worktrees/konductor-plant
REF=${1:-$(git -C "$SELF" rev-parse HEAD)}
T=$(mktemp -d /var/tmp/kp-v2rerun-test.XXXXXX)
WT_A=kp-v2rerun-stub-a   # the rewrite's checkout
WT_B=kp-v2rerun-stub-b   # the rerun's checkout
cleanup() { for w in "$WT_A" "$WT_B"; do git -C "$CLONE" worktree remove --force "$CLONE/.worktrees/$w" 2>/dev/null; done; chmod -R u+rwX "$T"; rm -rf "$T"; }
trap cleanup EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }
: > "$T/auth.sqlite3"
git -C "$CLONE" worktree add -q --detach "$CLONE/.worktrees/$WT_A" "$REF"
WT=$CLONE/.worktrees/$WT_A
FAKE="$WT/bench/runner/test/fake-kp-kiro.js"
KEEP=BENCH_PAID_ENV_KEEP=FAKE_KP_LOG,FAKE_KP_FAIL,FAKE_KP_NOFIX
V1DIR="$T/v1"; V1="$V1DIR/context-k-orchestrator-shared/baseline.json"
V2DIR="$T/v2"; V2="$V2DIR/context-k-orchestrator-shared/baseline.json"
MARK="$T/fable-review-passed"
calls() { [ -s "$T/calls" ] && grep -vc whoami "$T/calls" || echo 0; }
rerun() {  # rerun [env...] -- [args]: the rerun wrapper with every path pointed at the scratch dir and the fake
  env KP_PIN_FILE="$T/rerun-pin" KP_REF="$REF" KP_WT_NAME="$WT_B" KP_KIRO_BIN="$FAKE" KP_AUTH_DB="$T/auth.sqlite3" KP_PILOT_WORK="$T/work" \
    V2_BASELINES="$V2DIR" V2_REVIEW_MARK="$MARK" KP_LOG_ROOT="$T/logs" KP_PILOT_LOCK="$T/kp.lock" KP_HEAVY_LOCK="$T/heavy.lock" \
    FAKE_KP_LOG="$T/calls" "$KEEP" "$@" > "$T/out" 2>&1
}

# --- setup on the fake: v1 (t14 dropped, signed off), the full run kp-pilot-2 on it, then v2 and its sign-off ---
mkdir -p "$(dirname "$V1")"
author() { env FAKE_KP_LOG="$T/setup-calls" FAKE_KP_FAIL=t14 FAKE_KP_NOFIX=t14 "$KEEP" node "$WT/bench/runner/bench.js" cap unit-author \
  --kind context --unit k-orchestrator-shared --work "$T/v1work" --ledger "$T/v1ledger.jsonl" --cap 120 --out "$V1" \
  --kiro-bin "$FAKE" --auth-db "$T/auth.sqlite3" --repo-root "$WT" "$@" > "$T/setup.out" 2>&1; }
author; author --sign-off "stub owner"
env KP_PILOT_WORK="$T/work" KP_KIRO_BIN="$FAKE" KP_AUTH_DB="$T/auth.sqlite3" KP_BASELINES="$V1DIR" KP_PILOT_RUN=kp-pilot-2 \
  KP_PILOT_LEDGER="$T/work/unit-ledger.jsonl" KP_PILOT_LOCK="$T/kp.lock" FAKE_KP_LOG="$T/setup-calls" "$KEEP" \
  bash "$WT/bench/cap/pilot/run-pilot.sh" --cap 100000 > "$T/setup.out" 2>&1 \
  && ok "setup: a signed-off 15-task v1 and a full run kp-pilot-2 on the fake" || { bad "setup run"; tail -n 20 "$T/setup.out"; }
rerun bash "$SELF/run-pilot-v2-rerun.sh" --plan; rc=$?
[ "$rc" = 1 ] && grep -q "no baseline v2 at" "$T/out" && [ ! -e "$CLONE/.worktrees/$WT_B" ] && ok "no v2: it stops before any checkout or call" || { bad "no-v2 rc $rc"; tail -n 5 "$T/out"; }
env KP_PIN_FILE="$T/rewrite-pin" KP_REF="$REF" KP_WT_NAME="$WT_A" KP_KIRO_BIN="$FAKE" KP_AUTH_DB="$T/auth.sqlite3" KP_PILOT_WORK="$T/v2work" \
  KP_BASELINES="$V2DIR" KP_LOG_ROOT="$T/logs" V2_LOCK="$T/v2.lock" KP_HEAVY_LOCK="$T/heavy.lock" V2_FROM="$V1" FAKE_KP_LOG="$T/setup-calls" "$KEEP" \
  bash "$SELF/run-pilot-v2-rewrite.sh" > "$T/setup.out" 2>&1 || { bad "v2 rewrite"; tail -n 20 "$T/setup.out"; }
node -e 'const f=process.argv[1],fs=require("fs");const b=JSON.parse(fs.readFileSync(f));b.source.signedOffBy="stub owner";fs.writeFileSync(f,JSON.stringify(b,null,2))' "$V2"
SHA=$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(require("crypto").createHash("sha256").update(JSON.stringify(b.batches)).digest("hex"))' "$V2")

# --- gate 0: the review mark ---
: > "$T/calls"
rerun bash "$SELF/run-pilot-v2-rerun.sh" --plan; rc=$?
[ "$rc" = 1 ] && grep -q "no Fable review mark" "$T/out" && ok "no review mark: it stops" || { bad "no-mark rc $rc"; tail -n 5 "$T/out"; }
printf 'tasks-sha256 %s\n' "$(printf '0%.0s' $(seq 64))" > "$MARK"
rerun bash "$SELF/run-pilot-v2-rerun.sh" --plan; rc=$?
[ "$rc" = 1 ] && grep -q "the Fable review mark is for other tasks" "$T/out" && ok "a mark for other tasks: it stops" || { bad "wrong-mark rc $rc"; tail -n 5 "$T/out"; }
rerun bash "$SELF/run-pilot-v2-rerun.sh" --plan --skip-fable-review; rc=$?
[ "$rc" = 0 ] && grep -q "gate 0, Fable review: SKIPPED by --skip-fable-review" "$T/out" && grep -q -- "--skip-fable-review$" "$T/out" && ok "--skip-fable-review passes gate 0 and is named in the paid command" || { bad "skip rc $rc"; tail -n 20 "$T/out"; }
printf 'tasks-sha256 %s\n' "$SHA" > "$MARK"

# --- the plan ---
rerun bash "$SELF/run-pilot-v2-rerun.sh" --plan; rc=$?
[ "$rc" = 0 ] && [ "$(grep -c '^gate [0-5],.*PASS$' "$T/out")" = 6 ] && grep -q '^  convention control: 120 calls, 120 cached (free), 0 new' "$T/out" \
  && grep -q '^  dose ladder: 120 calls, 120 cached (free), 0 new' "$T/out" && ok "--plan: six gates pass, the controls all cached" || { bad "plan rc $rc"; tail -n 25 "$T/out"; }
grep -q '^  the unit: 225 calls, 10 cached (free), 215 new, 3,225 counted' "$T/out" && ok "--plan: 215 new unit calls, 3,225 counted, under 3,240" || { bad "plan numbers"; grep "the unit\|this step" "$T/out"; }
[ "$(calls)" = 0 ] && [ ! -s "$T/rerun-pin" ] && ok "--plan makes no call and pins nothing" || bad "plan calls $(calls)"
rerun env UNIT_CAP=3000 bash "$SELF/run-pilot-v2-rerun.sh" --plan; rc=$?
[ "$rc" = 1 ] && grep -q "^gate 5, this step fits its cap:           FAIL" "$T/out" && ok "UNIT_CAP=3000: gate 5 fails" || { bad "cap 3000 rc $rc"; tail -n 8 "$T/out"; }

# --- the paid path ---
rerun bash "$SELF/run-pilot-v2-rerun.sh"; rc=$?
[ "$rc" = 0 ] && grep -q "^done: the record is" "$T/out" && ok "paid path finishes on the fake" || { bad "paid rc $rc"; tail -n 20 "$T/out"; }
[ "$(grep -c ' answer ' "$T/calls")" = 30 ] && ok "30 answers: both arms of the 15 unit tasks, no control answer" || bad "answers $(grep -c ' answer ' "$T/calls")"
spent=$(node -e 'console.log(require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).reduce((s,l)=>s+JSON.parse(l).counted,0))' "$T/work/v2-rerun-ledger.jsonl")
[ "$spent" -le 3240 ] && ok "spent $spent counted, within 3,240" || bad "spent $spent"
rec="$T/work/runs/kp-pilot-3/stage-4/context-k-orchestrator-shared.json"
node -e 'const r=require(process.argv[1]);process.exit(/role line "You orchestrate a team of specialist agents\."/.test(r.claim)&&r.quick.controls.passed&&r.baseline.source.version===2?0:1)' "$rec" \
  && ok "the record names the role line and v2, and both controls passed" || bad "record: $rec"
grep -q "^waiting for the heavy lock $T/heavy.lock" "$T/out" && ok "the paid path held the heavy lock" || bad "no heavy lock line"
grep -qx "$REF" "$T/rerun-pin" && [ "$(grep -c 'v2 rerun: role line' "$T/rerun-pin.log")" = 1 ] && ok "the paid run pinned the commit once, logged" || bad "pin"
n=$(calls)
rerun bash "$SELF/run-pilot-v2-rerun.sh"; rc=$?
[ "$rc" = 0 ] && [ "$(calls)" = "$n" ] && [ "$(grep -c 'v2 rerun: role line' "$T/rerun-pin.log")" = 1 ] && ok "a rerun makes no new call and does not move the pin" || bad "rerun rc $rc, calls $(calls)"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
