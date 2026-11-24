#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# test-judge-standard.sh: paid-path test for judge-standard.sh (Kiro and Claude Code units) with a stub bench, helper and aws: no
# model, no keys, no spend. Checks the --plan dry run (no judge call), the paid pass (copies, code-only removal, the
# USD guard per unit, done markers, the three-arm report call), resume, the cap stop and the heavy-lock stop.
#
# Run by bench/runner/test/kit-standard.test.js.
#   bash bench/scenarios/konductor/standard/test-judge-standard.sh
set -uo pipefail
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT=$SELF/judge-standard.sh
T=$(mktemp -d /var/tmp/stdj-test.XXXXXX)
trap 'pkill -P "${HOLDER:-0}" 2>/dev/null; kill "${HOLDER:-0}" 2>/dev/null; git -C "$T/R" worktree prune 2>/dev/null; rm -rf "$T"' EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }

mkdir -p "$T/R/bench/runner" "$T/R/bench/scenarios/t1" "$T/bin"
echo '{}' > "$T/R/bench/scenarios/t1/t1-a.json"
cat > "$T/R/bench/runner/bench.js" <<'JS'
const fs = require('fs'); const path = require('path');
const a = process.argv.slice(2); fs.appendFileSync(process.env.CALLS, a.join(' ') + '\n');
if (a[0] === 'judge' && !a.includes('--plan')) {
  const run = a[a.indexOf('--run') + 1];
  fs.appendFileSync(path.join(run, 'credit-ledger.jsonl'), JSON.stringify({ unit: 'usd', usd: Number(process.env.STUB_USD || 0.5) }) + '\n');
  console.log('judged 6 calls');
}
if (a[0] === 'judge' && a.includes('--plan')) console.log('plan: 6 calls, about USD 0.03');
JS
git -C "$T/R" init -q && git -C "$T/R" add -A && git -C "$T/R" -c user.email=t@t -c user.name=t commit -qm stub
SHA=$(git -C "$T/R" rev-parse HEAD)
cat > "$T/lh.js" <<'JS'
const fs = require('fs'); const path = require('path');
const a = process.argv.slice(2); const cmd = a[0]; const R = a[a.length - 1];
if (cmd === 'code-only') console.log('t1-code');
if (cmd === 'judge-spent') { let usd = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (e.name === 'credit-ledger.jsonl') for (const l of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) usd += JSON.parse(l).usd || 0; } };
  walk(R); console.log(usd); }
JS
printf '#!/bin/sh\nexit 0\n' > "$T/bin/aws"; chmod +x "$T/bin/aws"
mk_root() { # mk_root NAME: a STANDARD root with two finished Kiro units (r1 t1, r2 t1), one unfinished (r1 t2) and one finished Claude Code unit (claude r1 t1)
  local r=$T/$1 u
  for u in r1/t1 r2/t1 r1/t2; do
    mkdir -p "$r/runs/$u/vanilla/t1-a" "$r/runs/$u/vanilla/t1-code" "$r/runs/$u/konductor/t1-code"
  done
  mkdir -p "$r/claude/runs/r1/t1/cc-vanilla/t1-a" "$r/claude/runs/r1/t1/cc-vanilla/t1-code"
  touch "$r/runs/r1/t1.done" "$r/runs/r2/t1.done" "$r/claude/runs/r1/t1.done"
  printf '{"benchSha":"%s"}\n' "$SHA" > "$r/plan.json"
}
run() { # run ROOTNAME [ARGS...]
  local root=$1; shift
  PATH="$T/bin:$PATH" CALLS="$T/calls" S="$T/$root" R="$T/R" HELPER="$T/lh.js" HEAVY_LOCK="$T/heavy.lock" HOST_CHECK=0 \
    bash "$SCRIPT" "$@" > "$T/log" 2>&1
}
judges() { grep -c '^judge ' "$T/calls" | tr -d ' '; }

bash -n "$SCRIPT" && ok "bash -n clean" || bad "syntax"

mk_root A
: > "$T/calls"; run A --plan; rc=$?
[ "$rc" = 0 ] && [ "$(judges)" = 3 ] && [ "$(grep -c -- '--plan' "$T/calls")" = 3 ] && ok "--plan: one plan call per finished unit (2 Kiro, 1 Claude Code), exit 0" || { bad "plan: rc $rc"; cat "$T/log"; }
[ ! -e "$T/A/judge/runs/r1-t1" ] && ! grep -q '^report' "$T/calls" && ok "--plan copies nothing and writes no report" || bad "plan side effects"
grep -q 'r1 t2: run not finished, left out' "$T/log" && ok "unfinished unit left out" || bad "no left-out line"

: > "$T/calls"; run A; rc=$?
[ "$rc" = 0 ] && [ "$(grep -c '^judge .*--budget-usd' "$T/calls")" = 3 ] && ok "paid pass judges the 3 finished units" || { bad "paid: rc $rc"; cat "$T/log"; }
grep '^judge ' "$T/calls" | sed -n 1p | grep -q -- '--budget-usd 25.0000' && grep '^judge ' "$T/calls" | sed -n 3p | grep -q -- '--budget-usd 24.0000' && ok "USD guard is the cap minus spend so far" || bad "guards: $(grep '^judge' "$T/calls")"
[ ! -e "$T/A/judge/runs/r1-t1/vanilla/t1-code" ] && [ -d "$T/A/judge/runs/r1-t1/vanilla/t1-a" ] && [ -d "$T/A/runs/r1/t1/vanilla/t1-code" ] && ok "code-only task removed from the copy, raw run kept" || bad "copy"
grep -q "^report --run $T/A/judge/runs/r1-t1,$T/A/judge/runs/r2-t1 --baseline vanilla" "$T/calls" && ok "Kiro report over both judged copies, baseline vanilla" || bad "report: $(grep '^report' "$T/calls")"
grep -q "^report --run $T/A/judge/runs/r1-t1,$T/A/judge/runs/r2-t1 --baseline konductor .*--out $T/A/judge/report-vs-konductor" "$T/calls" && grep -q "^report .*--baseline konductor-noskills .*--out $T/A/judge/report-vs-noskills" "$T/calls" && ok "Kiro reports against konductor and noskills (the list-hook gaps)" || bad "list reports: $(grep '^report' "$T/calls")"
grep -q "^report --run $T/A/judge/runs/cc-r1-t1 --baseline cc-vanilla .*--out $T/A/judge/report-cc" "$T/calls" && ok "Claude Code report over its copy, baseline cc-vanilla" || bad "cc report: $(grep '^report' "$T/calls")"
grep -q "^report --run $T/A/judge/runs/cc-r1-t1 --baseline cc-konductor .*--out $T/A/judge/report-cc-vs-konductor" "$T/calls" && grep -q "^report .*--baseline cc-konductor-noskills .*--out $T/A/judge/report-cc-vs-noskills" "$T/calls" && ok "Claude Code reports against cc-konductor and cc-noskills (the cc list-hook gaps)" || bad "cc list reports: $(grep '^report' "$T/calls")"
[ ! -e "$T/A/judge/runs/cc-r1-t1/cc-vanilla/t1-code" ] && [ -d "$T/A/judge/runs/cc-r1-t1/cc-vanilla/t1-a" ] && ok "code-only task removed from the Claude Code copy too" || bad "cc copy"
[ -e "$T/A/judge/runs/r1-t1.done" ] && [ -e "$T/A/judge/runs/r2-t1.done" ] && [ -e "$T/A/judge/runs/cc-r1-t1.done" ] && ok "done markers" || bad "markers"

: > "$T/calls"; run A; rc=$?
[ "$rc" = 0 ] && [ "$(judges)" = 0 ] && grep -q 'r2 t1: judged, skipped' "$T/log" && grep -q 'cc-r1 t1: judged, skipped' "$T/log" && ok "rerun skips judged units" || bad "resume: rc $rc, judges $(judges)"

mk_root B
: > "$T/calls"; STUB_USD=24.6 run B; rc=$?
[ "$rc" = 1 ] && [ "$(judges)" = 1 ] && grep -q 'STOP: spent USD 24.6 of the USD 25 cap before r2 t1' "$T/log" && ok "cap stop before a unit that could pass it" || bad "cap: rc $rc; $(tail -n 2 "$T/log")"

mk_root C
: > "$T/calls"; flock -x "$T/heavy.lock" sleep 60 & HOLDER=$!; sleep 0.3
run C; rc=$?
pkill -P "$HOLDER" 2>/dev/null; kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
[ "$rc" = 1 ] && [ "$(judges)" = 0 ] && grep -q 'STOP: the heavy lock .* is held' "$T/log" && ok "held heavy lock: stops, no call" || bad "heavy: rc $rc; $(cat "$T/log")"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
