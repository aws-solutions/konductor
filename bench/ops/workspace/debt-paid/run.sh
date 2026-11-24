#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# The paid debt jobs of reports/debt-paid-runs-2026-11-24.md (D-132, D-167, D-123, D-159, D-137): one kiro-cli call
# at a time from jobs.txt, each in an empty HOME made by the bench's own sandbox helpers, on a bundle built from a
# pinned checkout. Owner terminal only. The five run-debt-*.sh scripts next to this folder each run one job.
#
#   bash run.sh JOB [--plan]   free: builds every call's prompt and bundle, checks the families, prints the calls,
#                              the counted floor and the cap; no model call, no ledger line, no pin
#   bash run.sh JOB --go       PAID (Kiro credits): runs the job's calls in order; rerun to resume (finished calls
#                              are skipped); touch STATE/STOP to stop before the next call
#
# Spend: every call counts as max(15, its real credits) against the job's cap in jobs.txt. A call starts only when
# the ledger leaves room for one more counted call (spent + 15 <= cap); its counted figure is written after it. No
# retry: a call that leaves no result is counted and stops the job. --go refuses to start, and stops before a call,
# while another paid job runs (PAID_PAT: a pilot, wave, study, fill, recheck queue or batch kiro-cli call), while
# another debt-paid run holds JOB_LOCK, while the heavy lock is held or while the load is 4 or more.
# Families: no Claude model; a recheck's family differs from its writer's. The results are a worker's to apply
# (free): a map is compared with the task's targets and changes one only on the owner's yes; a rewrite or a new task
# goes into the pack with its version bumped, its free gates run and the recheck recorded in review.recheck.
#
# State: STATE (ledger, pin, results; default <workspace>/reports/debt-paid/JOB) and WORK (call dirs and HOMEs;
# default /var/tmp/konductor-debt-paid/JOB, outside HOME so the call loads no workspace steering).
# Test hooks: ROOT (both STATE and WORK), JOBS, PIN_REPO, PIN_CLEAN=0, KIRO, PAID_PAT, JOB_LOCK, HEAVY_LOCK,
# HOST_CHECK=0 (skip the load check). Test: test-run.sh.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WS=$KONDUCTOR_WS
JOB=${1:-}
MODE=${2:---plan}
JOBS=${JOBS:-$HERE/jobs.txt}
PIN_REPO=${PIN_REPO:-$WS/worktrees/debt-paid}
KIRO=${KIRO:-kiro-cli}
STATE=${ROOT:-$WS/reports/debt-paid/$JOB}
WORK=${ROOT:-/var/tmp/konductor-debt-paid/$JOB}
LEDGER=$STATE/ledger
JOB_LOCK=${JOB_LOCK:-/var/tmp/konductor-debt-paid.lock}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
PAID_PAT=${PAID_PAT:-run-overnight[.]sh|run-clean-fill[.]sh|run-cc-[a-z-]*[.]sh|run-model-swap|run-nudge|run-forced|run-aa-pack|run-pilot|run-fw30|pilot-wave[.]sh|plant-wave[.]sh|standard-recheck/run[.]sh|run-rest[.]sh|bench/runner/bench[.]js run|kiro-cli chat --no-interactive}
COUNT_MIN=15
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }
prep() { BENCH_REPO=$PIN_REPO node "$HERE/prep.js" "$@"; }
spent() { touch "$LEDGER"; awk '{ s += $3 } END { printf "%g", s + 0 }' "$LEDGER"; }
calls_of() { awk -v j="$JOB" '$1 == j' "$JOBS"; }

# Why a paid call may not start now, or nothing.
busy() {
  pgrep -f "$PAID_PAT" >/dev/null && { echo "another paid job runs ($(pgrep -af "$PAID_PAT" | head -n 1 | cut -c1-80))"; return 0; }
  flock -n "$HEAVY_LOCK" true 2>/dev/null || { echo "the heavy lock $HEAVY_LOCK is held"; return 0; }
  [ "${HOST_CHECK:-1}" = 0 ] && return 1
  awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN { exit !(l >= 4) }' && { echo "the load is 4 or more"; return 0; }
  return 1
}

# Family checks of one call line; prints nothing and returns 0 when it may run.
check_line() {
  local name=$1 kind=$2 model=$3 from=$4 wmodel
  case "$model" in *claude*|*anthropic*) stop "$name uses a Claude family ($model)" ;; esac
  case "$kind" in map|write|recheck) ;; *) stop "$name: unknown kind $kind" ;; esac
  if [ "$kind" = recheck ] && [ "$from" != - ]; then
    wmodel=$(calls_of | awk -v n="$from" '$2 == n { print $4 }')
    [ -n "$wmodel" ] || stop "$name rechecks $from, which is not a call of $JOB"
    [ "$(prep family "$model")" != "$(prep family "$wmodel")" ] || stop "$name rechecks $from with the writer's own family ($model)"
  fi
}

# call NAME KIND MODEL FROM ID...: one paid call. Returns 3 when the job must stop.
call() {
  local name=$1 kind=$2 model=$3 from=$4 w h prompt real counted rc=0 out
  shift 4
  w=$WORK/calls/$name
  awk -v s="$(spent)" -v c="$CAP" -v m="$COUNT_MIN" 'BEGIN { exit !(s + m > c) }' && { say "REFUSED $name: spent $(spent) of the $CAP cap leaves no room for a counted call"; return 3; }
  local why; why=$(busy) && { say "STOP: $why; rerun later (it resumes)"; return 3; }
  rm -rf -- "$w"; mkdir -p "$w/work" "$STATE/results"
  prompt=$(FROM=$([ "$from" = - ] || echo "$STATE/results/$from") prep prompt "$kind" "$JOB" "$name" "$w/work" "$@") || { say "prompt or bundle failed for $name"; return 3; }
  h=$(mktemp -d "$WORK/home.XXXXXX")
  BENCH_REPO=$PIN_REPO node "$HERE/../standard-recheck/rc-home.js" make "$h" || { say "cannot make an isolated HOME for $name"; return 3; }
  say "start $name $kind $model: $*"
  (cd "$w/work" && HOME=$h TMPDIR=$h timeout 2400 nice -n 19 "$KIRO" chat --no-interactive --trust-all-tools --model "$model" \
    --output-format stream-json "$prompt" < /dev/null > "$w/call.out" 2> "$w/call.err") || rc=$?
  BENCH_REPO=$PIN_REPO node "$HERE/../standard-recheck/rc-home.js" clean "$h"
  real=$(prep credits "$w/call.out")
  counted=$(awk -v r="$real" -v m="$COUNT_MIN" 'BEGIN { if (r == "NaN" || r + 0 < m) print m; else print r + 0 }')
  echo "$name $model $counted real=$real rc=$rc $(date -u +%FT%TZ)" >> "$LEDGER"
  out=$STATE/results/$name; [ "$kind" = write ] || out=$out.json
  if prep result "$kind" "$w/call.out" "$w/work" "$out"; then say "ok $name: counted $counted (real $real)"
  else say "NORESULT $name (exit $rc, see $w/call.err); the job stops, no retry"; return 3; fi
}

main() {
  local name kind model from ids n=0 pin rc=0 _j
  [ -n "$JOB" ] || { echo "usage: bash $0 JOB [--plan|--go] (JOB: $(awk '$1 == "cap" { printf "%s ", $2 }' "$JOBS"))"; exit 64; }
  case "$MODE" in --plan|--go) ;; *) echo "usage: bash $0 JOB [--plan|--go]"; exit 64 ;; esac
  CAP=$(awk -v j="$JOB" '$1 == "cap" && $2 == j { print $3 }' "$JOBS")
  [ -n "$CAP" ] || stop "no job $JOB in $JOBS"
  [ -n "$(calls_of)" ] || stop "job $JOB has no calls"
  if [ ! -e "$PIN_REPO/.git" ]; then
    git -C "$WS/worktrees/ops" fetch -q origin feat/bench-pilot-nk || stop "fetch failed"
    git -C "$WS/worktrees/ops" worktree add -q --detach "$PIN_REPO" origin/feat/bench-pilot-nk || stop "cannot add $PIN_REPO"
  fi
  [ "${PIN_CLEAN:-1}" = 0 ] || [ -z "$(git -C "$PIN_REPO" status --porcelain)" ] || stop "$PIN_REPO has local changes"
  pin=$(git -C "$PIN_REPO" rev-parse HEAD)
  mkdir -p "$STATE" "$WORK"
  if [ -s "$STATE/pin.txt" ] && [ "$(cat "$STATE/pin.txt")" != "$pin" ]; then
    if [ "$(spent)" = 0 ]; then echo "$pin" > "$STATE/pin.txt"; say "re-pinned to ${pin:0:8}: nothing spent yet"
    else stop "$PIN_REPO is at ${pin:0:8}, not the job's pin $(cut -c1-8 "$STATE/pin.txt"): check it out there, or start a new STATE"; fi
  fi
  say "job $JOB: pin ${pin:0:8}; cap $CAP counted ($COUNT_MIN per call at least); spent so far $(spent)"
  while read -r _j name kind model from ids; do check_line "$name" "$kind" "$model" "$from"; n=$((n + 1)); done <<EOF
$(calls_of)
EOF
  if [ "$MODE" = --plan ]; then
    mkdir -p "$WORK/plan"
    while read -r _j name kind model from ids; do
      if [ "$kind" = recheck ] && [ "$from" != - ]; then
        say "would call $name recheck on $model ($(prep family "$model")): $ids, reading $from's files; counted 15 or more"
        continue
      fi
      # shellcheck disable=SC2086
      prep prompt "$kind" "$JOB" "$name" "$WORK/plan/$name" $ids > "$WORK/plan/$name.prompt" 2> "$WORK/plan/$name.err" \
        || stop "the prompt or bundle of $name does not build (see $WORK/plan/$name.err)"
      say "would call $name $kind on $model ($(prep family "$model")): $ids; prompt $(wc -c < "$WORK/plan/$name.prompt") bytes; counted 15 or more"
    done <<EOF
$(calls_of)
EOF
    awk -v n="$n" -v m="$COUNT_MIN" -v c="$CAP" 'BEGIN { exit !(n * m > c) }' && stop "$n calls at $COUNT_MIN each pass the $CAP cap"
    say "plan: $n calls, at least $((n * COUNT_MIN)) counted of the $CAP cap; no model call made. Paid: bash $0 $JOB --go"
    [ "$((n * COUNT_MIN))" = "$CAP" ] && say "note: the cap leaves no room above 15 a call; a call that costs more stops the job before its last call (raise the cap only with the owner's approval)"
    why=$(busy) && say "now: $why, so --go would refuse"
    return 0
  fi
  exec 9> "$JOB_LOCK"
  flock -n 9 || stop "another debt-paid run holds $JOB_LOCK"
  why=$(busy) && stop "$why; nothing started"
  "$KIRO" whoami >/dev/null 2>&1 || stop "kiro-cli is not signed in: run '$KIRO login', then this script again"
  [ -s "$STATE/pin.txt" ] || echo "$pin" > "$STATE/pin.txt"
  while read -r _j name kind model from ids; do
    [ -f "$STATE/STOP" ] && { say "STOP file: stopped before $name"; break; }
    [ -e "$STATE/results/$name" ] || [ -e "$STATE/results/$name.json" ] && { say "$name: done, skipped"; continue; }
    # shellcheck disable=SC2086
    call "$name" "$kind" "$model" "$from" $ids || { rc=1; break; }
  done <<EOF
$(calls_of)
EOF
  say "spent $(spent) counted of $CAP; results in $STATE/results"
  return "$rc"
}
main
