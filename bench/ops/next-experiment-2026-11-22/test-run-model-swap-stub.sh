#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Free test of run-model-swap.sh with a stub bench command and a fake reused baseline. No model call, no kiro-cli.
#   case 1: --plan prints the natural stage's 8 tasks, the 24 reused Sonnet cells, and the counted and real totals
#   case 2: --go --stage natural runs 8 tasks on Opus with the plain konductor arm, 3 replicates each, all .done
#   case 3: a rerun skips every task (resume)
#   case 4: --go --stage list runs the 4 skill-heavy tasks with the list arm; a run without hook text stops it
#   case 5: the counted-credit guard (15 per run at least) stops a stage that would pass its cap
#   case 6: --summary counts loaded whole, preview only, find_skills and "no skill fits" per model and arm
set -eu
HERE0=$(cd "$(dirname "$0")" && pwd)
CHECK_BENCH=$(cd "$HERE0/../../.." && pwd)
export CHECK_BENCH
T=$(mktemp -d "${KIROCREW_SCRATCH:-/var/tmp}/swap-stub.XXXXXX")
STUBJS=$T/stub.js
cat > "$STUBJS" <<'JS'
// Stub for `node bench.js run ...`: one result per arm and replicate, a session record and a stream.
// STUB_CREDITS sets each run's credits; STUB_HOOK=none leaves the hook text out; STUB_SKILL names a skill loaded whole.
// `node stub.js stream FILE NAME TEXT` writes only a stream where get_skill NAME answered TEXT (a fixture).
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const ev = (u) => JSON.stringify({ type: 'sessionUpdate', data: { sessionId: 's', update: u } });
const getSkill = (name, text) => [
  ev({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: '@konductor-skills/get_skill', rawInput: { name }, _meta: { kiro: { serverName: 'konductor-skills' } } }),
  ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', title: '@konductor-skills/get_skill', rawInput: { name }, rawOutput: { response: text } }),
].join('\n') + '\n';
if (a[0] === 'stream') { fs.writeFileSync(a[1], getSkill(a[2], a[3])); process.exit(0); }
const val = (f) => a[a.indexOf(f) + 1];
const out = val('--out'), task = val('--tasks'), reps = Number(val('--replicates')), model = val('--model');
const arms = val('--arms').split(',').map((s) => s.split('=')[0]);
fs.appendFileSync(path.join(path.dirname(out), 'calls.log'), a.join(' ') + '\n');
const resume = a.includes('--resume');
for (const arm of arms) for (let rep = 1; rep <= reps; rep++) {
  const d = path.join(out, arm, task, String(rep));
  const res = path.join(d, 'result.json');
  if (resume && fs.existsSync(res) && JSON.parse(fs.readFileSync(res, 'utf8')).status !== 'budget_skipped') continue;
  fs.mkdirSync(path.join(d, 'session', 'sess_1'), { recursive: true });
  fs.writeFileSync(res, JSON.stringify({ armId: arm, taskId: task, replicate: rep, status: 'success', credits: Number(process.env.STUB_CREDITS || 5), finalText: 'ok', streamModel: model, flags: [] }));
  const skill = process.env.STUB_SKILL;
  fs.writeFileSync(path.join(d, 'stream.jsonl'), skill ? getSkill(skill, JSON.stringify({ name: skill, content: 'body' })) : '');
  const header = 'Your skills (load one with get_skill; each one\'s trigger line is under "## Your skills" in your instructions):';
  const text = process.env.STUB_HOOK === 'none' || !arm.includes('list') ? 'plain prompt' : header + '\n  x';
  fs.writeFileSync(path.join(d, 'session', 'sess_1', 'messages.jsonl'), JSON.stringify({ payload: { type: 'user', content: text } }) + '\n');
}
JS
fail() { echo "FAIL: $*"; exit 1; }
copy() { mkdir -p "$1"; cp "$HERE0/run-model-swap.sh" "$HERE0/model-swap-summary.js" "$HERE0/lib.sh" "$1/"; }

# A fake reused baseline: the LITE run's konductor cells (runs/r<rep>/<batch>/konductor/<task>/<rep>) for the 8 tasks,
# each 6 credits, one of them with a whole skill load and one with a preview-only load.
LITE=$T/lite
for t in t8-dec-deploy-strategy t5-qa-checkout-strategy t5-qa-sync-strategy t6-req-field-inspections t2-dr-notify-fanout \
  t2-arch-dr-split-checkout t7-program-brief t1-nfr-report-queries; do
  for r in 1 2 3; do
    d=$LITE/runs/r$r/${t%%-*}/konductor/$t/$r
    mkdir -p "$d"
    printf '{"armId":"konductor","taskId":"%s","replicate":%s,"status":"success","credits":6,"finalText":"ok","streamModel":"claude-sonnet-5.5","flags":[]}\n' "$t" "$r" > "$d/result.json"
    : > "$d/stream.jsonl"
  done
done
node "$STUBJS" stream "$LITE/runs/r1/t8/konductor/t8-dec-deploy-strategy/1/stream.jsonl" decision-writing '{"name":"decision-writing","content":"body"}'
node "$STUBJS" stream "$LITE/runs/r3/t5/konductor/t5-qa-checkout-strategy/3/stream.jsonl" test-coverage-analysis \
  "The output from \"x\" (31,917 chars) exceeded the 30,000-char limit; here is a preview of the tool's result: ..."
mkdir -p "$LITE/runs/r1/t8"
printf '{"models":[{"model_id":"claude-opus-5.5","rate_multiplier":2},{"model_id":"claude-sonnet-5.5","rate_multiplier":1.3},{"model_id":"claude-fable-5.1","rate_multiplier":6}]}\n' > "$LITE/runs/r1/t8/model-list.json"
export LITE
ENVS="OTHER_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock"

# case 1: free plan
copy "$T/a"
env $ENVS HERE="$T/a" sh "$T/a/run-model-swap.sh" --plan --stage natural > "$T/p.log" 2>&1 || { cat "$T/p.log"; fail "case 1 exited non-zero"; }
[ "$(grep -c '^| t[0-9]' "$T/p.log")" = 8 ] || { cat "$T/p.log"; fail "case 1: not 8 task rows"; }
grep -q 'reused Sonnet 5.5 cells: 24' "$T/p.log" || { cat "$T/p.log"; fail "case 1: reused count"; }
# 6 credits on Sonnet x 2/1.3 = 9.23 a run; 24 runs = 221.5 real; counted at 15 a run = 360.
grep -q 'expected real 221.5' "$T/p.log" || { cat "$T/p.log"; fail "case 1: expected real total"; }
grep -q 'counted 360' "$T/p.log" || { cat "$T/p.log"; fail "case 1: counted total"; }
[ ! -e "$T/a/runs-model-swap" ] || fail "case 1: the plan wrote run output"
echo "case 1 ok: plan shows 8 tasks, 24 reused cells, real and counted totals"

# case 2: paid path with a stub
env $ENVS STUB="node $STUBJS" HERE="$T/a" sh "$T/a/run-model-swap.sh" --go --stage natural > "$T/n.log" 2>&1 || { cat "$T/n.log"; fail "case 2 exited non-zero"; }
N=$T/a/runs-model-swap/natural
[ "$(ls "$N" | grep -c '\.done$')" = 8 ] || fail "case 2: not 8 .done files"
[ "$(wc -l < "$N/calls.log")" = 8 ] || fail "case 2: not 8 bench calls"
grep -q -- '--arms konductor=f5d184596378ae72ae531d80647548512c14cacf ' "$N/calls.log" || fail "case 2: plain konductor arm not passed"
[ "$(grep -c -- '--model claude-opus-5.5 ' "$N/calls.log")" = 8 ] || fail "case 2: model is not opus on every call"
grep -q -- '--replicates 3 ' "$N/calls.log" || fail "case 2: not 3 replicates"
if grep -q -- '--arm-prefix' "$N/calls.log"; then fail "case 2: the natural arm got a prefix"; fi
echo "case 2 ok: 8 tasks on opus, plain konductor arm"

# case 3: resume
env $ENVS STUB="node $STUBJS" HERE="$T/a" sh "$T/a/run-model-swap.sh" --go --stage natural > "$T/r.log" 2>&1 || fail "case 3 exited non-zero"
[ "$(grep -c 'done, skipped' "$T/r.log")" = 8 ] || fail "case 3: not every task skipped"
echo "case 3 ok: rerun skips all 8"

# case 4: list stage (4 tasks), then a run with no hook text stops it
mkdir -p "$T/arm/tree"
env $ENVS LIST_TREE="$T/arm/tree" SKIP_ARM_CHECK=1 STUB="node $STUBJS" HERE="$T/a" sh "$T/a/run-model-swap.sh" --go --stage list > "$T/l.log" 2>&1 || { cat "$T/l.log"; fail "case 4 exited non-zero"; }
L=$T/a/runs-model-swap/list
[ "$(ls "$L" | grep -c '\.done$')" = 4 ] || fail "case 4: not 4 .done files"
grep -q -- "--arms konductor-list=dir:$T/arm/tree " "$L/calls.log" || fail "case 4: list arm not passed"
copy "$T/b"
if env $ENVS LIST_TREE="$T/arm/tree" SKIP_ARM_CHECK=1 STUB_HOOK=none STUB="node $STUBJS" HERE="$T/b" sh "$T/b/run-model-swap.sh" --go --stage list > "$T/l2.log" 2>&1; then fail "case 4 should stop on a hook miss"; fi
grep -q 'ran without its hook text' "$T/l2.log" || { cat "$T/l2.log"; fail "case 4: wrong stop"; }
# The list plan prices a task from run-nudge.sh's Sonnet list cells when they exist (here t8 at 8 credits a run).
copy "$T/e"
mkdir -p "$T/e/runs-nudge/t8-dec-deploy-strategy/konductor-list/t8-dec-deploy-strategy/1"
echo '{"status":"success","credits":8}' > "$T/e/runs-nudge/t8-dec-deploy-strategy/konductor-list/t8-dec-deploy-strategy/1/result.json"
env $ENVS LIST_TREE="$T/arm/tree" SKIP_ARM_CHECK=1 HERE="$T/e" sh "$T/e/run-model-swap.sh" --plan > "$T/lp.log" 2>&1 || { cat "$T/lp.log"; fail "case 4 plan exited non-zero"; }
grep -q '^| t8-dec-deploy-strategy | 3 | 8.00 (list) |' "$T/lp.log" || { cat "$T/lp.log"; fail "case 4: list plan does not use the Sonnet list cells"; }
echo "case 4 ok: list stage runs 4 tasks and stops on a hook miss"

# case 5: counted guard. Cap 100: the first task counts 3 x 15 = 45; then 45 + one run's limit 36 + 0.9 x budget
# leaves no room for a 36-credit budget, so the stage stops before the second task.
copy "$T/c"
if env $ENVS CAP=100 STUB_CREDITS=2 STUB="node $STUBJS" HERE="$T/c" sh "$T/c/run-model-swap.sh" --go --stage natural > "$T/g.log" 2>&1; then fail "case 5 should stop"; fi
grep -q 'counted 45.00 of 100' "$T/g.log" || { cat "$T/g.log"; fail "case 5: counted spend is not 15 a run"; }
[ "$(wc -l < "$T/c/runs-model-swap/natural/calls.log")" = 1 ] || fail "case 5: ran past the first task"
echo "case 5 ok: counted guard stops at the cap"

# case 6: summary over the reused cells and the stub runs (one opus run loads a skill whole)
copy "$T/d"
env $ENVS STUB_SKILL=decision-writing STUB="node $STUBJS" HERE="$T/d" sh "$T/d/run-model-swap.sh" --go --stage natural > "$T/s0.log" 2>&1 || { cat "$T/s0.log"; fail "case 6 run exited non-zero"; }
env $ENVS HERE="$T/d" sh "$T/d/run-model-swap.sh" --summary > "$T/s.log" 2>&1 || { cat "$T/s.log"; fail "case 6 exited non-zero"; }
S=$T/d/runs-model-swap/summary.md
grep -q '^| claude-sonnet-5.5 | natural (reused) | 8 | 24 | 2 | 1 | 1 | 0 | 0 | 0 |' "$S" || { cat "$S"; fail "case 6: sonnet row"; }
grep -q '^| claude-opus-5.5 | natural | 8 | 24 | 24 | 24 | 0 | 0 | 0 | 0 |' "$S" || { cat "$S"; fail "case 6: opus row"; }
echo "case 6 ok: summary rows"
echo "all stub cases passed (scratch $T)"
