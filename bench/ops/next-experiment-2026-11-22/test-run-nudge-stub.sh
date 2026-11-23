#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Free test of run-nudge.sh's paid path with a stub bench command. No model call, no kiro-cli.
#   case 1: the stub writes runs whose session record holds the hook text -> all 8 tasks done, nudge-check passes
#   case 2: the stub writes runs with no hook text -> the script stops after the first task, no .done for it
#   case 3: a rerun of case 1's folder skips every task (resume)
#   case 4: a budget-skipped cell is "not run": no stop, that task gets no .done, and a rerun resumes only it
#   case 5: runner exit 5 with an agent self-kill is a run result: no stop, all 8 tasks done
#   case 6: runner exit 5 with a plain error stops
#   case 7: a task folder with all 6 results and no .done is closed with no bench call (the owner's restart state)
set -eu
HERE0=$(cd "$(dirname "$0")" && pwd)
# The copied script cannot find its checkout from its own path, so name it: this test's checkout.
CHECK_BENCH=$(cd "$HERE0/../../.." && pwd)
export CHECK_BENCH
T=$(mktemp -d "${KIROCREW_SCRATCH:-/var/tmp}/nudge-stub.XXXXXX")
STUBJS=$T/stub.js
cat > "$STUBJS" <<'JS'
// Stub for `node bench.js run ...`: writes one result per arm and replicate, and a session record.
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
const out = val('--out'), task = val('--tasks'), arms = val('--arms').split(',').map((s) => s.split('=')[0]);
fs.appendFileSync(path.join(path.dirname(out), 'calls.log'), a.join(' ') + '\n');
const hint = process.env.STUB_HOOK === 'none' ? 'nothing here' : null;
const resume = a.includes('--resume');
for (const arm of arms) for (const rep of [1, 2, 3]) {
  const d = path.join(out, arm, task, String(rep));
  const res = path.join(d, 'result.json');
  // --resume, as the frozen runner: only cells with no result or a budget_skipped one run again.
  if (resume && fs.existsSync(res) && JSON.parse(fs.readFileSync(res, 'utf8')).status !== 'budget_skipped') continue;
  // STUB_SKIP=<task>: the list arm's replicate 3 is budget skipped, as the runner writes it (a result.json alone).
  if (!resume && process.env.STUB_SKIP === task && arm.includes('list') && rep === 3) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(res, JSON.stringify({ armId: arm, taskId: task, replicate: rep, status: 'budget_skipped', credits: null }));
    continue;
  }
  fs.mkdirSync(path.join(d, 'session', 'sess_1'), { recursive: true });
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ armId: arm, taskId: task, replicate: rep, status: 'success', credits: 1, finalText: 'ok' }));
  fs.writeFileSync(path.join(d, 'stream.jsonl'), '');
  const header = arm.includes('filler') ? 'Notes for this request (no action needed):' : 'Your skills (load one with get_skill; each one\'s trigger line is under "## Your skills" in your instructions):';
  fs.writeFileSync(path.join(d, 'session', 'sess_1', 'messages.jsonl'), JSON.stringify({ payload: { type: 'user', content: (hint ?? header + '\n  x') } }) + '\n');
  // STUB_ERR=<task>:selfkill|plain: the list arm's replicate 1 errors, as an agent self-kill (an interrupted pkill and a
  // SIGTERM exit) or a plain error; the stub then exits 5, the runner's infra stop.
  const [errTask, errKind] = String(process.env.STUB_ERR || '').split(':');
  if (errTask === task && arm.includes('list') && rep === 1) {
    fs.writeFileSync(res, JSON.stringify({ armId: arm, taskId: task, replicate: rep, status: 'error', stopReason: 'cancelled', credits: 4 }));
    if (errKind === 'selfkill') {
      fs.writeFileSync(path.join(d, 'stderr.txt'), 'kas exit code=143 reason=SIGTERM during signal shutdown\n');
      fs.writeFileSync(path.join(d, 'stream.jsonl'), JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', status: 'failed', rawInput: { command: 'pkill -f "node -"' }, content: [{ type: 'content', content: { type: 'text', text: 'This tool was interrupted before it reported a result.' } }] } } }) + '\n');
    }
  }
}
if (String(process.env.STUB_ERR || '').split(':')[0] === task) process.exit(5);
JS
fail() { echo "FAIL: $*"; exit 1; }
copy() { mkdir -p "$1"; cp "$HERE0/run-nudge.sh" "$1/"; }

copy "$T/a"
FORCED_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock STUB="node $STUBJS" HERE="$T/a" sh "$T/a/run-nudge.sh" --go > "$T/a.log" 2>&1 || { cat "$T/a.log"; fail "case 1 exited non-zero"; }
[ "$(ls "$T/a/runs-nudge" | grep -c '\.done$')" = 8 ] || fail "case 1: not 8 .done files"
[ "$(wc -l < "$T/a/runs-nudge/calls.log")" = 8 ] || fail "case 1: not 8 bench calls"
grep -q -- '--arms konductor-list=dir:/var/tmp/konductor-nudge-arms/variants/konductor-list-4a05c9e54b9f/tree,konductor-filler=dir:/var/tmp/konductor-nudge-arms/variants/konductor-filler-023c8003eb5c/tree' "$T/a/runs-nudge/calls.log" || fail "case 1: arms not passed"
grep -q -- '--budget-credits 68 --run-credit-limit 68' "$T/a/runs-nudge/calls.log" || fail "case 1: t6 budget is not max(65, 68)"
grep -q 'true' "$T/a/runs-nudge/t8-dec-deploy-strategy.check.md" || fail "case 1: no nudge-check table"
echo "case 1 ok: 8 tasks, nudge-check passed"

copy "$T/b"
if FORCED_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock STUB_HOOK=none STUB="node $STUBJS" HERE="$T/b" sh "$T/b/run-nudge.sh" --go > "$T/b.log" 2>&1; then fail "case 2 should stop"; fi
grep -q 'ran without its hook text' "$T/b.log" || { cat "$T/b.log"; fail "case 2: wrong stop"; }
[ ! -e "$T/b/runs-nudge/t8-dec-deploy-strategy.done" ] || fail "case 2: first task marked done"
[ "$(wc -l < "$T/b/runs-nudge/calls.log")" = 1 ] || fail "case 2: ran past the first task"
echo "case 2 ok: stopped after the first task"

FORCED_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock STUB="node $STUBJS" HERE="$T/a" sh "$T/a/run-nudge.sh" --go > "$T/c.log" 2>&1 || fail "case 3 exited non-zero"
[ "$(grep -c 'done, skipped' "$T/c.log")" = 8 ] || fail "case 3: not every task skipped"
echo "case 3 ok: rerun skips all 8"

# case 4: a budget-skipped cell is not a hook miss: no stop, no .done for that task, the rest run; a rerun resumes it.
copy "$T/d"
FORCED_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock STUB_SKIP=t5-qa-sync-strategy STUB="node $STUBJS" HERE="$T/d" sh "$T/d/run-nudge.sh" --go > "$T/d.log" 2>&1 || { cat "$T/d.log"; fail "case 4 stopped on a budget skip"; }
[ ! -e "$T/d/runs-nudge/t5-qa-sync-strategy.done" ] || fail "case 4: a task with a cell not run was marked done"
[ "$(ls "$T/d/runs-nudge" | grep -c '\.done$')" = 7 ] || fail "case 4: not 7 .done files"
grep -q 'not run (budget_skipped)' "$T/d/runs-nudge/t5-qa-sync-strategy.check.md" || fail "case 4: check does not show the cell as not run"
FORCED_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock STUB="node $STUBJS" HERE="$T/d" sh "$T/d/run-nudge.sh" --go > "$T/e.log" 2>&1 || { cat "$T/e.log"; fail "case 4 rerun exited non-zero"; }
[ "$(grep -c 'done, skipped' "$T/e.log")" = 7 ] || fail "case 4 rerun: not 7 tasks skipped"
[ "$(grep -c -- '--resume' "$T/d/runs-nudge/calls.log")" = 1 ] || fail "case 4 rerun: t5-qa-sync-strategy not resumed once"
grep -q 'resuming' "$T/e.log" || fail "case 4 rerun: no resume line"
[ -e "$T/d/runs-nudge/t5-qa-sync-strategy.done" ] || fail "case 4 rerun: the resumed task is not done"
echo "case 4 ok: a budget skip is not a hook miss, and a rerun resumes only that task"

# case 5: exit 5 with an agent self-kill goes on: all 8 tasks done, the self-kill kept as a run result.
copy "$T/f"
FORCED_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock STUB_ERR=t5-qa-sync-strategy:selfkill STUB="node $STUBJS" HERE="$T/f" sh "$T/f/run-nudge.sh" --go > "$T/f.log" 2>&1 || { cat "$T/f.log"; fail "case 5 stopped on an agent self-kill"; }
[ "$(ls "$T/f/runs-nudge" | grep -c '\.done$')" = 8 ] || fail "case 5: not 8 .done files"
grep -q 'agent self-kill' "$T/f/runs-nudge/t5-qa-sync-strategy.check.md" || fail "case 5: check does not show the self-kill"
grep -q 'every error is an agent self-kill' "$T/f.log" || fail "case 5: no going-on line"
echo "case 5 ok: an agent self-kill is a run result, the study goes on"

# case 6: exit 5 with a plain error still stops, with no .done for that task.
copy "$T/g"
if FORCED_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock STUB_ERR=t8-dec-deploy-strategy:plain STUB="node $STUBJS" HERE="$T/g" sh "$T/g/run-nudge.sh" --go > "$T/g.log" 2>&1; then fail "case 6 should stop"; fi
grep -q 'not an agent self-kill' "$T/g.log" || { cat "$T/g.log"; fail "case 6: wrong stop"; }
[ ! -e "$T/g/runs-nudge/t8-dec-deploy-strategy.done" ] || fail "case 6: errored task marked done"
echo "case 6 ok: a plain error with exit 5 stops"

# case 7: the owner's restart state: a task folder with all 6 results (one a self-kill) and no .done gets no bench call.
rm "$T/f/runs-nudge/t5-qa-sync-strategy.done"
FORCED_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock STUB="node $STUBJS" HERE="$T/f" sh "$T/f/run-nudge.sh" --go > "$T/h.log" 2>&1 || { cat "$T/h.log"; fail "case 7 exited non-zero"; }
grep -q 'all 6 cells have a result, no bench call' "$T/h.log" || fail "case 7: bench was called"
[ "$(wc -l < "$T/f/runs-nudge/calls.log")" = 8 ] || fail "case 7: a bench call was made"
[ -e "$T/f/runs-nudge/t5-qa-sync-strategy.done" ] || fail "case 7: task not marked done"
echo "case 7 ok: a full task folder is closed with no bench call"
echo "all stub cases passed (scratch $T)"
