#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# FW-38: the A/A run on the LITE pack. vanilla twice on the 8 tasks of run-forced-aa-r2.sh: set a (replicates 1-3)
# and set b (replicates 4-6), one bench command per set into runs-aa-pack/a and runs-aa-pack/b: 48 runs, hard cap 300
# credits. Two sets of one arm, because the frozen bench 69149846 predates the vanilla-b=vanilla repeat arm (77c63b93);
# one dir per set, so `bench compare --base a --head b --aa vanilla` reads them as the A/A pair. Same frozen bench,
# kiro-cli, model, effort, engine, seed and isolation as the forced runs. The per-run limit is the largest of the 8
# tasks (68, t6): a run over it is flagged, not stopped (D-67). Judge it in one pass with run-aa-pack-judge.sh.
# A finished set has runs-aa-pack/<set>.done and is skipped; an unfinished one resumes (bench run --resume).
#
#   sh run-aa-pack.sh          dry run: each set's budget and worst case, at the expected spend so far; no call
#   sh run-aa-pack.sh --go     PAID run (needs the owner's approval: cap 300 credits). Waits for any other paid run.
#
# Test hooks: STUB=<cmd> replaces the paid bench command and skips the user-namespace check; HERE=<dir> points at a
# copy of this folder; WAIT_PAT=<pattern> is the process pattern of the runs to wait for; LOAD_MAX=<n> is the load a
# set waits under (default 4); HEAVY_LOCK=<file> is the heavy lock a set waits for.
# shortcut: the host checks are run-forced-small.sh's; the shared steps move to one lib with FW-22.
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203      # plan.json benchSha of reports/lite-run-2026-11-21
R=$WS/worktrees/lite-frozen-69149846                    # read only; never worktrees/pilot
HERE=${HERE:-$WS/reports/next-experiment-2026-11-22}
OUT=$HERE/runs-aa-pack
KBIN=/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli
KBIN_PIN=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
CACHE=/var/tmp/lite-konductor-cache
PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
GO=${1:-}
STUB=${STUB:-}
WAIT_PAT=${WAIT_PAT:-run-forced-aa|run-forced-small[.]sh|run-nudge[.]sh|run-pilot-(author|run|rerun)[.]sh|run-fw30-rewrite[.]sh}
LOAD_MAX=${LOAD_MAX:-4}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
CAP=300
REPS=3
SET_BUDGET=150                                           # 24 runs at about 5 credits; cut by the cap guard
LIMIT=68                                                 # the largest per-run limit of the 8 tasks (t6)
# The dry run carries this expected spend from set a to set b (24 runs at about 5 credits). Carrying set a's worst case
# (0.9 x 150 + 68 = 203) would leave set b no room on paper, though the guard before set b checks real spend.
EXPECT_PER_SET=${EXPECT_PER_SET:-120}
# The 8 tasks of run-forced-aa-r2.sh and their batch folders (--extra-tasks).
TASK_IDS=t8-dec-deploy-strategy,t5-qa-checkout-strategy,t5-qa-sync-strategy,t6-req-field-inspections,t2-dr-notify-fanout,t2-arch-dr-split-checkout,t7-program-brief,t1-nfr-report-queries
BATCHES='t8 t5 t6 t2 t7 t1'
stop() { echo "stop: $*" >&2; exit 1; }
case "$GO" in ''|--go) ;; *) echo "usage: sh run-aa-pack.sh [--go]" >&2; exit 64 ;; esac

[ -e "$R" ] || stop "$R is missing (run-forced-aa-r2.sh creates it)"
[ "$(git -C "$R" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$R is not at $BENCH_SHA"
[ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes"
[ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "$KBIN_PIN" ] || stop "$KBIN is not the pinned kiro-cli 3.5.0"
[ -n "$PY312" ] || stop "no python 3.12"
if [ "$GO" = --go ] && [ -z "$STUB" ]; then
  unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them): run from your own terminal"
fi

# Spend so far: the ledgers of both set dirs.
spent_all() {
  node -e 'const {readLedger}=require(process.argv[1]); const fs=require("fs"), p=require("path"); const d=process.argv[2];
    let s=0; for (const set of ["a","b"]) if (fs.existsSync(p.join(d,set))) s+=readLedger(p.join(d,set)).totals.total; console.log(s.toFixed(2))' \
    "$R/bench/runner/lib/credit-ledger.js" "$OUT"
}

# Budget for one set, as in run-forced-small.sh: a command can spend up to 0.9 x budget + one run's limit. The budget
# is max(own budget, limit), cut so that spent + 0.9 x budget + limit <= CAP. Prints STOP when even one run would not fit.
budget_for() {
  bs=$1; bl=$2; bb=$3
  awk -v s="$bs" -v c="$CAP" -v l="$bl" -v b="$bb" 'BEGIN { if (b < l) b = l; m = (c - s - l) / 0.9; if (m < b) b = m;
    if (b < l) print "STOP"; else printf "%d", b }'
}
worst_case() { awk -v s="$1" -v b="$2" -v l="$3" 'BEGIN { printf "%.2f", s + 0.9 * b + l }'; }

# Wait (up to 24 h) until no other paid run of this host is running.
wait_others() {
  i=0; pids=''
  while :; do
    pids=$(pgrep -f "$WAIT_PAT" | grep -v "^$$\$" || true)
    [ -z "$pids" ] && return 0
    [ "$GO" = --go ] || { echo "another run is still running (pid $pids); --go waits for it"; return 0; }
    [ "$i" = 0 ] && echo "[$(date -u +%H:%M)] waiting for pid $pids"
    i=$((i + 1)); [ "$i" -le 288 ] || stop "still running after 24 h: $pids"
    sleep 300
  done
}

# Wait (up to 60 min) for load under LOAD_MAX and a free heavy lock before a task starts.
wait_host() {
  i=0; l=''
  while :; do
    l=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$l" -v m="$LOAD_MAX" 'BEGIN { exit !(l < m) }' && flock -n "$HEAVY_LOCK" true; then return 0; fi
    i=$((i + 1)); [ "$i" -le 60 ] || stop "load $l or heavy lock busy for 60 min"
    sleep 60
  done
}

# Runs (or with no --go, prints) one set. Args: set offset. The dry run carries the expected spend between sets.
run_set() {
  set=$1; offset=$2; s=0; after=0; dir=$OUT/$1; extra=''; resume=''
  [ -e "$dir.done" ] && { echo "set $set: done, skipped"; return 0; }
  [ -e "$dir" ] && resume=--resume
  if [ "$GO" = --go ]; then wait_host; s=$(spent_all); else s=$DRY_SPENT; fi
  budget=$(budget_for "$s" "$LIMIT" "$SET_BUDGET")
  [ "$budget" = STOP ] && stop "spent $s of $CAP: set $set cannot fit one run of $LIMIT"
  after=$(worst_case "$s" "$budget" "$LIMIT")
  if [ "$GO" = --go ]; then echo "[$(date -u +%H:%M)] set $set: spent $s of $CAP, budget $budget, limit $LIMIT, worst case after $after${resume:+, resuming}"
  else printf '| %s | %s | %s | %s | %s |\n' "$set" "$LIMIT" "$budget" "$s" "$after"; fi
  for b in $BATCHES; do extra=${extra:+$extra,}$R/bench/scenarios/$b; done
  set -- node "$R/bench/runner/bench.js" run --suite pilot --tasks "$TASK_IDS" --arms vanilla \
    --replicates "$REPS" --replicate-offset "$offset" --parallel 1 --extra-tasks "$extra" --repo-root "$R" --hide "$R" \
    --isolate unshare --seed 20261121 --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" \
    --python "$PY312" --cache "$CACHE" --budget-credits "$budget" --run-credit-limit "$LIMIT" --out "$dir" $resume
  if [ "$GO" = --go ]; then
    mkdir -p "$OUT"
    if [ -n "$STUB" ]; then $STUB "$@" </dev/null || stop "set $set stub exited $?"
    else nice -n 10 "$@" </dev/null || stop "set $set exited $?; the same command resumes it"; fi
    touch "$dir.done"
  else
    DRY_LAST="$*"
    DRY_SPENT=$(awk -v s="$s" -v e="$EXPECT_PER_SET" 'BEGIN { printf "%.2f", s + e }')
  fi
}

wait_others
DRY_SPENT=$(spent_all)
DRY_LAST=''
[ "$GO" = --go ] || { echo '| set | run limit | budget | spent before (expected) | worst case after this set |'; echo '| --- | --- | --- | --- | --- |'; }
run_set a 0
run_set b "$REPS"
if [ "$GO" = --go ]; then echo "[$(date -u +%H:%M)] both sets done, spent $(spent_all) of $CAP; next: bash run-aa-pack-judge.sh --plan"
else echo; echo "expected total: $DRY_SPENT of $CAP credits ($EXPECT_PER_SET a set); before each set the guard checks real spend plus that set's worst case against $CAP"; echo "last command: $DRY_LAST"; fi
