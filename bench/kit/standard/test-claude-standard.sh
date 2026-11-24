#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# test-claude-standard.sh: paid-path test for claude-standard.sh with a stub bench, helper and claude: no model, no
# keys, no spend, every dir under /var/tmp. Checks --plan (no bench call), the --prepare-only dry run (four cc- arms
# from the plan, no profile), the paid path through two stages (per-batch USD guard off the stage cap, done markers,
# --replicate-offset, resume with --resume), the stage cap stop, the stage gate, the missing-profile stop, the
# preview-plan refusal and the bench-pin check.
#
# Run by bench/runner/test/kit-standard.test.js.
#   bash bench/kit/standard/test-claude-standard.sh
set -uo pipefail
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT=$SELF/claude-standard.sh
T=$(mktemp -d /var/tmp/stdc-test.XXXXXX)
trap 'rm -rf "$T"' EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }

mkdir -p "$T/R/bench/runner" "$T/bin"
# stub bench: logs every call; a paid run writes run-config.json and one result.json with costUsd STUB_USD
cat > "$T/R/bench/runner/bench.js" <<'JS'
const fs = require('fs'); const path = require('path');
const a = process.argv.slice(2); fs.appendFileSync(process.env.CALLS, a.join(' ') + '\n'); fs.appendFileSync(process.env.CALLS + '.env', `${process.env.TMPDIR}\n`);
if (a[0] === 'run' && !a.includes('--prepare-only')) {
  const out = a[a.indexOf('--out') + 1]; const d = path.join(out, 'cc-vanilla', 't1-a', '1');
  fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(out, 'run-config.json'), '{}\n');
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ costUsd: Number(process.env.STUB_USD || 2) }));
  const rcFile = process.env.STUB_RC_FILE;
  if (rcFile && fs.existsSync(rcFile)) { process.exitCode = Number(fs.readFileSync(rcFile, 'utf8')); fs.unlinkSync(rcFile); }
} else if (a[0] === 'scenarios') console.log('| stub table |');
JS
git -C "$T/R" init -q && git -C "$T/R" add -A && git -C "$T/R" -c user.email=t@t -c user.name=t commit -qm stub
SHA=$(git -C "$T/R" rev-parse HEAD)
# stub helper: cc-plan from the plan's sha and noskills arm (two batches), usd-spent over result.json, stage, summary
cat > "$T/helper.js" <<'JS'
const fs = require('fs'); const path = require('path');
const [cmd, , ...rest] = process.argv.slice(2);
if (cmd === 'cc-plan') {
  const p = JSON.parse(fs.readFileSync(rest[0], 'utf8'));
  console.log(JSON.stringify({ arms: ['cc-vanilla', `cc-konductor=${p.konductorSha}`, `cc-${p.noskillsArm}`, `cc-${p.listArm}`], armIds: ['cc-vanilla', 'cc-konductor', 'cc-konductor-noskills', 'cc-konductor-list'],
    usdPerPlainCredit: 0.071, ratio: { 'cc-konductor': 1.59, 'cc-konductor-noskills': 1.3 }, batches: { t1: { tasks: ['t1-a', 't1-b'], expectedUsd: 3 }, t9: { tasks: ['t9-x'], expectedUsd: 1.5 } }, expectedUsdPerStage: 4.5, runsPerStage: 9 }));
} else if (cmd === 'usd-spent') {
  let usd = 0; const walk = (d) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name === 'result.json') usd += JSON.parse(fs.readFileSync(f, 'utf8')).costUsd || 0; } };
  walk(rest[0]); console.log(usd);
} else if (cmd === 'stage') { console.log(`stub stage ${rest.join(' ')}`); process.exitCode = Number(process.env.STUB_STAGE_RC || 0); }
else if (cmd === 'summary') fs.writeFileSync(rest[rest.indexOf('--arms') + 2], 'stub summary\n');
JS
printf '#!/bin/sh\nexit 0\n' > "$T/bin/claude"; printf '#!/bin/sh\nexit 0\n' > "$T/bin/aws"; chmod +x "$T/bin/claude" "$T/bin/aws"
mk_root() { mkdir -p "$T/$1"; printf '{"benchSha":"%s","konductorSha":"kon123","noskillsArm":"konductor-noskills=dir:/var/tmp/x/tree","listArm":"konductor-list=dir:/var/tmp/x/list"}\n' "${2:-$SHA}" > "$T/$1/plan.json"; }
run() { # run ROOTNAME [ARGS...]
  local root=$1; shift
  PATH="$T/bin:$PATH" CALLS="$T/calls" S="$T/$root" R="$T/R" HELPER="$T/helper.js" CC_CLAUDE_BIN="$T/bin/claude" HEAVY_LOCK="$T/heavy.lock" \
    HOST_CHECK=0 WAIT_MAX=0 bash "$SCRIPT" "$@" > "$T/log" 2>&1
}
runs() { grep -c '^run ' "$T/calls" | tr -d ' '; }
nth_run() { grep '^run ' "$T/calls" | sed -n "$1p"; }
THREE='--arms cc-vanilla,cc-konductor=kon123,cc-konductor-noskills=dir:/var/tmp/x/tree,cc-konductor-list=dir:/var/tmp/x/list '

bash -n "$SCRIPT" && ok "bash -n clean" || bad "syntax"

mk_root A
: > "$T/calls"; run A --plan; rc=$?
[ "$rc" = 0 ] && [ ! -s "$T/calls" ] && grep -q 'expected USD 4.5 a stage' "$T/log" && grep -q 't1: 2 task(s), expected USD 3' "$T/log" && [ -s "$T/A/claude/cc-plan.json" ] && ok "--plan: arms, batches and USD from the plan, no bench call" || { bad "plan: rc $rc"; cat "$T/log"; }

: > "$T/calls"; : > "$T/calls.env"; TMPDIR=$HOME run A --prepare-only; rc=$?
[ "$rc" = 0 ] && [ "$(runs)" = 1 ] && grep -q -- '--prepare-only' "$T/calls" && ! grep -q -- '--aws-profile' "$T/calls" && ok "prepare-only: one bench --prepare-only, no profile needed" || { bad "prep: rc $rc"; cat "$T/log"; }
grep -q -- "--tasks t1-a,t1-b,t9-x $THREE" "$T/calls" && grep -q -- '--run-budget-usd 1.5 --replicates 1 --budget-usd 110' "$T/calls" && ok "four cc- arms from the plan's sha, noskills and list trees; USD 1.5 a run, 110 a stage" || bad "args: $(cat "$T/calls")"
[ "$(sort -u "$T/calls.env")" = /tmp ] && ok "bench runs with TMPDIR=/tmp, outside HOME" || bad "TMPDIR: $(sort -u "$T/calls.env")"
[ ! -e "$T/A/claude/runs" ] && ok "prepare-only makes no run dir" || bad "run dir made"

: > "$T/calls"; run A; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && grep -q 'needs CC_AWS_PROFILE' "$T/log" && ok "paid path without a profile stops before bench" || bad "profile: rc $rc"

: > "$T/calls"; CC_AWS_PROFILE=stub run A; rc=$?
[ "$rc" = 0 ] && [ "$(runs)" = 4 ] && grep -q 'all Claude Code units finished' "$T/log" && ok "paid path: 4 bench runs (2 batches x 2 stages)" || { bad "paid: rc $rc, runs $(runs)"; tail -n 8 "$T/log"; }
nth_run 1 | grep -q -- "--tasks t1-a,t1-b $THREE.*--replicates 1 --replicate-offset 0 --aws-profile stub --budget-usd 108.50 --out $T/A/claude/runs/r1/t1" && ok "stage 1 first batch: guard 110 - 0 - 1.5" || bad "first run: $(nth_run 1)"
nth_run 2 | grep -q -- '--tasks t9-x .*--budget-usd 106.50 --out' && ok "second batch takes the stage's USD 2 off" || bad "second run: $(nth_run 2)"
nth_run 3 | grep -q -- '--replicate-offset 1 --aws-profile stub --budget-usd 108.50 --out .*/r2/t1' && ok "stage 2 is replicate 2 with its own cap" || bad "third run: $(nth_run 3)"
grep -q 'stub stage --arms cc-vanilla,cc-konductor,cc-konductor-noskills,cc-konductor-list' "$T/log" && ok "stage gate checks the four cc- arms" || bad "stage gate: $(grep 'stub stage' "$T/log")"
[ "$(ls "$T"/A/claude/runs/r*/*.done | wc -l)" = 4 ] && [ -s "$T/A/claude/tables/code-gap.md" ] && ok "4 done markers and the code-gap table" || bad "markers: $(ls "$T"/A/claude/runs/r*/)"

: > "$T/calls"; CC_AWS_PROFILE=stub run A; rc=$?
[ "$rc" = 0 ] && [ "$(runs)" = 0 ] && grep -q 'r2 t9: done, skipped' "$T/log" && ok "rerun after done starts nothing" || bad "done rerun: rc $rc, runs $(runs)"

mk_root B
: > "$T/calls"; echo 4 > "$T/rc"; CC_AWS_PROFILE=stub STUB_RC_FILE="$T/rc" run B; rc=$?
[ "$rc" = 1 ] && grep -q 'r1 t1: bench exit 4' "$T/log" && [ ! -e "$T/B/claude/runs/r1/t1.done" ] && ok "a failed batch stops the step, not marked done" || bad "fail: rc $rc; $(tail -n 3 "$T/log")"
: > "$T/calls"; CC_AWS_PROFILE=stub run B; rc=$?
nth_run 1 | grep -q -- '--budget-usd 106.50 --out .*/r1/t1 --resume' && [ "$rc" = 0 ] && ok "resume: --resume and the guard takes the earlier USD 2 off" || bad "resume: rc $rc; $(nth_run 1)"

mk_root C
: > "$T/calls"; CC_AWS_PROFILE=stub STUB_USD=108 run C; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 1 ] && grep -q 'stage cap reached before r1 t9: USD 108 spent in stage 1' "$T/log" && ok "stage cap stops before a batch that cannot fit one run" || bad "cap: rc $rc, runs $(runs); $(grep STOP "$T/log")"

mk_root G
: > "$T/calls"; CC_AWS_PROFILE=stub STUB_STAGE_RC=1 run G; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 2 ] && grep -q 'stage 1 is not clean' "$T/log" && ok "stage 2 waits for a clean stage 1" || bad "stage gate: rc $rc, runs $(runs)"

mk_root D 0000000000000000000000000000000000000000
: > "$T/calls"; run D --prepare-only; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && grep -q "is not at the plan's bench commit" "$T/log" && ok "bench worktree off the plan's commit refused" || bad "pin: rc $rc"

: > "$T/calls"; CALLS="$T/calls" S="$HOME/.stdc-should-not-exist-$$" R="$T/R" bash "$SCRIPT" --prepare-only > "$T/log" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q 'is under HOME' "$T/log" && [ ! -e "$HOME/.stdc-should-not-exist-$$" ] && ok "ROOT under HOME refused" || bad "home: rc $rc"

mkdir -p "$T/E/prepare"; printf '{"benchSha":"%s","konductorSha":"kon9","noskillsArm":"konductor-noskills=dir:/var/tmp/y/tree","listArm":"konductor-list=dir:/var/tmp/y/list"}\n' "$SHA" > "$T/E/prepare/plan-preview.json"
: > "$T/calls"; run E --prepare-only; rc=$?
[ "$rc" = 0 ] && grep -q -- '--arms cc-vanilla,cc-konductor=kon9,cc-konductor-noskills=dir:/var/tmp/y/tree,cc-konductor-list=dir:/var/tmp/y/list ' "$T/calls" && ok "dry run works from the prepare-only preview plan" || bad "preview: rc $rc; $(cat "$T/log")"
: > "$T/calls"; CC_AWS_PROFILE=stub run E; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && grep -q 'no .*plan.json: run run-standard.sh first' "$T/log" && ok "paid step refuses a preview plan" || bad "paid on preview: rc $rc; $(tail -n 2 "$T/log")"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
