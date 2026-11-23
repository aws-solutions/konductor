#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-run-pilot-v2-rewrite.sh -- stub run of run-pilot-v2-rewrite.sh on its PAID path with the repo's fake kiro-cli
# (bench/runner/test/fake-kp-kiro.js): no model, no credits. Own worktree (kp-v2-stub, removed at the end), own work
# dir, baselines and logs under a new scratch dir. It first writes a 15-task signed-off baseline on the fake (t14
# dropped, as the pilot's). Checks: --dry-run plans 4 calls with deepseek-3.2 writing, lists the 10 kept tasks and
# makes no call; a cap over 120 is refused; the paid path writes v2 with the 5 tasks rewritten, the 10 others byte for
# byte, no sign-off, and the v1 file unchanged; it held the heavy lock; a rerun makes no new call.
#
#   bash scripts/test-run-pilot-v2-rewrite.sh [COMMIT]     # COMMIT: what to check out (default the head of this checkout)
set -uo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLONE=$KONDUCTOR_WS/worktrees/konductor-plant
REF=${1:-$(git -C "$SELF" rev-parse HEAD)}
# cap unit-author refuses a work dir under the home folder, so the scratch dir is under /var/tmp.
T=$(mktemp -d /var/tmp/kp-v2-test.XXXXXX)
WT_NAME=kp-v2-stub
WT=$CLONE/.worktrees/$WT_NAME
cleanup() { git -C "$CLONE" worktree remove --force "$WT" 2>/dev/null; chmod -R u+rwX "$T"; rm -rf "$T"; }
trap cleanup EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }
: > "$T/auth.sqlite3"
printf '%s\n' "$REF" > "$T/pinned-commit"
FAKE="$WT/bench/runner/test/fake-kp-kiro.js"
V1="$T/v1/context-k-orchestrator-shared/baseline.json"
V2="$T/baselines/context-k-orchestrator-shared/baseline.json"
run() {  # run [args]: the wrapper with every path pointed at the scratch dir and the fake kiro-cli
  env KP_PIN_FILE="$T/pinned-commit" KP_WT_NAME="$WT_NAME" KP_KIRO_BIN="$FAKE" KP_AUTH_DB="$T/auth.sqlite3" KP_PILOT_WORK="$T/work" \
    KP_BASELINES="$T/baselines" KP_LOG_ROOT="$T/logs" V2_LOCK="$T/v2.lock" KP_HEAVY_LOCK="$T/heavy.lock" V2_FROM="$V1" \
    FAKE_KP_LOG="$T/calls" BENCH_PAID_ENV_KEEP=FAKE_KP_LOG,FAKE_KP_FAIL,FAKE_KP_NOFIX "$@" > "$T/out" 2>&1
}
calls() { [ -s "$T/calls" ] && grep -vc whoami "$T/calls" || echo 0; }

# The first run makes the checkout; there is no v1 yet, so it stops before any call.
run bash "$SELF/run-pilot-v2-rewrite.sh" --dry-run; rc=$?
[ "$rc" = 1 ] && grep -q "no baseline to rewrite" "$T/out" && ok "no v1 baseline: it stops before any call" || { bad "no-v1 rc $rc"; tail -n 5 "$T/out"; }
# A 15-task signed-off v1 on the fake: t14 fails review and its fix, so it is dropped, then the draft is frozen.
author() { env FAKE_KP_LOG="$T/v1calls" FAKE_KP_FAIL=t14 FAKE_KP_NOFIX=t14 BENCH_PAID_ENV_KEEP=FAKE_KP_LOG,FAKE_KP_FAIL,FAKE_KP_NOFIX \
  node "$WT/bench/runner/bench.js" cap unit-author --kind context --unit k-orchestrator-shared --work "$T/v1work" --ledger "$T/v1ledger.jsonl" \
  --cap 120 --out "$V1" --kiro-bin "$FAKE" --auth-db "$T/auth.sqlite3" --repo-root "$WT" "$@" > "$T/v1out" 2>&1; }
mkdir -p "$(dirname "$V1")"
author; author --sign-off "stub owner"
[ -f "$V1" ] && ok "a 15-task signed-off v1 on the fake" || { bad "no v1"; cat "$T/v1out"; }
cp "$V1" "$T/v1.copy"

run bash "$SELF/run-pilot-v2-rewrite.sh" --dry-run; rc=$?
[ "$rc" = 0 ] && grep -q "dry run, no call made: at most 4 calls, worst case 60 credits" "$T/out" && grep -q "^rewrite write   deepseek-3.2" "$T/out" \
  && grep -q "keeps 10 tasks unchanged (t02, t03, t04, t05, t06, t08, t10, t11, t13, t15)" "$T/out" \
  && ok "--dry-run: 4 calls, worst 60, deepseek-3.2 writes, 10 kept" || { bad "dry run rc $rc"; cat "$T/out"; }
[ "$(calls)" = 0 ] && ok "--dry-run makes no model call" || bad "dry-run calls: $(cat "$T/calls")"
run env V2_CAP=200 bash "$SELF/run-pilot-v2-rewrite.sh" --dry-run; rc=$?
[ "$rc" = 64 ] && grep -q "over the 120" "$T/out" && ok "a cap over 120 is refused" || bad "cap 200 rc $rc"

run env FAKE_KP_FAIL=t07 bash "$SELF/run-pilot-v2-rewrite.sh"; rc=$?
[ "$rc" = 0 ] && [ -f "$V2" ] && grep -q "^kept 10 tasks byte for byte; rewritten: t01, t07, t09, t12, t16" "$T/out" \
  && ok "paid path writes v2: 5 rewritten (t07 after one fix), 10 kept byte for byte" || { bad "paid rc $rc"; tail -n 20 "$T/out"; }
[ "$(calls)" = 4 ] && ok "4 calls: write, review, fix, recheck" || bad "calls $(calls)"
cmp -s "$V1" "$T/v1.copy" && ok "the signed-off v1 is unchanged" || bad "v1 changed"
node -e 'const b=require(process.argv[1]);process.exit(b.source.signedOffBy===null&&b.source.version===2&&b.source.writtenBy==="deepseek-3.2"&&b.source.from.signedOffBy==="stub owner"?0:1)' "$V2" \
  && ok "v2 has no sign-off, names v1 and its signer, deepseek-3.2 wrote it" || bad "v2 source: $(node -e 'console.log(JSON.stringify(require(process.argv[1]).source))' "$V2" 2>&1)"
grep -q "^waiting for the heavy lock $T/heavy.lock" "$T/out" && ok "the paid path held the heavy lock" || bad "no heavy lock line"
grep -qx "$REF" "$T"/logs/kp-pilot-v2-rewrite-[0-9]*/commit.txt && ok "it ran on the pinned commit" || bad "commit"
run bash "$SELF/run-pilot-v2-rewrite.sh"; rc=$?
[ "$(calls)" = 4 ] && ok "a rerun makes no new call" || bad "rerun rc $rc, calls $(calls)"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
