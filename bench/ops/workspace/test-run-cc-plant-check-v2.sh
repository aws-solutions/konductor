#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-run-cc-plant-check-v2.sh -- paid-path test (review F2) for run-cc-plant-check-v2.sh. Runs the PAID path (no
# --dry-run) with a stub checkout, release, venv, claude and bench: no model, no keys, no spend, a private heavy lock.
# Checks that the paid path gets past the LOGDIR line, runs bench once with --aws-profile, and reaches its verdict;
# and that the old run-cc-plant-check.sh fails at that line (the bug the v2 fixes).
#
#   bash scripts/test-run-cc-plant-check-v2.sh
set -uo pipefail
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
T=$(mktemp -d /tmp/ccplant-test.XXXXXX)
trap 'rm -rf "$T"' EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }
TASK=stub-task.v01

mkdir -p "$T/co/bench/runner" "$T/venv/bin" "$T/release/tasks" "$T/ws/reports" "$T/out"
printf '{"m":1}\n' > "$T/release/manifest.json"; : > "$T/release/manifest.json.sig"; printf '{}\n' > "$T/release/tasks/$TASK.json"
printf '#!/bin/sh\nexit 0\n' > "$T/venv/bin/python"; chmod +x "$T/venv/bin/python"
printf '#!/bin/sh\nexit 0\n' > "$T/claude"; chmod +x "$T/claude"
# stub bench: log argv, then write a passing trial for each arm under --out
cat > "$T/co/bench/runner/bench.js" <<'JS'
const fs = require('fs'); const path = require('path');
const a = process.argv.slice(2); fs.appendFileSync(process.env.CALLS, a.join(' ') + '\n');
const out = a[a.indexOf('--out') + 1]; const task = a[a.indexOf('--tasks') + 1];
for (const arm of ['cc-plant-allowall', 'cc-plant-policy']) {
  const d = path.join(out, arm, task, '1'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ costUsd: 0.1, plant: { runState: 'complete', safety: 'safe', counts: { mismatches: 0, calls: 1 } } }));
  fs.writeFileSync(path.join(d, 'stream.jsonl'), [
    { type: 'system', subtype: 'init', mcp_servers: [{ name: 'plant', status: 'connected' }], tools: ['mcp__plant__get_state'] },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plant__get_state' }] } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
}
JS
SHA=$(sha256sum "$T/release/manifest.json" | cut -d' ' -f1)
run() {  # run <script>: the paid path with every override pointed at the stubs
  CALLS="$T/calls" PLANT_CHECKOUT="$T/co" PLANT_VENV="$T/venv" PLANT_FFI="$T" ARM_RELEASE="$T/release" ARM_SHA="$SHA" \
    CC_TASK="$TASK" CC_CLAUDE_BIN="$T/claude" CC_AWS_PROFILE=stub-profile CC_WORKSPACE="$T/ws" \
    CC_HEAVY_LOCK="$T/heavy.lock" CC_OUT_ROOT="$T/out" bash "$1" > "$T/log" 2>&1
}

bash -n "$SELF/run-cc-plant-check-v2.sh" && ok "v2: bash -n clean" || bad "v2 syntax"

: > "$T/calls"
run "$SELF/run-cc-plant-check-v2.sh"; rc=$?
[ "$rc" = 0 ] && ok "v2 paid path exits 0 on a passing stub trial" || { bad "v2 paid path exit $rc"; cat "$T/log"; }
grep -q "^PASS: the Claude Code plant mount works on the real binary" "$T/log" && ok "v2 reaches its verdict" || bad "no verdict line"
[ "$(wc -l < "$T/calls")" = 1 ] && ok "bench ran once" || bad "bench calls: $(wc -l < "$T/calls")"
grep -q -- "--aws-profile stub-profile" "$T/calls" && ok "paid path passes --aws-profile" || bad "no --aws-profile in the bench call"
ls "$T/ws/reports" | grep -q '^cc-plant-check-[0-9-]*$' && ok "log dir has no -dry suffix" || bad "log dir: $(ls "$T/ws/reports")"
[ -z "$(ls -A "$T/out")" ] && ok "out root left empty" || bad "out root: $(ls -A "$T/out")"

# a STOP before the run leaves no out dir behind (v2 makes it after the checks)
CALLS="$T/calls" PLANT_CHECKOUT="$T/nope" CC_WORKSPACE="$T/ws" CC_OUT_ROOT="$T/out" bash "$SELF/run-cc-plant-check-v2.sh" > "$T/log" 2>&1
grep -q "STOP: no bench at" "$T/log" && [ -z "$(ls -A "$T/out")" ] && ok "a STOP names its reason and leaves no out dir" || bad "STOP path: $(cat "$T/log")"

# the old script dies at the LOGDIR line on the paid path, with no message (review F2)
: > "$T/calls"
run "$SELF/run-cc-plant-check.sh"; rc=$?
[ "$rc" = 1 ] && [ ! -s "$T/calls" ] && ! grep -q STOP "$T/log" && ok "the old script fails silently before bench (the bug)" || note=1
[ "${note:-0}" = 1 ] && printf 'NOTE: the old script did not show the silent exit (rc %s)\n' "$rc"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
