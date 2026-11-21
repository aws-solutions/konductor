#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# overnight-kiro.sh: the Kiro-only rerun (run-2x2-kiro.sh) with nobody at the keyboard.
#   start (survives a closed terminal):  tmux new -d -s k2x3 "env PATH=$PATH bash $KIT_COPY/overnight-kiro.sh"
#   look in:  tmux attach -t k2x3   |   bash $KIT_COPY/overnight-kiro.sh --status   |   tail -f $S/overnight.log
#   dry run:  bash $KIT_COPY/overnight-kiro.sh --dry-run     (prints the steps and runs only free checks)
# $KIT_COPY is a copy of this directory outside R. Needs S, R, AWSP (a profile NAME), KONDUCTOR_REF and BUILD_LABEL, as at freeze.
# Steps: stage3 kiro (17 tasks x 3 reps x 2 arms) -> judge-plan -> judge -> report -> gate. Run `freeze` and `prepare` first (by hand). Each finished step leaves a marker in $ST; a rerun skips them.
# It never retries a paid step. The first failure writes $S/overnight.STOPPED with the reason and ends the script.
# Rerun after a stop: fix the cause, run the same command again. Kit stages resume by themselves (finished cells are kept).
set -Eeuo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
S=${S:-${KIT_DIR:?set S (the study directory) or KIT_DIR}}
KIT_SRC=$HERE   # the kit sourced below finds lib.sh here
K=${K:-$HERE/run-2x2-kiro.sh}
LOG=$S/overnight.log
ST=$S/overnight.state
STOPF=$S/overnight.STOPPED
DONEF=$S/overnight.DONE
SL=$S/overnight-stage3
CREDS_UNTIL=${CREDS_UNTIL:-}                     # local time the AWS credentials end, for example "2026-11-20 03:00"; "" turns the clock check off
NEED_MIN=65                                      # minutes of credentials needed before any paid step (the kit wants 60)
TOTAL_USD=${TOTAL_USD:-129.84}                            # $151 approved in all, minus $21.16 spent in the first study
DRY=0 STATUS=0
case "${1:-}" in --dry-run) DRY=1 ;; --status) STATUS=1 ;; "") ;; *) echo "usage: overnight-kiro.sh [--dry-run|--status]" >&2; exit 2 ;; esac

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
  [ -s "$S/soft-cap-warnings.log" ] && echo "SOFT CAP WARNINGS: $(wc -l <"$S/soft-cap-warnings.log"), last: $(tail -n 1 "$S/soft-cap-warnings.log")"
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
    || stop "AWS profile $AWSP has no working credentials: refresh them, then rerun overnight-kiro.sh"
  local m left; m=$(cred_minutes </dev/null)
  [ "$m" -ge "$NEED_MIN" ] || stop "AWS credentials of $AWSP last only $m more minutes (need $NEED_MIN): refresh them, then rerun overnight-kiro.sh"
  if [ -n "$CREDS_UNTIL" ]; then
    left=$(( ($(date -d "$CREDS_UNTIL" +%s) - $(date +%s)) / 60 ))
    [ "$left" -ge "$NEED_MIN" ] || stop "the credentials end at $CREDS_UNTIL, $left minutes away (need $NEED_MIN): refresh them, then rerun with CREDS_UNTIL set to the new end time"
  fi
  log "credentials ok: $m minutes by expiry, until $CREDS_UNTIL by the clock"
}
planned_usd() { # FILE: the judge-plan estimate in USD (the "high" figure when there is one); "unknown" when any line has no figure
  awk '/^estimated spend:/ {
         if ($0 ~ /none, there are no live/) next
         if (match($0, /high \$[0-9.]+/)) { s += substr($0, RSTART + 6, RLENGTH - 6); next }
         if (match($0, /about \$[0-9.]+/)) { s += substr($0, RSTART + 7, RLENGTH - 7); next }
         bad = 1 }
       END { if (bad) print "unknown"; else printf "%.4f", s }' "$1"
}
judge_plan() { # N REMAINING_USD (N is 3): print the kit's judge plan and stop when it costs more than what is left
  local n=$1 rem=$2 f est; f=$S/overnight-judge-plan.txt
  creds_ok
  bash "$K" judge-plan </dev/null 2>&1 | tee "$f" >>"$LOG"
  est=$(planned_usd "$f")
  [ "$est" != unknown ] || stop "the judge plan for stage $n gives no dollar estimate ($f); judging not started"
  log "judge plan $n: about \$$est (high figures), \$$rem left in the cap"
  awk -v e="$est" -v c="$CAP3_JUDGE" 'BEGIN { exit !(e <= c) }' || log "WARNING: the judge plan (\$$est) is over the soft cap of \$$CAP3_JUDGE; it goes on up to the ceiling"
  awk -v e="$est" -v r="$rem" 'BEGIN { exit !(e <= r) }' || stop "the planned judging of stage $n costs \$$est, over the \$$rem left; judging not started. Read $f"
}

stage3_kiro() {
  creds_ok   # Kiro uses its own login, but judging after it needs AWS; fail early rather than after 8 hours
  mkdir -p "$SL"
  wait_load 3.5 45
  log "start stage3 kiro (log $SL/kiro.log)"
  local rk=0
  bash "$K" stage3 kiro </dev/null >"$SL/kiro.log" 2>&1 || rk=$?
  log "stage3 kiro ended with exit $rk"
  [ "$rk" = 0 ] || stop "stage 3 did not finish (exit $rk): read $SL/kiro.log; judging not started. Rerun overnight-kiro.sh to resume"
  [ ! -s "$S/soft-cap-warnings.log" ] || log "SOFT CAP WARNING (the run went on): $(tail -n 1 "$S/soft-cap-warnings.log")"
  local m; m=$(bash "$K" missing </dev/null | wc -l)
  [ "$m" = 0 ] || log "note: $m planned cells have no result (the cap guard may have skipped late replicates): $(bash "$K" missing </dev/null | head -n 3 | tr '\n' ';')"
}

rem3() { awk -v c="$CEIL3_JUDGE" -v s="$(spent_in judge $(stage_dirs 3 kiro))" -v t="$TOTAL_USD" 'BEGIN { a = c - s; printf "%.4f", (a < t ? a : t) }'; }  # soft cap $20; the ceiling is the rest of the approved total

log "overnight-kiro.sh $([ "$DRY" = 1 ] && echo '(dry run) ')on COMMIT $(grep ^COMMIT= "$S/freeze.env" | cut -d= -f2), label: $BUILD_LABEL"
[ -f "$S/freeze.env" ] || stop "no $S/freeze.env: run the kit's freeze first"
[ -x "$(command -v opencode)" ] || stop "opencode is not on PATH (judging needs it)"
mkdir -p "$S"; [ "$DRY" = 1 ] || rm -f "$STOPF"

if [ "$DRY" = 1 ]; then
  log "[dry-run] checks: load $(load_now); markers: $(ls "$ST" | tr '\n' ' ')"
  log "[dry-run] judging ceiling left \$$(rem3 || echo n/a) (soft cap \$$CAP3_JUDGE); credits spent so far $(spent_in credits $(stage_dirs 3 kiro) || echo n/a) (soft cap $CAP3_CR, ceiling $CEIL3_CR); python3: $(python3 --version 2>&1)"
  ( creds_ok ) || log "[dry-run] the credentials check above would stop a real run (no AWS credentials in this shell?)"
fi

kit() { bash "$K" "$@" </dev/null 2>&1 | tee -a "$LOG"; }   # one kit command, no keyboard; pipefail keeps its exit status
judge_n() { creds_ok; kit judge; }

step stage3 "Kiro vanilla vs konductor, 17 tasks x 3 reps, soft limit 1800 s, soft cap 390 credits, ceiling 396" stage3_kiro
step judge-plan-3 "judge plan; warn over the soft judging cap, stop over the ceiling" judge_plan 3 "$(rem3)"
step judge-3 "judge the rerun (3 judges, median)" judge_n 3
step report-3 "report: table, fractional sensitivity, build label" kit report 3
step gate-3 "gate: model mismatch, tamper, startup, effort" kit gate 3 \
  || stop "the gate said STOP: read the gate lines in $LOG; the tables exist but do not use them as they are"

if [ "$DRY" = 1 ]; then log "[dry-run] end; nothing was started"; exit 0; fi
printf '%s done. Table: %s/report-rerun-kiro/report.md. Label: %s. Commit %s\n' "$(date '+%F %T')" "$S" "$BUILD_LABEL" "$(grep ^COMMIT= "$S/freeze.env" | cut -d= -f2)" >"$DONEF"
log "ALL DONE: $(cat "$DONEF")"
