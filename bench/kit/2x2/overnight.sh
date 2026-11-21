#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# overnight.sh: runs the rest of the 2x2 after the two stage-1 runs, with nobody at the keyboard.
#   start (survives a closed terminal):  tmux new -d -s k2x2 "env PATH=$PATH bash $KIT_COPY/overnight.sh"
#   look in:  tmux attach -t k2x2   |   bash $KIT_COPY/overnight.sh --status   |   tail -f $S/overnight.log
#   dry run:  bash $KIT_COPY/overnight.sh --dry-run     (prints the steps and runs only free checks)
# $KIT_COPY is a copy of this directory outside R. Needs S, R, AWSP (a profile NAME), KONDUCTOR_REF and BUILD_LABEL, as at freeze.
# Steps: wait for stage 1 -> judge-plan 1 -> judge 1 -> report 1 -> gate 1 (fail = STOP) -> stage 2 kiro and cc side by side
#        -> judge-plan 2 -> judge 2 -> report 2 -> gate 2. Each finished step leaves a marker in $ST; a rerun skips them.
# It never retries a paid step. The first failure writes $S/overnight.STOPPED with the reason and ends the script.
# Rerun after a stop: fix the cause, run the same command again. Kit stages resume by themselves (finished cells are kept).
set -Eeuo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
S=${S:-${KIT_DIR:?set S (the study directory) or KIT_DIR}}
KIT_SRC=$HERE   # the kit sourced below finds lib.sh here
K=${K:-$HERE/run-2x2.sh}
LOG=$S/overnight.log
ST=$S/overnight.state
STOPF=$S/overnight.STOPPED
DONEF=$S/overnight.DONE
SL=$S/overnight-stage2
CREDS_UNTIL=${CREDS_UNTIL:-}                     # local time the AWS credentials end, for example "2026-11-20 03:00"; "" turns the clock check off
NEED_MIN=65                                      # minutes of credentials needed before any paid step (the kit wants 60)
TOTAL_USD=${TOTAL_USD:-151}                         # approved in all: 520 credits and $151
export ACK_CC_VERSION=1
export HELD_SUBSET=${HELD_SUBSET:-"hard-export-formats,rc-threat-model design-hold-service,review-inventory-security sdlc-spike-dedupe"} HELD_REPS=${HELD_REPS:-2}
DRY=0 STATUS=0
case "${1:-}" in --dry-run) DRY=1 ;; --status) STATUS=1 ;; "") ;; *) echo "usage: overnight.sh [--dry-run|--status]" >&2; exit 2 ;; esac

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }
stop() { # the first reason wins; a dry run writes no stop file
  log "STOPPED: $*"
  [ "$DRY" = 1 ] || [ -f "$STOPF" ] || printf '%s %s\n' "$(date '+%F %T')" "$*" >"$STOPF"
  exit 1
}
trap 'c=$BASH_COMMAND; stop "unexpected failure at line $LINENO: ${c%%$'"'"'\n'"'"'*}"' ERR

if [ "$STATUS" != 1 ]; then   # --status reads only the log and markers; every other mode needs these
  export AWSP=${AWSP:?set AWSP to the NAME of your least-privilege Bedrock profile}
  export KONDUCTOR_REF=${KONDUCTOR_REF:?set KONDUCTOR_REF to the frozen build ref, as at freeze}
  export BUILD_LABEL=${BUILD_LABEL:?set BUILD_LABEL as at freeze}
  export R=${R:?set R to the konductor worktree the kit uses}
fi
export S

if [ "$STATUS" = 1 ]; then
  echo "state: $(ls "$ST" 2>/dev/null | tr '\n' ' ')"
  [ -f "$STOPF" ] && echo "STOPPED: $(cat "$STOPF")"
  [ -f "$DONEF" ] && echo "DONE: $(cat "$DONEF")"
  tail -n 15 "$LOG" 2>/dev/null || echo "no log yet"
  exit 0
fi

# The kit's own helpers (spent_in, stage_dirs, cred_minutes, caps) come from the kit file, not its command switch.
# shellcheck disable=SC1090
source "$K"   # the kit returns before its command switch when sourced
set +e +u; set -Eeuo pipefail   # the kit sets its own flags; keep ours
trap 'c=$BASH_COMMAND; stop "unexpected failure at line $LINENO: ${c%%$'"'"'\n'"'"'*}"' ERR
mkdir -p "$ST"

done_() { [ -f "$ST/$1" ]; }
mark() { date '+%F %T' >"$ST/$1"; }
# step NAME DESCRIPTION CMD...: skip a finished step, print in a dry run, else run and mark it
step() {
  local name=$1 desc=$2; shift 2
  if done_ "$name"; then log "skip $name (done $(cat "$ST/$name"))"; return 0; fi
  if [ "$DRY" = 1 ]; then log "[dry-run] would run $name: $desc"; return 0; fi
  log "start $name: $desc"; "$@"; mark "$name"; log "done $name"
}

load_now() { cut -d' ' -f1 /proc/loadavg; }
wait_load() { # LIMIT MAX_MINUTES: wait for the 1-minute load to fall below LIMIT; stop after MAX_MINUTES
  local limit=$1 t=0
  while ! awk -v l="$limit" '{ exit !($1 < l) }' /proc/loadavg; do
    [ "$t" -lt "$2" ] || stop "load stayed at or above $limit for $2 minutes (now $(load_now))"
    log "waiting for load below $limit (now $(load_now))"; sleep 60; t=$((t + 1))
  done
  log "load $(load_now) is below $limit"
}
creds_ok() { # the AWS profile works and lasts NEED_MIN more minutes, by its own expiry and by the clock
  aws sts get-caller-identity --profile "$AWSP" --query Arn --output text >/dev/null 2>&1 \
    || stop "AWS profile $AWSP has no working credentials: refresh them, then rerun overnight.sh"
  local m left; m=$(cred_minutes </dev/null)
  [ "$m" -ge "$NEED_MIN" ] || stop "AWS credentials of $AWSP last only $m more minutes (need $NEED_MIN): refresh them, then rerun overnight.sh"
  if [ -n "$CREDS_UNTIL" ]; then
    left=$(( ($(date -d "$CREDS_UNTIL" +%s) - $(date +%s)) / 60 ))
    [ "$left" -ge "$NEED_MIN" ] || stop "the credentials end at $CREDS_UNTIL, $left minutes away (need $NEED_MIN): refresh them, then rerun with CREDS_UNTIL set to the new end time"
  fi
  log "credentials ok: $m minutes by expiry, until $CREDS_UNTIL by the clock"
}
usd_spent_all() { # run costs of Claude Code in every set, plus judging in every set
  awk -v a="$(spent_in usd $(stage_dirs 1 cc) $(stage_dirs 2 cc))" -v b="$(spent_in judge $(stage_dirs 1 kiro) $(stage_dirs 1 cc) $(stage_dirs 2 kiro) $(stage_dirs 2 cc))" 'BEGIN { printf "%.4f", a + b }'
}
planned_usd() { # FILE: the judge-plan estimate in USD (the "high" figure when there is one); "unknown" when any line has no figure
  awk '/^estimated spend:/ {
         if ($0 ~ /none, there are no live/) next
         if (match($0, /high \$[0-9.]+/)) { s += substr($0, RSTART + 6, RLENGTH - 6); next }
         if (match($0, /about \$[0-9.]+/)) { s += substr($0, RSTART + 7, RLENGTH - 7); next }
         bad = 1 }
       END { if (bad) print "unknown"; else printf "%.4f", s }' "$1"
}
judge_plan() { # N REMAINING_USD: print the kit's judge plan and stop when it costs more than what is left
  local n=$1 rem=$2 f est; f=$S/overnight-judge-plan-$n.txt
  creds_ok
  bash "$K" judge-plan "$n" </dev/null 2>&1 | tee "$f" >>"$LOG"
  est=$(planned_usd "$f")
  [ "$est" != unknown ] || stop "the judge plan for stage $n gives no dollar estimate ($f); judging not started"
  log "judge plan $n: about \$$est (high figures), \$$rem left in the cap"
  awk -v e="$est" -v r="$rem" 'BEGIN { exit !(e <= r) }' || stop "the planned judging of stage $n costs \$$est, over the \$$rem left; judging not started. Read $f"
}

stage1_running() { pgrep -f "run-2x2.sh stage1" >/dev/null; }
wait_stage1() {
  [ -f "$S/dev/kiro/run-config.json" ] && [ -f "$S/dev/cc/run-config.json" ] || stop "stage 1 never started in $S/dev/kiro and $S/dev/cc (no run-config.json)"
  while stage1_running; do log "stage 1 still running: $(pgrep -fa 'run-2x2.sh stage1' | cut -c1-60 | tr '\n' ';')"; sleep 120; done
  # Both processes are gone. Every planned DEV cell must have a result; the late single-rep DEV task may be skipped by the cap guard.
  local miss; miss=$(bash "$K" missing </dev/null | grep '^dev ' | grep -v ' sdlc-design-review-gaps ' || true)
  [ -z "$miss" ] || stop "stage 1 ended with cells missing (rerun the stage 1 command, then overnight.sh again): $(printf '%s' "$miss" | head -n 6 | tr '\n' ';')"
  log "stage 1 finished: all planned DEV cells have results (the late sdlc-design-review-gaps task may be skipped)"
}

stage2_pair() {
  creds_ok
  mkdir -p "$SL"
  wait_load 3.5 45
  log "start stage2 kiro (log $SL/kiro.log)"
  bash "$K" stage2 kiro </dev/null >"$SL/kiro.log" 2>&1 & local pk=$!
  sleep 120
  wait_load 3.9 45
  creds_ok
  log "start stage2 cc (log $SL/cc.log)"
  bash "$K" stage2 cc </dev/null >"$SL/cc.log" 2>&1 & local pc=$!
  local rk=0 rc=0
  wait "$pk" || rk=$?
  log "stage2 kiro ended with exit $rk"
  wait "$pc" || rc=$?
  log "stage2 cc ended with exit $rc"
  [ "$rk" = 0 ] && [ "$rc" = 0 ] || stop "stage 2 did not finish (kiro exit $rk, cc exit $rc): read $SL/kiro.log and $SL/cc.log; judging not started. Rerun overnight.sh to resume"
}

rem1() { awk -v c="$CAP1_JUDGE" -v s="$(spent_in judge $(stage_dirs 1 kiro) $(stage_dirs 1 cc))" 'BEGIN { printf "%.4f", c - s }'; }
rem2() { awk -v c="$CAP2_JUDGE" -v s="$(spent_in judge $(stage_dirs 2 kiro) $(stage_dirs 2 cc))" -v t="$TOTAL_USD" -v u="$(usd_spent_all)" 'BEGIN { a = c - s; b = t - u; printf "%.4f", (a < b ? a : b) }'; }

log "overnight.sh $([ "$DRY" = 1 ] && echo '(dry run) ')on COMMIT $(grep ^COMMIT= "$S/freeze.env" | cut -d= -f2), label: $BUILD_LABEL"
[ -f "$S/freeze.env" ] || stop "no $S/freeze.env: run the kit's freeze first"
[ -x "$(command -v opencode)" ] || stop "opencode is not on PATH (judging needs it)"
[ "$DRY" = 1 ] || rm -f "$STOPF"

if [ "$DRY" = 1 ]; then
  log "[dry-run] checks: load $(load_now); stage 1 running: $(stage1_running && echo yes || echo no); markers: $(ls "$ST" | tr '\n' ' ')"
  # the kit's spend reader fails on a result.json that is being written, so a dry run beside live runs may print n/a
  log "[dry-run] judge cap left: stage 1 \$$(rem1 || echo n/a), stage 2 \$$(rem2 || echo n/a); spent so far \$$(usd_spent_all || echo n/a) of \$$TOTAL_USD"
  ( creds_ok ) || log "[dry-run] the credentials check above would stop a real run (no AWS credentials in this shell?)"
fi

kit() { bash "$K" "$@" </dev/null 2>&1 | tee -a "$LOG"; }   # one kit command, no keyboard; pipefail keeps its exit status
judge_n() { creds_ok; kit judge "$1"; }

step wait-stage1 "wait for both stage 1 runs to end, then check every planned DEV cell has a result" wait_stage1
step judge-plan-1 "judge plan for stage 1; stop if over the stage 1 judging cap" judge_plan 1 "$(rem1)"
step judge-1 "judge stage 1 (3 judges, median)" judge_n 1
step report-1 "report stage 1 (DEV, never the verdict)" kit report 1
step gate-1 "gate for stage 1; a STOP here ends the script" kit gate 1 \
  || stop "the stage 1 gate said STOP: stage 2 not started. Read the gate lines in $LOG"
step stage2 "stage 2 short run: kiro then cc side by side (HELD_SUBSET x $HELD_REPS reps)" stage2_pair
step judge-plan-2 "judge plan for stage 2; stop if over the stage 2 cap or the \$$TOTAL_USD total" judge_plan 2 "$(rem2)"
step judge-2 "judge stage 2" judge_n 2
step report-2 "report stage 2 (partial HELD-OUT)" kit report 2
step gate-2 "gate for stage 2" kit gate 2 \
  || stop "the stage 2 gate said STOP: read the gate lines in $LOG; the tables exist but do not use them as they are"

if [ "$DRY" = 1 ]; then log "[dry-run] end; nothing was started"; exit 0; fi
printf '%s done. Tables: %s/report-dev/factorial-2x2.md and %s/report-held/factorial-2x2.md. Label: %s. Commit %s\n' "$(date '+%F %T')" "$S" "$S" "$BUILD_LABEL" "$(grep ^COMMIT= "$S/freeze.env" | cut -d= -f2)" >"$DONEF"
log "ALL DONE: $(cat "$DONEF")"
