#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Free test of run-model-swap.sh with a stub bench command and a fake reused baseline. No model call, no kiro-cli.
#   case 1: --plan prints the natural stage's 8 tasks, the 24 reused Sonnet cells, and the counted and real totals
#   case 2: --go --stage natural runs 8 tasks on Opus with the plain konductor arm, 3 replicates each, all .done
#   case 3: a rerun skips every task (resume)
#   case 4: --go --stage list runs the 4 skill-heavy tasks with the list arm; a run without hook text stops it
#   case 5: the counted-credit guard (15 per run at least) stops a stage that would pass its cap
#   case 6: --summary counts loaded whole, preview only, find_skills and "no skill fits" per model and arm
#   case 7: --fill --plan shows only t1-nfr-report-queries with its 2 budget-skipped cells, budget and the fill cap
#   case 8: --fill --go resumes only t1 with that budget and closes it; a rerun makes no bench call
#   case 9: --fill stops when a cell outside the fill set has no result
#   case 10: --fill stops before the bench call when counted fill spend plus the task's worst case passes the fill cap
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
. "$(dirname "$0")/../lib.sh"   # say, stop and fail (B-005)
copy() { mkdir -p "$1"; cp "$HERE0/run-model-swap.sh" "$HERE0/model-swap-summary.js" "$HERE0/lib.sh" "$HERE0/nudge-fill.js" "$1/"; }

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

# A natural stage cut by its cap as the real one was: 7 tasks done, t1-nfr-report-queries rep 1 ran (36.9 credits),
# reps 2 and 3 budget skipped. fill_dir DIR writes it.
fill_dir() {
  copy "$1"
  F=$1/runs-model-swap/natural
  for t in t8-dec-deploy-strategy t5-qa-checkout-strategy t5-qa-sync-strategy t6-req-field-inspections t2-dr-notify-fanout \
    t2-arch-dr-split-checkout t7-program-brief; do mkdir -p "$F/$t"; touch "$F/$t.done"; done
  C=$F/t1-nfr-report-queries/konductor/t1-nfr-report-queries
  mkdir -p "$C/1" "$C/2" "$C/3"
  echo '{"status":"success","credits":36.9,"flags":[]}' > "$C/1/result.json"
  mkdir -p "$C/1/session/sess_1"; : > "$C/1/stream.jsonl"
  echo '{"payload":{"type":"user","content":"plain prompt"}}' > "$C/1/session/sess_1/messages.jsonl"
  echo '{"status":"budget_skipped","flags":[]}' > "$C/2/result.json"
  echo '{"status":"budget_skipped","flags":[]}' > "$C/3/result.json"
  echo '{"kind":"run","arm":"konductor","task":"t1-nfr-report-queries","replicate":1,"credits":36.9}' > "$F/t1-nfr-report-queries/credit-ledger.jsonl"
}

# case 7: fill plan. Run limit 36 (23 x 2/1.3); a cell at worst 54 (36 x 1.5, the largest overshoot seen) plus one
# throttled attempt at 15: 69; budget 2 x 54 = 108; fill cap 2 x 69 = 138.
fill_dir "$T/f"
env $ENVS HERE="$T/f" sh "$T/f/run-model-swap.sh" --fill --plan > "$T/fp.log" 2>&1 || { cat "$T/fp.log"; fail "case 7 exited non-zero"; }
[ "$(grep -c '^| t[0-9]' "$T/fp.log")" = 1 ] || { cat "$T/fp.log"; fail "case 7: not one task row"; }
grep -q '^| t1-nfr-report-queries | 2 | 36 | 54 | 108 | 0.00 | 138.00 |' "$T/fp.log" || { cat "$T/fp.log"; fail "case 7: t1 row"; }
grep -q 'fill cap 138 counted credits' "$T/fp.log" || { cat "$T/fp.log"; fail "case 7: fill cap"; }
[ ! -e "$T/f/runs-model-swap/natural/calls.log" ] || fail "case 7: the plan made a bench call"
echo "case 7 ok: fill plan shows t1, 2 cells, budget 108, cap 138"

# case 8: fill go, then a rerun
env $ENVS STUB="node $STUBJS" HERE="$T/f" sh "$T/f/run-model-swap.sh" --fill --go > "$T/fg.log" 2>&1 || { cat "$T/fg.log"; fail "case 8 exited non-zero"; }
F=$T/f/runs-model-swap/natural
[ "$(wc -l < "$F/calls.log")" = 1 ] || fail "case 8: not one bench call"
grep -q -- '--tasks t1-nfr-report-queries .*--budget-credits 108 --run-credit-limit 36 .*--resume' "$F/calls.log" || { cat "$F/calls.log"; fail "case 8: wrong call"; }
grep -q -- '--model claude-opus-5.5 ' "$F/calls.log" || fail "case 8: not opus"
[ -e "$F/t1-nfr-report-queries.done" ] || { cat "$T/fg.log"; fail "case 8: t1 has no .done"; }
grep -q '"credits":36.9' "$F/t1-nfr-report-queries/konductor/t1-nfr-report-queries/1/result.json" || fail "case 8: rep 1 was run again"
env $ENVS STUB="node $STUBJS" HERE="$T/f" sh "$T/f/run-model-swap.sh" --fill --go > "$T/fg2.log" 2>&1 || { cat "$T/fg2.log"; fail "case 8 rerun exited non-zero"; }
[ "$(wc -l < "$F/calls.log")" = 1 ] || fail "case 8: the rerun made a bench call"
echo "case 8 ok: fill runs only t1's 2 cells with budget 108 and closes it"

# case 9: rep 1 (outside the fill set) has no result
fill_dir "$T/g"
rm "$T/g/runs-model-swap/natural/t1-nfr-report-queries/konductor/t1-nfr-report-queries/1/result.json"
if env $ENVS STUB="node $STUBJS" HERE="$T/g" sh "$T/g/run-model-swap.sh" --fill --go > "$T/f9.log" 2>&1; then fail "case 9 should stop"; fi
grep -q 'a cell outside the fill set has no result' "$T/f9.log" || { cat "$T/f9.log"; fail "case 9: wrong stop"; }
[ ! -e "$T/g/runs-model-swap/natural/calls.log" ] || fail "case 9: a bench call was made"
echo "case 9 ok: a missing cell outside the set stops the fill"

# case 10: a throttled attempt of rep 2 already counted 80: 80 + 2 x 69 > 138
fill_dir "$T/h"
echo '{"kind":"run","arm":"konductor","task":"t1-nfr-report-queries","replicate":2,"credits":80,"throttled":true}' >> "$T/h/runs-model-swap/natural/t1-nfr-report-queries/credit-ledger.jsonl"
if env $ENVS STUB="node $STUBJS" HERE="$T/h" sh "$T/h/run-model-swap.sh" --fill --go > "$T/f10.log" 2>&1; then fail "case 10 should stop"; fi
grep -q 'counted 80.00 of 138' "$T/f10.log" || { cat "$T/f10.log"; fail "case 10: wrong stop"; }
[ ! -e "$T/h/runs-model-swap/natural/calls.log" ] || fail "case 10: a bench call was made"
echo "case 10 ok: the fill cap stops before the bench call"
echo "all stub cases passed (scratch $T)"
