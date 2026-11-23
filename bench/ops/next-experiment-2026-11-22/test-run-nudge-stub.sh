#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Free test of run-nudge.sh's paid path with a stub bench command. No model call, no kiro-cli.
#   case 1: the stub writes runs whose session record holds the hook text -> all 8 tasks done, nudge-check passes
#   case 2: the stub writes runs with no hook text -> the script stops after the first task, no .done for it
#   case 3: a rerun of case 1's folder skips every task (resume)
set -eu
HERE0=$(cd "$(dirname "$0")" && pwd)
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
for (const arm of arms) for (const rep of [1, 2, 3]) {
  const d = path.join(out, arm, task, String(rep));
  fs.mkdirSync(path.join(d, 'session', 'sess_1'), { recursive: true });
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ armId: arm, taskId: task, replicate: rep, status: 'success', credits: 1, finalText: 'ok' }));
  fs.writeFileSync(path.join(d, 'stream.jsonl'), '');
  const header = arm.includes('filler') ? 'Notes for this request (no action needed):' : 'Your skills (load one with get_skill; each one\'s trigger line is under "## Your skills" in your instructions):';
  fs.writeFileSync(path.join(d, 'session', 'sess_1', 'messages.jsonl'), JSON.stringify({ payload: { type: 'user', content: (hint ?? header + '\n  x') } }) + '\n');
}
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
echo "all stub cases passed (scratch $T)"
