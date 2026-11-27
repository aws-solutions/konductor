#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Stub test of run-prompt-fix-arms.sh (free): BENCH_JS is a fake bench.js that writes a result.json and a credit-ledger
# line per run and logs its arguments, and ADAPTIVE_ARM stands in for the built variant, so no model is called and
# nothing is installed. Cases: --plan prints the forecast and runs nothing; A refuses before a smoke run; a smoke run
# whose adaptive runs write no Plan line fails the gate and A still refuses; a passing smoke run writes PASS, passes the
# coordinator its --arm-config and every run a per-run limit; a step stops at its cap before the run that could pass it.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO=$(cd "$HERE/../../.." && pwd -P)
T=$(mktemp -d "${KIROCREW_SCRATCH:-/tmp}/pfa.XXXX")
trap 'find "$T" -mindepth 1 -delete; rmdir "$T"' EXIT
mkdir "$T/w" "$T/tree"
cp "$HERE/run-prompt-fix-arms.sh" "$T/w/run.sh"
cp "$HERE/../lib.sh" "$T/lib.sh"
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }

cat > "$T/bench.js" <<'EOF'
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const a = process.argv.slice(2);
const opt = (k) => a[a.indexOf(k) + 1];
fs.appendFileSync(process.env.STUB_CALLS, `${a.join(' ')}\n`);
const out = opt('--out'); const task = opt('--tasks'); const arm = opt('--arms').split('=')[0];
const rep = Number(opt('--replicate-offset')) + 1;
const credits = Number(process.env.STUB_CREDITS || 2);
fs.mkdirSync(path.join(out, arm, task, String(rep)), { recursive: true });
fs.writeFileSync(path.join(out, 'run-config.json'), '{}');
fs.appendFileSync(path.join(out, 'credit-ledger.jsonl'), `${JSON.stringify({ kind: 'run', unit: 'credits', arm, task, replicate: rep, credits, charged: credits })}\n`);
const plan = process.env.STUB_PLAN === 'none' ? null : (task === 't12-mux-parallel-merge' ? 'team' : 'solo');
const r = { armId: arm, taskId: task, replicate: rep, credits, planLine: plan ? `Plan: ${plan}, because stub` : null, planCall: { plan }, writerSpawns: plan === 'team' ? 3 : 0 };
fs.writeFileSync(path.join(out, arm, task, String(rep), 'result.json'), JSON.stringify(r));
EOF

run() {  # run S ARGS...: the script with the stub overrides; sets code and writes $T/log
  local s=$1; shift
  code=0
  KONDUCTOR_WS=$T/ws S=$s R=$REPO CACHE=$s/cache BENCH_JS=$T/bench.js ADAPTIVE_ARM=konductor-adaptive=dir:$T/tree \
    HOST_CHECK=0 GIT_CHECK=0 NO_FETCH=1 WAIT_MAX=0 HEAVY_LOCK=$T/heavy.lock LITE_LOCK=$T/lite.lock OWN_LOCK=$T/own.lock \
    STUB_CALLS=$T/calls.log bash "$T/w/run.sh" "$@" > "$T/log" 2>&1 || code=$?
}
calls() { local n; n=$(grep -c . "$T/calls.log" 2>/dev/null) || true; echo "${n:-0}"; }

S1=$(mktemp -d /var/tmp/pfa-s1.XXXX); S2=$(mktemp -d /var/tmp/pfa-s2.XXXX); S3=$(mktemp -d /var/tmp/pfa-s3.XXXX)
trap 'find "$T" "$S1" "$S2" "$S3" -mindepth 1 -delete; rmdir "$T" "$S1" "$S2" "$S3"' EXIT

run "$S1" --plan
{ [ "$code" = 0 ] && grep -q 'plan only: nothing was run' "$T/log" && grep -qE '^smoke +12 ' "$T/log" && grep -qE '^A +81 ' "$T/log" && [ "$(calls)" = 0 ]; } \
  && ok "--plan prints 12 smoke and 81 A runs and calls no bench run" || bad "--plan (exit $code): $(tail -3 "$T/log")"

run "$S1" A --foreground
{ [ "$code" = 1 ] && grep -q 'smoke gate has not passed' "$T/log" && [ "$(calls)" = 0 ]; } && ok "A refuses before a smoke run" || bad "A before smoke (exit $code): $(tail -2 "$T/log")"

STUB_PLAN=none run "$S2" smoke --foreground
{ [ "$code" = 1 ] && grep -q 'smoke gate failed' "$T/log" && grep -q '^FAIL' "$S2/smoke.gate"; } && ok "no Plan line fails the smoke gate" || bad "gate fail case (exit $code): $(tail -2 "$T/log")"
STUB_PLAN=none run "$S2" A --foreground
[ "$code" = 1 ] && grep -q 'smoke gate has not passed' "$T/log" && ok "A refuses after a failed gate" || bad "A after a failed gate (exit $code)"

: > "$T/calls.log"
run "$S1" smoke --foreground
{ [ "$code" = 0 ] && grep -qx PASS "$S1/smoke.gate" && [ "$(calls)" = 12 ] && [ -s "$S1/plan.json" ]; } && ok "smoke runs 12 runs, freezes the plan and passes the gate" || bad "smoke pass (exit $code, $(calls) calls): $(tail -3 "$T/log")"
grep -q -- '--arms konductor-coordinator=c042c7ba7520a3332f1151e3f9733f7033557e65 --arm-config konductor-coordinator=orchestration.mode=coordinator' "$T/calls.log" \
  && ok "the coordinator arm gets orchestration.mode=coordinator" || bad "coordinator arm args"
[ "$(grep -c -- '--run-credit-limit 25' "$T/calls.log")" = 12 ] && ok "every smoke run has the 25-credit run limit" || bad "smoke run limit"
run "$S1" smoke --foreground
[ "$code" = 0 ] && [ "$(calls)" = 12 ] && ok "a rerun skips finished runs" || bad "rerun (exit $code, $(calls) calls)"

# Cap: each run reports 35 credits, so after two runs (70) a third (70 + 25 > 90) must not start.
STUB_CREDITS=35 run "$S3" smoke --foreground
{ [ "$code" = 1 ] && grep -q 'STOP: cap: 70 spent of 90' "$T/log" && [ "$(find "$S3/runs/smoke" -name result.json | wc -l)" = 2 ]; } \
  && ok "the cap stops the run that could pass it" || bad "cap (exit $code): $(tail -2 "$T/log")"

[ "$fails" = 0 ] && echo "ALL PASS" || { echo "$fails FAILED"; exit 1; }
