#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# test-run-standard.sh: paid-path test for run-standard.sh with a stub bench, helper and kiro-cli. No model, no keys,
# no spend, private locks, every dir under /var/tmp. Checks the prepare-only dry run, the paid path through both
# stages, the per-stage cap, resume, the ledger check, the stage gate, the HOME guard, the heavy-lock wait, the frozen
# noskills and list-hook hashes and the frozen kit copy. Run by bench/runner/test/kit-standard.test.js.
#
#   bash bench/kit/standard/test-run-standard.sh
set -uo pipefail
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT=$SELF/run-standard.sh
T=$(mktemp -d /var/tmp/std-test.XXXXXX)
trap 'pkill -P "${HOLDER:-0}" 2>/dev/null; kill "${HOLDER:-0}" 2>/dev/null; rm -rf "$T"' EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }

# ---------- stubs
mkdir -p "$T/R/bench/runner" "$T/bin"
cat > "$T/R/bench/runner/bench.js" <<'JS'
const fs = require('fs'); const path = require('path');
const a = process.argv.slice(2); fs.appendFileSync(process.env.CALLS, a.join(' ') + '\n');
const arg = (f) => a[a.indexOf(f) + 1];
if (a[0] === 'cap') {
  const hook = a.includes('--hook');
  const name = hook ? 'konductor-list' : 'konductor-noskills'; const v = hook ? 'v2' : 'v1';
  const hash = hook ? (process.env.STUB_LHASH || 'lhash-one') : (process.env.STUB_VHASH || 'hash-one');
  console.log(JSON.stringify({ armSpec: `${name}=dir:${process.env.T}/variants/${v}/tree`, meta: { variantHash: hash } }));
} else if (a[0] === 'scenarios') {
  console.log('| stub table |');
} else if (a[0] === 'run' && !a.includes('--prepare-only')) {
  const out = arg('--out'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'run-config.json'), '{}\n');
  const e = { credits: Number(process.env.STUB_SPEND || 100) };
  if (process.env.STUB_UNKNOWN === '1') e.unknown = true;
  fs.appendFileSync(path.join(out, 'credit-ledger.jsonl'), JSON.stringify(e) + '\n');
  const rcFile = process.env.STUB_RC_FILE;
  if (rcFile && fs.existsSync(rcFile)) { process.exitCode = Number(fs.readFileSync(rcFile, 'utf8')); fs.unlinkSync(rcFile); }
}
JS
git -C "$T/R" init -q && git -C "$T/R" add -A && git -C "$T/R" -c user.email=t@t -c user.name=t commit -qm stub
SHA=$(git -C "$T/R" rev-parse HEAD)
# helper stub: spent (every credit-ledger.jsonl under DIR), plan, stage, summary
cat > "$T/helper.js" <<'JS'
const fs = require('fs'); const path = require('path');
const [cmd, , ...rest] = process.argv.slice(2);
if (cmd === 'spent') {
  let credits = 0; let unknown = 0;
  const walk = (d) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'credit-ledger.jsonl')
      for (const l of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) { const j = JSON.parse(l); credits += j.credits; if (j.unknown) unknown++; } } };
  walk(rest[0]); console.log(JSON.stringify({ credits, unknown }));
} else if (cmd === 'plan') console.log(JSON.stringify({ level: 'standard', listHash: 'lh', levelIds: ['t1-a', 't9-b', 't1-x'], run: [{ id: 't1-a' }, { id: 't9-b' }],
  skipped: [{ id: 't1-x', why: 'no recheck at v1', needs: 'a recheck' }], batches: { t1: { tasks: ['t1-a'], runLimit: 23 }, t9: { tasks: ['t9-b'], runLimit: 15 } }, expectedPerStage: 120 }));
else if (cmd === 'stage') { console.log('stub stage'); process.exitCode = Number(process.env.STUB_STAGE_RC || 0); }
else if (cmd === 'summary') fs.writeFileSync(rest[0], '| stub summary |\n');
JS
printf '#!/bin/sh\nexit 0\n' > "$T/bin/kiro-cli"; printf '#!/bin/sh\nexit 0\n' > "$T/bin/python3.12"; chmod +x "$T/bin/"*
PIN=$(sha256sum "$T/bin/kiro-cli" | cut -d' ' -f1)

run() { # run STUDYNAME [ARGS...]: the kit with every override pointed at the stubs
  local study=$1; shift
  T="$T" CALLS="$T/calls" R="$T/R" S="$T/$study" REPORTS="$T/reports-$study" HELPER="$T/helper.js" \
    KBIN="$T/bin/kiro-cli" KBIN_PIN="$PIN" PY312="$T/bin/python3.12" KONDUCTOR_SHA="$SHA" \
    BENCH_REF=HEAD NO_FETCH=1 HEAVY_LOCK="$T/heavy.lock" LITE_LOCK="$T/lite.lock" OWN_LOCK="$T/own.lock" \
    WAIT_MAX="${WAIT_MAX:-0}" WAIT_STEP=1 HOST_CHECK=0 bash "${KIT_SCRIPT:-$SCRIPT}" "$@" > "$T/log" 2>&1
}
runs() { grep -c '^run ' "$T/calls" | tr -d ' '; }
nth_run() { grep '^run ' "$T/calls" | sed -n "$1p"; }

bash -n "$SCRIPT" && ok "bash -n clean" || bad "syntax"

# A. prepare-only: noskills built with --verify, one bench --prepare-only, no paid run, nothing frozen
: > "$T/calls"; run A --prepare-only; rc=$?
[ "$rc" = 0 ] && ok "prepare-only exits 0" || { bad "prepare-only exit $rc"; cat "$T/log"; }
grep -q '^cap variant .*--base '"$SHA"' --preset noskills.*--verify' "$T/calls" && ok "prepare-only builds and trial-installs noskills" || bad "no noskills --verify build: $(cat "$T/calls")"
grep -q '^cap variant .*--base '"$SHA"' --hook list.*--verify' "$T/calls" && ok "prepare-only builds and trial-installs the list-hook arm" || bad "no list --verify build: $(cat "$T/calls")"
grep -q '^run .*--prepare-only' "$T/calls" && [ "$(grep '^run ' "$T/calls" | grep -vc -- --prepare-only)" = 0 ] && ok "prepare-only starts no paid run" || bad "prepare-only calls: $(cat "$T/calls")"
grep -q -- "--arms vanilla,konductor=$SHA,konductor-noskills=dir:$T/variants/v1/tree,konductor-list=dir:$T/variants/v2/tree " "$T/calls" && ok "four arms passed" || bad "arms: $(grep '^run' "$T/calls")"
[ ! -e "$T/A/plan.json" ] && [ -s "$T/A/prepare/plan-preview.json" ] && [ ! -e "$T/A/runs" ] && [ ! -e "$T/A/kit" ] && ok "preview plan only; no frozen plan, kit or runs" || bad "prepare-only left: $(ls "$T/A")"
grep -q 't1-x: no recheck at v1' "$T/log" && ok "skipped tasks listed with their reason" || bad "no skipped list"

# B. paid path, 100 credits per batch: both stages, budgets off the stage cap, done markers, kit frozen, tables copied
: > "$T/calls"; run B --foreground; rc=$?
[ "$rc" = 0 ] && grep -q 'all units finished' "$T/log" && ok "paid path finishes both stages" || { bad "paid exit $rc"; tail -n 20 "$T/log"; }
grep -q "kit $T/B/kit" "$T/log" && [ -f "$T/B/kit/run-standard.sh" ] && ok "paid start freezes the kit and runs the copy" || bad "kit copy: $(grep 'run-standard.sh' "$T/log")"
[ "$(runs)" = 4 ] && ok "4 bench runs (2 batches x 2 stages)" || bad "bench runs: $(runs)"
nth_run 1 | grep -q -- '--replicate-offset 0 --budget-credits 1075 --run-credit-limit 23' && ok "stage 1 first batch: budget 1100 - 0 - 25" || bad "first run: $(nth_run 1)"
nth_run 2 | grep -q -- '--budget-credits 975 --run-credit-limit 15' && ok "second batch budget takes the stage's spend off" || bad "second run: $(nth_run 2)"
nth_run 3 | grep -q -- '--replicate-offset 1 --budget-credits 1075' && ok "stage 2 has its own cap" || bad "third run: $(nth_run 3)"
[ "$(ls "$T"/B/runs/r*/*.done | wc -l)" = 4 ] && ok "4 done markers" || bad "done markers: $(ls "$T"/B/runs/r*/)"
[ -s "$T/B/plan.json" ] && [ -s "$T/reports-B/plan.json" ] && [ -s "$T/reports-B/code-gap.md" ] && ok "plan frozen; tables and plan copied to REPORTS" || bad "reports: $(ls "$T/reports-B")"
grep -q '^cap variant' "$T/calls" && ! grep -q '^cap variant.*--verify' "$T/calls" && ok "paid path rebuilds noskills without a trial install" || bad "paid cap variant: $(grep '^cap' "$T/calls")"

# C. rerun: everything done, no new bench run
: > "$T/calls"; run B --foreground; rc=$?
[ "$rc" = 0 ] && [ "$(runs)" = 0 ] && grep -q 'resuming the frozen plan' "$T/log" && grep -q 'r2 t9: done, skipped' "$T/log" && ok "rerun resumes the plan and skips done batches" || bad "rerun: rc $rc, runs $(runs)"

# C2. STAGES=3: a third replicate with its own cap (the full design of the run plan)
: > "$T/calls"; STAGES=3 run C2 --foreground; rc=$?
[ "$rc" = 0 ] && [ "$(runs)" = 6 ] && nth_run 5 | grep -q -- '--replicate-offset 2 --budget-credits 1075' && ok "STAGES=3 runs a third stage with its own cap" || bad "STAGES=3: rc $rc, runs $(runs); $(nth_run 5)"

# D. stage cap: 1070 credits in the first batch leaves 5 < run limit 15, so t9 and stage 2 never start
: > "$T/calls"; STUB_SPEND=1070 run D --foreground; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 1 ] && grep -q 'stage cap reached before r1 t9: 1070 real credits' "$T/log" && ok "stage cap stops before a batch it cannot cover" || bad "cap: rc $rc, runs $(runs); $(grep -E 'STOP|cap' "$T/log")"

# E. a failed batch resumes with --resume on the rerun
: > "$T/calls"; echo 4 > "$T/rc"; STUB_RC_FILE="$T/rc" run E --foreground; rc=$?
[ "$rc" = 1 ] && grep -q 'r1 t1: bench exit 4' "$T/log" && [ ! -e "$T/E/runs/r1/t1.done" ] && ok "a failed batch stops the run, not marked done" || bad "fail: rc $rc; $(tail -n 3 "$T/log")"
: > "$T/calls"; run E --foreground; rc=$?
nth_run 1 | grep -q -- '--out '"$T"'/E/runs/r1/t1 --resume' && [ "$rc" = 0 ] && ok "rerun resumes the failed batch with --resume" || bad "resume: rc $rc; $(sed -n 1,3p "$T/calls")"

# F. a ledger entry of unknown cost stops the next batch
: > "$T/calls"; STUB_UNKNOWN=1 run F --foreground; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 1 ] && grep -q 'unknown cost before r1 t9' "$T/log" && ok "ledger check stops on an unknown-cost entry" || bad "ledger: rc $rc, runs $(runs)"

# G. an unclean stage 1 blocks stage 2
: > "$T/calls"; STUB_STAGE_RC=1 run G --foreground; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 2 ] && grep -q 'stage 1 is not clean' "$T/log" && ok "stage 2 waits for a clean stage 1" || bad "stage gate: rc $rc, runs $(runs)"

# H. a study dir under HOME is refused before anything is made
: > "$T/calls"; SH_HOME="$HOME/.std-test-should-not-exist-$$"
CALLS="$T/calls" R="$T/R" S="$SH_HOME" bash "$SCRIPT" --prepare-only > "$T/log" 2>&1; rc=$?
[ "$rc" = 1 ] && [ ! -e "$SH_HOME" ] && grep -q 'is under HOME' "$T/log" && [ ! -s "$T/calls" ] && ok "study dir under HOME refused" || bad "HOME guard: rc $rc; $(cat "$T/log")"
CALLS="$T/calls" bash "$SCRIPT" --prepare-only > "$T/log" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q 'set S, the study dir' "$T/log" && ok "no S: refused with the reason" || bad "no S: rc $rc"

# I. a held heavy lock: waits, then stops with its reason and starts nothing
: > "$T/calls"; flock -x "$T/heavy.lock" sleep 60 & HOLDER=$!; sleep 0.3
WAIT_MAX=2 run I --foreground; rc=$?
pkill -P "$HOLDER" 2>/dev/null; kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && grep -q 'waiting: the heavy lock' "$T/log" && grep -q 'STOP: the heavy lock .* is held for 2s' "$T/log" && ok "heavy lock held: waits, then stops" || bad "heavy lock: rc $rc; $(cat "$T/log")"

# J. a noskills tree that changed since the plan was frozen is refused
: > "$T/calls"; STUB_VHASH=hash-two run B --foreground; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && grep -q 'noskills arm hash .* differs from the frozen plan' "$T/log" && ok "changed noskills hash refused" || bad "hash: rc $rc; $(tail -n 3 "$T/log")"
: > "$T/calls"; STUB_LHASH=lhash-two run B --foreground; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && grep -q 'list arm hash .* differs from the frozen plan' "$T/log" && ok "changed list-hook hash refused" || bad "list hash: rc $rc; $(tail -n 3 "$T/log")"

# K. a kit that differs from the study's frozen kit is refused; the frozen copy itself still runs
cp -a -- "$SELF" "$T/newkit" && echo '# a later edit' >> "$T/newkit/helper.js"
: > "$T/calls"; KIT_SCRIPT="$T/newkit/run-standard.sh" run B --foreground; rc=$?
[ "$rc" = 1 ] && [ "$(runs)" = 0 ] && grep -q 'is the frozen kit of this study and differs' "$T/log" && ok "a changed kit is refused for a frozen study" || bad "kit differ: rc $rc; $(tail -n 2 "$T/log")"
: > "$T/calls"; KIT_SCRIPT="$T/B/kit/run-standard.sh" run B --foreground; rc=$?
[ "$rc" = 0 ] && ok "the frozen kit copy resumes the study" || bad "frozen copy: rc $rc; $(tail -n 2 "$T/log")"

# L. the kit refuses to run from inside R, whose pin it moves
mkdir -p "$T/R/kitcopy" && cp -a -- "$SELF/." "$T/R/kitcopy/"
: > "$T/calls"; KIT_SCRIPT="$T/R/kitcopy/run-standard.sh" run L --prepare-only; rc=$?
rm -r -- "$T/R/kitcopy"
[ "$rc" = 1 ] && [ ! -s "$T/calls" ] && grep -q 'runs from inside R' "$T/log" && ok "kit inside R refused" || bad "inside R: rc $rc; $(cat "$T/log")"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
