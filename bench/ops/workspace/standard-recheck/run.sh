#!/usr/bin/env bash
# STANDARD gate rechecks: one non-Claude recheck of the current version of each of the 22 DEV tasks the STANDARD
# gate skips (13 with no recheck, 9 hand-edited past their recheck; the ninth is t2-dr-notify-fanout-v6, whose key was
# rewritten on 2026-11-24). Owner terminal only: PAID (Kiro credits).
#
#   bash run.sh --dry-run    free: builds every call's bundle from the pinned bench commit, checks the queue, prints
#                            the calls, families and the counted cap; no model call, no ledger line, no pin
#   bash run.sh              the paid queue, one call at a time; rerun to resume (finished calls are skipped)
#
# Queue (queue.txt): 8 calls of 2 or 3 tasks, each by a non-Claude family (deepseek-3.2, qwen3-coder-next, glm-5,
# gpt-5.6-luna; S4 is gpt-5.6-luna, the family whose v5 fails the t3 fix answers). Every call counts as
# max(15, its real credits) against CAP (120 = 8 x 15). Before each call the ledger must leave room for one more
# counted call (spent + 15 <= CAP), else the queue stops; the counted figure is written after the call. No retry: a
# call with no recheck.json is logged NOJSON and the queue stops. Touch $S/STOP to stop before the next call.
# Each call runs kiro-cli in an empty HOME made by the bench's own sandbox helpers, on a bundle built from a detached
# worktree pinned at the first paid start (pin.txt). While nothing is spent, the pin follows the worktree's head, so a
# task edited after a dry run is rechecked at the content STANDARD will run. Never beside a pilot, a forced-small run
# or a held heavy lock. The results go to $S/results/<call>.json; applying them to review.recheck is a separate free
# step for a worker.
#
# Overrides (env, for test-run.sh): S, PIN_REPO, KIRO, CAP, LEDGER, HEAVY_LOCK, HOST_CHECK, WAIT_MAX.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WS=$KONDUCTOR_WS
S=${S:-/var/tmp/konductor-standard-recheck}
PIN_REPO=${PIN_REPO:-$WS/worktrees/recheck-std}
KIRO=${KIRO:-kiro-cli}
CAP=${CAP:-120}
COUNT_MIN=15
LEDGER=${LEDGER:-$WS/reports/standard-recheck-2026-11-23.ledger}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
WAIT_MAX=${WAIT_MAX:-3600}
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }

spent() { touch "$LEDGER"; awk '{ s += $3 } END { printf "%g", s + 0 }' "$LEDGER"; }
busy() {
  flock -n "$HEAVY_LOCK" true 2>/dev/null || { echo "the heavy lock $HEAVY_LOCK is held"; return 0; }
  [ "${HOST_CHECK:-1}" = 0 ] && return 1
  pgrep -f 'run-pilot|run-forced|pilot-wave[.]sh|bench/runner/bench[.]js run' >/dev/null && { echo "a pilot, forced-small or bench run is running"; return 0; }
  awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN { exit !(l >= 4) }' && { echo "load is 4 or more"; return 0; }
  return 1
}
wait_quiet() {
  local waited=0 why=""
  while why=$(busy); do
    [ "$waited" -lt "$WAIT_MAX" ] || stop "$why for ${waited}s; rerun later (it resumes)"
    say "waiting: $why"; sleep 30; waited=$((waited + 30))
  done
}

# call NAME MODEL ID...: one paid recheck call. Returns 3 when the queue must stop.
call() {
  local name=$1 model=$2 w=$S/calls/$1 left real counted rc=0 h
  shift 2
  left=$(awk -v s="$(spent)" -v c="$CAP" -v m="$COUNT_MIN" 'BEGIN { print (s + m > c) ? "no" : "yes" }')
  [ "$left" = yes ] || { say "REFUSED $name: spent $(spent) of the $CAP cap leaves no room for a counted call"; return 3; }
  wait_quiet
  mkdir -p "$w/work" "$S/results"
  BENCH_REPO=$PIN_REPO node "$HERE/bundle.js" "$w/work" "$@" > "$w/bundle.log" 2>&1 || { say "bundle failed for $name (see $w/bundle.log)"; return 3; }
  h=$(mktemp -d "$S/home.XXXXXX")
  BENCH_REPO=$PIN_REPO node "$HERE/rc-home.js" make "$h" || { say "cannot make an isolated HOME for $name"; return 3; }
  say "start $name $model: $*"
  (cd "$w/work" && HOME=$h TMPDIR=$h timeout 1200 nice -n 19 "$KIRO" chat --no-interactive --trust-all-tools --model "$model" \
    --output-format stream-json "$(cat "$HERE/prompt.md")" < /dev/null > "$w/call.out" 2> "$w/call.err") || rc=$?
  BENCH_REPO=$PIN_REPO node "$HERE/rc-home.js" clean "$h"
  real=$(BENCH_REPO=$PIN_REPO node -e 'const s=require(process.env.BENCH_REPO+"/bench/scenarios/lib/stage.js");try{console.log(s.streamInfo(process.argv[1]).credits.toFixed(3))}catch(e){console.log("NaN")}' "$w/call.out")
  counted=$(awk -v r="$real" -v m="$COUNT_MIN" 'BEGIN { if (r == "NaN" || r + 0 < m) print m; else print r }')
  echo "$name $model $counted real=$real rc=$rc $(date -u +%FT%TZ)" >> "$LEDGER"
  # the model sometimes writes it under tasks/; a misplaced file still counts
  [ -f "$w/work/recheck.json" ] || [ ! -f "$w/work/tasks/recheck.json" ] || mv -- "$w/work/tasks/recheck.json" "$w/work/recheck.json"
  if [ -f "$w/work/recheck.json" ]; then cp -- "$w/work/recheck.json" "$S/results/$name.json"; say "ok $name: counted $counted (real $real)"
  else say "NOJSON $name (exit $rc, see $w/call.err); the queue stops, no retry"; return 3; fi
  return 0
}

main() {
  local dry=0 name model ids pin n=0 rc=0
  case "${1:-}" in '') ;; --dry-run) dry=1 ;; *) echo "usage: bash $0 [--dry-run]"; exit 64 ;; esac
  mkdir -p "$S"
  if [ ! -e "$PIN_REPO/.git" ]; then
    git -C "$WS/worktrees/konductor-debt5" fetch -q origin feat/bench-pilot-nk || stop "fetch failed"
    git -C "$WS/worktrees/konductor-debt5" worktree add -q --detach "$PIN_REPO" origin/feat/bench-pilot-nk || stop "cannot add $PIN_REPO"
  fi
  pin=$(git -C "$PIN_REPO" rev-parse HEAD)
  if [ -s "$S/pin.txt" ] && [ "$(cat "$S/pin.txt")" != "$pin" ]; then
    if [ "$(spent)" = 0 ] && [ -z "$(ls -A "$S/results" 2>/dev/null)" ]; then
      say "re-pinned: nothing spent, the queue's pin $(cut -c1-8 "$S/pin.txt") moves to ${pin:0:8}"; echo "$pin" > "$S/pin.txt"
    else stop "$PIN_REPO is at ${pin:0:8}, not the queue's pin $(cut -c1-8 "$S/pin.txt")"; fi
  fi
  [ "$dry" = 1 ] || [ -s "$S/pin.txt" ] || echo "$pin" > "$S/pin.txt"
  [ -z "$(git -C "$PIN_REPO" status --porcelain)" ] || stop "$PIN_REPO has local changes"
  say "pin ${pin:0:8}; cap $CAP counted ($COUNT_MIN per call minimum); spent so far $(spent)"
  if [ "$dry" = 1 ]; then
    while read -r name model ids; do
      [ -n "$name" ] || continue
      n=$((n + 1))
      case "$model" in *claude*|*anthropic*) stop "$name uses a Claude family ($model)" ;; esac
      # shellcheck disable=SC2086
      BENCH_REPO=$PIN_REPO node "$HERE/bundle.js" "$S/dry/$name" $ids > /dev/null || stop "bundle failed for $name"
      say "would call $name on $model: $ids (counted 15 or more)"
    done < "$HERE/queue.txt"
    awk -v n="$n" -v m="$COUNT_MIN" -v c="$CAP" 'BEGIN { if (n * m > c) exit 1 }' || stop "$n calls at $COUNT_MIN each pass the $CAP cap"
    say "dry run: $n calls, at least $((n * COUNT_MIN)) counted of the $CAP cap; no model call made. Paid: bash $0"
    exit 0
  fi
  "$KIRO" whoami >/dev/null 2>&1 || stop "kiro-cli is not signed in: run '$KIRO login', then this script again"
  while read -r name model ids; do
    [ -n "$name" ] || continue
    [ -f "$S/STOP" ] && { say "STOP file: stopped before $name"; break; }
    [ -f "$S/results/$name.json" ] && { say "$name: done, skipped"; continue; }
    # shellcheck disable=SC2086
    call "$name" "$model" $ids || { rc=1; break; }
  done < "$HERE/queue.txt"
  say "spent $(spent) counted of $CAP; results in $S/results"
  return "$rc"
}
main "$@"
