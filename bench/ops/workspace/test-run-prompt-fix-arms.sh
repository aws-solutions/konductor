#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Stub test of run-prompt-fix-arms.sh (free): BENCH_JS is a fake bench.js that writes a result.json and a credit-ledger
# line per run and logs its arguments, and ADAPTIVE_ARM stands in for the built variant, so no model is called and
# nothing is installed. Cases: --plan prints the forecast and runs nothing; A refuses before a smoke run; a smoke run
# whose adaptive runs write no Plan line fails the gate and A still refuses; a passing smoke run writes PASS, passes the
# coordinator its --arm-config and every run a per-run limit; a step stops at its cap before the run that could pass it;
# batch C refuses until the CardDemo Pattern key is signed off for its current bytes, then runs 2 reps from the git
# copy with soft caps; the judge step stops at its USD cap and otherwise runs the read-view rubric pass and the quality
# pack on every finished run, then the report. reply-check: --plan builds nothing paid and prints the calls and caps; a
# wrong REVIEWER is refused; the paid step runs 12 early-stopped candidate runs, freezes 15 prompts (12 new, 3 smoke),
# makes one stub Claude call and three stub panel calls per prompt and writes the side-by-side report, leaving the
# study's plan.json as it was; a rerun calls nothing; the run cap stops the run that could pass it; a planned early
# stop that the old bench exited 5 on is booked at its measured spend by reply-check --repin and kept on resume (D-299).
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
if (a[0] === 'judge') {
  fs.appendFileSync(path.join(opt('--run'), 'credit-ledger.jsonl'), `${JSON.stringify({ kind: 'judge', unit: 'usd', usd: 0.01, credits: 0 })}\n`);
  process.exit(0);
}
if (a[0] === 'report') { fs.mkdirSync(opt('--out'), { recursive: true }); fs.writeFileSync(path.join(opt('--out'), 'report.md'), '# stub\n'); process.exit(0); }
const out = opt('--out'); const task = opt('--tasks'); const arm = opt('--arms').split('=')[0];
const rep = Number(opt('--replicate-offset')) + 1;
const credits = Number(process.env.STUB_CREDITS || 2);
const cell = path.join(out, arm, task, String(rep));
// --resume keeps a cell that has a result, as bench.js does for every status but budget_skipped.
if (a.includes('--resume') && fs.existsSync(path.join(cell, 'result.json'))) process.exit(0);
fs.mkdirSync(cell, { recursive: true });
fs.writeFileSync(path.join(out, 'run-config.json'), '{}');
const plan = process.env.STUB_PLAN === 'none' ? null : (task === 't12-mux-parallel-merge' ? 'team' : 'solo');
const r = { armId: arm, taskId: task, replicate: rep, credits, planLine: plan ? `Plan: ${plan}, because stub` : null, planCall: { plan }, writerSpawns: plan === 'team' ? 3 : 0 };
// STUB_EARLY=1: the run is stopped at --max-tool-calls and its session wrote a creditSplit of 1.642. STUB_EARLY_EXIT=5 is
// the bench before D-299 (booked at the floor 1.0, exit 5); 0, the default, the bench after it (booked at 1.642, exit 0).
const early = process.env.STUB_EARLY === '1';
const earlyExit = Number(process.env.STUB_EARLY_EXIT || 0);
if (early) {
  Object.assign(r, { status: 'error', credits: null, creditsCensored: true, flags: ['earlyStopped'], error: 'stopped early: max-tool-calls (8) | the run was ended by a signal', planLine: 'Plan: after a read-only look' });
  r.creditsCharged = earlyExit ? 1 : 1.642;
  if (!earlyExit) r.creditMeasured = 1.642;
  fs.mkdirSync(path.join(cell, 'session', 'sess_a'), { recursive: true });
  fs.writeFileSync(path.join(cell, 'session', 'sess_a', 'messages.jsonl'), '{"payload":{"type":"session_metadata","key":"creditSplit","value":{"main":1.642,"delegated":0,"auxiliary":0}}}\n');
}
const charged = early ? r.creditsCharged : credits;
fs.appendFileSync(path.join(out, 'credit-ledger.jsonl'), `${JSON.stringify({ kind: 'run', unit: 'credits', arm, task, replicate: rep, credits: early ? null : credits, charged, ...(early ? { censored: true } : {}) })}\n`);
fs.writeFileSync(path.join(cell, 'result.json'), JSON.stringify(r));
const ev = { type: 'sessionUpdate', data: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: r.planLine ? `${r.planLine}\nSkills: none fit\n` : 'stub\n' } } } };
fs.writeFileSync(path.join(cell, 'stream.jsonl'), `${JSON.stringify(ev)}\n`);
if (early && earlyExit) { console.log('INFRA FAILURE: all 1 run(s) errored (1)'); process.exit(earlyExit); }
EOF

# The reply check's reviewers: a fake kiro-cli for Claude (answers every check "met") and a stub panel module.
cat > "$T/fake-kiro.js" <<'EOF'
#!/usr/bin/env node
const p = process.argv.at(-1);
const ids = [...p.matchAll(/^(E\d): /gm)].map((m) => m[1]);
const line = (type, data) => process.stdout.write(JSON.stringify({ type, data }) + '\n');
line('metadata', { sessionId: 'f', meteringUsage: [{ value: 2, unit: 'credit' }] });
line('runFinished', { status: 'success', stopReason: 'end_turn', finalText: JSON.stringify({ checks: ids.map((id) => ({ id, verdict: 'met', quote: '' })), decisionInOtherWords: 'solo' }) });
EOF
chmod +x "$T/fake-kiro.js"
echo fake > "$T/auth.sqlite3"
cat > "$T/panel.js" <<'EOF'
'use strict';
exports.makeCaller = () => async ({ prompt }) => {
  const ids = [...prompt.matchAll(/^(E\d): /gm)].map((m) => m[1]);
  return { text: JSON.stringify({ checks: ids.map((id) => ({ id, verdict: 'not-met', quote: '' })), decisionInOtherWords: 'none' }), usd: 0.001 };
};
EOF

run() {  # run S ARGS...: the script with the stub overrides; sets code and writes $T/log
  local s=$1; shift
  code=0
  KONDUCTOR_WS=$T/ws S=$s R=$REPO RC_REPO=$REPO CACHE=$s/cache BENCH_JS=$T/bench.js ADAPTIVE_ARM=konductor-adaptive=dir:$T/tree \
    CANDIDATE_ARM=konductor-adaptive-p12=dir:$T/tree REVIEW_KIRO_BIN=$T/fake-kiro.js REVIEW_AUTH_DB=$T/auth.sqlite3 PANEL_MODULE=$T/panel.js \
    HOST_CHECK=0 GIT_CHECK=0 NO_FETCH=1 WAIT_MAX=0 HEAVY_LOCK=$T/heavy.lock LITE_LOCK=$T/lite.lock OWN_LOCK=$T/own.lock \
    STUB_CALLS=$T/calls.log bash "$T/w/run.sh" "$@" > "$T/log" 2>&1 || code=$?
}
calls() { local n; n=$(grep -c . "$T/calls.log" 2>/dev/null) || true; echo "${n:-0}"; }

S1=$(mktemp -d /var/tmp/pfa-s1.XXXX); S2=$(mktemp -d /var/tmp/pfa-s2.XXXX); S3=$(mktemp -d /var/tmp/pfa-s3.XXXX); S5=$(mktemp -d /var/tmp/pfa-s5.XXXX)
trap 'find "$T" "$S1" "$S2" "$S3" "$S5" -mindepth 1 -delete; rmdir "$T" "$S1" "$S2" "$S3" "$S5"' EXIT

run "$S1" --plan
{ [ "$code" = 0 ] && grep -q 'plan only: nothing was run' "$T/log" && grep -qE '^smoke +12 ' "$T/log" && grep -qE '^A +81 ' "$T/log" && [ "$(calls)" = 0 ] \
  && grep -q '^batch C: 2 reps' "$T/log" && grep -q 'judge: gpt-5.6-luna, deepseek-3.2, qwen3-coder-next; rubric in the read view' "$T/log" \
  && grep -q 'CardDemo Pattern key: NOT signed off' "$T/log"; } \
  && ok "--plan prints 12 smoke and 81 A runs, batch C at 2 reps, the judge cost and the sign-off state, and calls no bench run" || bad "--plan (exit $code): $(tail -3 "$T/log")"

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

# Reply check: free plan, reviewer check, paid step with stubs, rerun, and the run cap.
: > "$T/calls.log"
run "$S1" reply-check --plan
{ [ "$code" = 0 ] && [ "$(calls)" = 0 ] && grep -q '^runs: 12 early-stopped runs of the candidate arm' "$T/log" && grep -q 'Claude reviewer claude-opus-5.5: 15 calls' "$T/log" \
  && grep -q 'of the 300 cap' "$T/log" && grep -q 'panel gpt-5.6-luna, deepseek-3.2, qwen3-coder-next: 45 calls' "$T/log" && grep -q 'cap USD 0.50' "$T/log" && grep -q 'plan only' "$T/log"; } \
  && ok "reply-check --plan prints 12 runs, 15 Claude and 45 panel calls under the caps, and runs nothing" || bad "reply-check --plan (exit $code): $(tail -4 "$T/log")"
REVIEWER=gpt-5.6-luna run "$S1" reply-check --foreground
[ "$code" = 1 ] && grep -q 'REVIEWER must be claude-opus-5.5 or claude-fable-5.1' "$T/log" && ok "a non-Claude REVIEWER is refused" || bad "reviewer check (exit $code)"
plan_sha=$(sha256sum "$S1/plan.json" | cut -d' ' -f1)
: > "$T/calls.log"
run "$S1" reply-check --foreground
RV=$S1/reply-check/reviews
n_prompts=$(node -p "Object.keys(require('$S1/reply-check/prompts/manifest.json').entries).length" 2>/dev/null || echo 0)
n_claude=$(find "$RV/claude-opus-5.5" -name '*.json' ! -name '*.stream.jsonl' 2>/dev/null | wc -l)
n_panel=$(find "$RV/gpt-5.6-luna" "$RV/deepseek-3.2" "$RV/qwen3-coder-next" -name '*.json' 2>/dev/null | wc -l)
{ [ "$code" = 0 ] && [ "$(calls)" = 12 ] && [ "$(grep -c -- '--arms konductor-adaptive-p12=dir:.* --max-tool-calls 8' "$T/calls.log")" = 12 ] && [ "$(grep -c -- '--run-credit-limit 6 ' "$T/calls.log")" = 12 ] \
  && [ "$n_prompts" = 15 ] && [ "$n_claude" = 15 ] && [ "$n_panel" = 45 ] && grep -q 'Claude differs' "$S1/reply-check/report.md" \
  && [ "$(sha256sum "$S1/plan.json" | cut -d' ' -f1)" = "$plan_sha" ]; } \
  && ok "reply-check runs 12 early-stopped runs, then 15 Claude and 45 panel reviews, and writes the side-by-side report; the study plan is unchanged" \
  || bad "reply-check paid (exit $code, $(calls) calls, $n_prompts prompts, $n_claude Claude, $n_panel panel): $(tail -3 "$T/log")"
[ -f "$S1/reply-check/prompts/smoke.t12-mux-parallel-merge.r1.review-prompt.txt" ] && [ ! -e "$S1/reply-check/prompts/smoke.probe-e2e-explicit-yes.r1.review-prompt.txt" ] \
  && ok "three smoke runs are reviewed too" || bad "smoke prompts: $(ls "$S1/reply-check/prompts" | head -3)"
: > "$T/calls.log"
run "$S1" reply-check --foreground
[ "$code" = 0 ] && [ "$(calls)" = 0 ] && ok "a reply-check rerun calls nothing" || bad "reply-check rerun (exit $code, $(calls) calls)"
# Early stop (D-299): the bench before the fix called a planned --max-tool-calls stop an infra failure and exited 5,
# which stopped the step at its first run. --repin books that run at its measured creditSplit; the resumed step keeps
# it without a rerun (bench --resume), runs the 11 left, which now exit 0, and freezes all 15 prompts.
S6=$(mktemp -d /var/tmp/pfa-s6.XXXX)
trap 'find "$T" "$S1" "$S2" "$S3" "$S4" "$S5" "$S6" -mindepth 1 -delete; rmdir "$T" "$S1" "$S2" "$S3" "$S4" "$S5" "$S6"' EXIT
cp "$S1/plan.json" "$S6/plan.json"
mkdir -p "$S6/runs"
cp -r "$S1/runs/smoke" "$S6/runs/smoke"
: > "$T/calls.log"
STUB_EARLY=1 STUB_EARLY_EXIT=5 run "$S6" reply-check --foreground
{ [ "$code" = 1 ] && [ "$(calls)" = 1 ] && grep -q 'bench exit 5 on reply-check t12-mux-parallel-merge r1' "$T/log"; } \
  && ok "the old bench's exit 5 on a planned early stop stops the step (the 2026-11-28 failure)" || bad "early stop, old bench (exit $code, $(calls) calls): $(tail -2 "$T/log")"
run "$S6" reply-check --repin
{ [ "$code" = 0 ] && grep -q 't12-mux-parallel-merge-r1: early stop booked 1, measured 1.642; would book 0.642 more' "$T/log" && [ ! -d "$S6/reply-check/runs/rebooked" ]; } \
  && ok "reply-check --repin lists the floor-booked early stop and books nothing" || bad "repin dry run (exit $code): $(tail -3 "$T/log")"
run "$S6" reply-check --repin --yes
{ [ "$code" = 0 ] && grep -q 'reply check runs booked 1.64 of 72' "$T/log"; } && ok "reply-check --repin --yes books the measured 1.642" || bad "repin apply (exit $code): $(tail -3 "$T/log")"
run "$S6" reply-check --repin --yes
{ grep -q 'no early stop to re-book' "$T/log" && grep -q 'booked 1.64 of 72' "$T/log"; } && ok "a second --repin --yes books nothing more" || bad "repin twice: $(tail -3 "$T/log")"
: > "$T/calls.log"
STUB_EARLY=1 run "$S6" reply-check --foreground
n6=$(node -p "Object.keys(require('$S6/reply-check/prompts/manifest.json').entries).length" 2>/dev/null || echo 0)
spent6=$(node -p "require('$REPO/bench/ops/prompt-fixes/study.js').spent('$S6/reply-check/runs').credits")
{ [ "$code" = 0 ] && [ "$(calls)" = 12 ] && [ "$(grep -c -- '--resume' "$T/calls.log")" = 1 ] && [ "$n6" = 15 ] && [ "$spent6" = 19.7 ] \
  && [ -f "$S6/reply-check/prompts/candidate.t12-mux-parallel-merge.r1.review-prompt.txt" ] && [ -s "$S6/reply-check/report.md" ]; } \
  && ok "after --repin the step keeps r1 without a rerun, runs 11 early stops that exit 0, and reviews all 15 prompts (19.7 booked)" \
  || bad "early stop resume (exit $code, $(calls) calls, $n6 prompts, $spent6 booked): $(tail -3 "$T/log")"

STUB_CREDITS=7 run "$S5" reply-check --foreground
{ [ "$code" = 1 ] && grep -q 'STOP: run cap: 70 spent of 72' "$T/log" && [ "$(find "$S5/reply-check/runs" -name result.json | wc -l)" = 10 ]; } \
  && ok "the reply-check run cap stops the run that could pass 72" || bad "reply-check cap (exit $code): $(tail -2 "$T/log")"

# Cap: each run reports 35 credits, so after two runs (70) a third (70 + 25 > 90) must not start.
STUB_CREDITS=35 run "$S3" smoke --foreground
{ [ "$code" = 1 ] && grep -q 'STOP: cap: 70 spent of 90' "$T/log" && [ "$(find "$S3/runs/smoke" -name result.json | wc -l)" = 2 ]; } \
  && ok "the cap stops the run that could pass it" || bad "cap (exit $code): $(tail -2 "$T/log")"

# Rebook (D-297): a smoke run the old v3 estimate stopped at 26 under the limit 25, while its session measured 3.29,
# is listed by a dry run, then moved to incomplete and booked at measured spend plus one call; the next smoke run runs it.
S4=$(mktemp -d /var/tmp/pfa-s4.XXXX)
trap 'find "$T" "$S1" "$S2" "$S3" "$S4" "$S5" -mindepth 1 -delete; rmdir "$T" "$S1" "$S2" "$S3" "$S4" "$S5"' EXIT
cp "$S1/plan.json" "$S4/plan.json"
U4=$S4/runs/smoke/t12-mux-parallel-merge/konductor-adaptive/r1
mkdir -p "$U4/konductor-adaptive/t12-mux-parallel-merge/1/session/sess_a"
printf '%s\n' '{"kind":"run","unit":"credits","credits":null,"charged":26.005,"censored":true}' > "$U4/credit-ledger.jsonl"
printf '%s\n' '{"armId":"konductor-adaptive","taskId":"t12-mux-parallel-merge","status":"error","flags":["creditLimit"],"creditLimit":25,"creditEstimate":26.005}' > "$U4/konductor-adaptive/t12-mux-parallel-merge/1/result.json"
printf '%s\n' '{"payload":{"type":"session_metadata","key":"creditSplit","value":{"main":2.9,"delegated":0,"auxiliary":0}}}' '{"payload":{"type":"session_metadata","key":"creditSplit","value":{"main":3.29,"delegated":0,"auxiliary":0}}}' > "$U4/konductor-adaptive/t12-mux-parallel-merge/1/session/sess_a/messages.jsonl"
echo '{}' > "$U4/run-config.json"
run "$S4" rebook
{ [ "$code" = 0 ] && grep -q 'smoke: booked 26.01 of 90' "$T/log" && grep -q 'measured 3.29; would book 3.68' "$T/log" && [ -d "$U4" ]; } \
  && ok "rebook without --yes lists the estimate-fault stop and moves nothing" || bad "rebook dry run (exit $code): $(tail -3 "$T/log")"
run "$S4" rebook --yes
{ [ "$code" = 0 ] && [ ! -e "$U4" ] && ls "$S4/incomplete" | grep -q 'estimate-stop' && grep -q 'smoke: booked 3.68 of 90 after the re-book' "$T/log"; } \
  && ok "rebook --yes moves the cell aside and books its measured spend" || bad "rebook apply (exit $code): $(tail -3 "$T/log")"
: > "$T/calls.log"
run "$S4" smoke --foreground
{ [ "$code" = 0 ] && [ "$(calls)" = 12 ] && [ -s "$U4/credit-ledger.jsonl" ]; } && ok "the next smoke run runs the re-booked cell again" || bad "smoke after rebook (exit $code, $(calls) calls): $(tail -3 "$T/log")"

# Batch C: refused until the CardDemo Pattern key is signed off; then 2 reps x 3 arms from the git copy, soft caps.
run "$S1" C --foreground
{ [ "$code" = 1 ] && grep -q 'Pattern key .* is not signed off' "$T/log" && [ ! -d "$S1/runs/C" ]; } && ok "C refuses before the Pattern key sign-off" || bad "C before sign-off (exit $code): $(tail -2 "$T/log")"
run "$S1" sign-carddemo-key
{ [ "$code" = 0 ] && grep -q '^## Pattern key' "$T/log" && [ ! -e "$S1/carddemo-key.signoff" ]; } && ok "sign-carddemo-key shows the key and records nothing without --yes" || bad "sign show (exit $code)"
run "$S1" sign-carddemo-key --yes
[ "$code" = 0 ] && [ -s "$S1/carddemo-key.signoff" ] && ok "sign-carddemo-key --yes records the sign-off" || bad "sign --yes (exit $code)"
: > "$T/calls.log"
run "$S1" C --foreground
{ [ "$code" = 0 ] && [ "$(calls)" = 6 ] && [ "$(grep -c -- "--suite complex --suites-dir $S1/tasks-c/suites --timeout-sec 3600 --run-credit-limit-mode soft" "$T/calls.log")" = 6 ] \
  && grep -q -- '--run-credit-limit 270' "$T/calls.log" && [ -d "$S1/tasks-c/tasks/fixtures/cx-carddemo-batchday/dotgit" ]; } \
  && ok "C runs 6 runs (2 reps) from the git copy with the soft 270 cap" || bad "C (exit $code, $(calls) calls): $(tail -3 "$T/log")"
printf 'feedbeef %s\n' x > "$S1/carddemo-key.signoff"
run "$S1" C --foreground
[ "$code" = 1 ] && grep -q 'not signed off' "$T/log" && ok "a sign-off for other answer-key bytes is refused" || bad "stale sign-off (exit $code)"

# Judge: the cap refuses before any call; then both passes on every finished run (rubric read view, quality pack).
: > "$T/calls.log"
JUDGE_CAP_USD=0.01 run "$S1" judge --foreground
{ [ "$code" = 1 ] && grep -q 'judge cap: USD 0 spent of 0.01' "$T/log" && [ "$(calls)" = 0 ]; } && ok "the judge cap refuses a pass that could pass it" || bad "judge cap (exit $code): $(tail -2 "$T/log")"
run "$S1" judge --foreground
{ [ "$code" = 0 ] && [ "$(grep -c -- '^judge .*--mode rubric --judge-view read --isolate unshare' "$T/calls.log")" = 18 ] \
  && [ "$(grep -c -- '^judge .*--criteria-pack quality' "$T/calls.log")" = 18 ] && grep -q -- '--judges gpt-5.6-luna,deepseek-3.2,qwen3-coder-next' "$T/calls.log" \
  && grep -q '^report ' "$T/calls.log"; } && ok "judge runs both passes on 18 runs, then the report" || bad "judge (exit $code, $(calls) calls): $(tail -3 "$T/log")"

[ "$fails" = 0 ] && echo "ALL PASS" || { echo "$fails FAILED"; exit 1; }
