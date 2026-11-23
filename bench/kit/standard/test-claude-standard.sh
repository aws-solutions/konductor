#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# test-claude-standard.sh: paid-path test for claude-standard.sh with a stub bench and claude: no
# model, no keys, no spend. Checks the --prepare-only dry run, the paid path (arms, caps, --aws-profile, frozen task
# list, done marker), resume with --resume, the cap stop, the missing-profile stop and the bench-pin check.
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
cat > "$T/R/bench/runner/bench.js" <<'JS'
const fs = require('fs'); const path = require('path');
const a = process.argv.slice(2); fs.appendFileSync(process.env.CALLS, a.join(' ') + '\n'); fs.appendFileSync(process.env.CALLS + '.env', `${process.env.TMPDIR}\n`);
if (a[0] === 'run' && !a.includes('--prepare-only')) {
  const out = a[a.indexOf('--out') + 1]; const d = path.join(out, 'cc-vanilla', 't1-a', '1');
  fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(out, 'run-config.json'), '{}\n');
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ costUsd: Number(process.env.STUB_USD || 2) }));
  process.exitCode = Number(process.env.STUB_RC || 0);
}
JS
git -C "$T/R" init -q && git -C "$T/R" add -A && git -C "$T/R" -c user.email=t@t -c user.name=t commit -qm stub
SHA=$(git -C "$T/R" rev-parse HEAD)
printf '#!/bin/sh\nexit 0\n' > "$T/bin/claude"; chmod +x "$T/bin/claude"
mk_root() { mkdir -p "$T/$1"; printf '{"benchSha":"%s","konductorSha":"kon123"}\n' "${2:-$SHA}" > "$T/$1/plan.json"; }
run() { # run ROOTNAME [ARGS...]
  local root=$1; shift
  CALLS="$T/calls" S="$T/$root" R="$T/R" HELPER="$SELF/helper.js" CC_CLAUDE_BIN="$T/bin/claude" HEAVY_LOCK="$T/heavy.lock" \
    HOST_CHECK=0 bash "$SCRIPT" "$@" > "$T/log" 2>&1
}
runs() { grep -c '^run ' "$T/calls" | tr -d ' '; }
# cc-tasks needs a real bench, so the test gives a frozen task list (the paid path reads tasks.txt first)
freeze() { mkdir -p "$T/$1/claude"; echo 't1-a,t2-b' > "$T/$1/claude/tasks.txt"; }

bash -n "$SCRIPT" && ok "bash -n clean" || bad "syntax"

mk_root A; freeze A
: > "$T/calls"; : > "$T/calls.env"; TMPDIR=$HOME run A --prepare-only; rc=$?
[ "$rc" = 0 ] && [ "$(runs)" = 1 ] && grep -q -- '--prepare-only' "$T/calls" && ! grep -q -- '--aws-profile' "$T/calls" && ok "prepare-only: one bench --prepare-only, no profile needed" || { bad "prep: rc $rc"; cat "$T/log"; }
grep -q -- '--tasks t1-a,t2-b --arms cc-vanilla,cc-konductor=kon123 ' "$T/calls" && grep -q -- '--run-budget-usd 1 --budget-usd 30' "$T/calls" && ok "arms from the plan sha; caps USD 1 per run, 30 in all" || bad "args: $(cat "$T/calls")"
[ "$(sort -u "$T/calls.env")" = /tmp ] && ok "bench runs with TMPDIR=/tmp, outside HOME" || bad "TMPDIR: $(sort -u "$T/calls.env")"
[ ! -e "$T/A/claude/runs" ] && ok "prepare-only makes no run dir" || bad "run dir made"

: > "$T/calls"; run A; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && grep -q 'needs CC_AWS_PROFILE' "$T/log" && ok "paid path without a profile stops before bench" || bad "profile: rc $rc"

: > "$T/calls"; CC_AWS_PROFILE=stub run A; rc=$?
[ "$rc" = 0 ] && [ "$(runs)" = 1 ] && grep -q -- '--aws-profile stub --budget-usd 29.00 --out' "$T/calls" && [ -e "$T/A/claude/runs.done" ] && ok "paid path: profile, guard 30 - 0 - 1, done marker" || { bad "paid: rc $rc; $(cat "$T/calls")"; tail -n 5 "$T/log"; }
grep -q 'spend USD 2 of 30' "$T/log" && ok "spend read from result.json costUsd" || bad "spend line: $(grep spend "$T/log")"

: > "$T/calls"; CC_AWS_PROFILE=stub run A; rc=$?
[ "$rc" = 0 ] && [ "$(runs)" = 0 ] && grep -q 'step is done' "$T/log" && ok "rerun after done starts nothing" || bad "done rerun: rc $rc"

mk_root B; freeze B
: > "$T/calls"; CC_AWS_PROFILE=stub STUB_RC=4 run B; rc=$?
[ "$rc" = 1 ] && [ ! -e "$T/B/claude/runs.done" ] && ok "a failed bench run is not marked done" || bad "fail: rc $rc"
: > "$T/calls"; CC_AWS_PROFILE=stub run B; rc=$?
grep -q -- '--resume --aws-profile stub --budget-usd 27.00' "$T/calls" && [ "$rc" = 0 ] && ok "resume: --resume and the guard takes the earlier USD 2 off" || bad "resume: rc $rc; $(cat "$T/calls")"

mk_root C; freeze C
: > "$T/calls"; CC_AWS_PROFILE=stub STUB_USD=28.5 STUB_RC=4 run C
: > "$T/calls"; CC_AWS_PROFILE=stub run C; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && grep -q 'spent USD 28.5 of the USD 30 cap' "$T/log" && ok "cap stop when less than one run's cap is left" || bad "cap: rc $rc; $(tail -n 2 "$T/log")"

mk_root D 0000000000000000000000000000000000000000; freeze D
: > "$T/calls"; run D --prepare-only; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && grep -q "is not at the plan's bench commit" "$T/log" && ok "bench worktree off the plan's commit refused" || bad "pin: rc $rc"

: > "$T/calls"; CALLS="$T/calls" S="$HOME/.stdc-should-not-exist-$$" R="$T/R" bash "$SCRIPT" --prepare-only > "$T/log" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q 'is under HOME' "$T/log" && [ ! -e "$HOME/.stdc-should-not-exist-$$" ] && ok "ROOT under HOME refused" || bad "home: rc $rc"

mkdir -p "$T/E/prepare"; printf '{"benchSha":"%s","konductorSha":"kon9"}\n' "$SHA" > "$T/E/prepare/plan-preview.json"; freeze E
: > "$T/calls"; run E --prepare-only; rc=$?
[ "$rc" = 0 ] && grep -q -- '--arms cc-vanilla,cc-konductor=kon9 ' "$T/calls" && ok "dry run works from the prepare-only preview plan" || bad "preview: rc $rc; $(cat "$T/log")"
: > "$T/calls"; CC_AWS_PROFILE=stub run E; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && ok "paid step refuses a preview plan" || bad "paid on preview: rc $rc"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
