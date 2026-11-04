#!/usr/bin/env bash
# monitor.sh - one-screen, read-only dashboard of the unattended benchmark pipeline.
#
# USAGE
#   bash monitor.sh                 print the dashboard once (about 30 lines)
#   bash monitor.sh --watch [N]     redraw in place every N seconds (default 30) until Ctrl-C
#   bash monitor.sh --json          the same facts as one JSON document (for scripts; not with --watch)
#   bash monitor.sh --all           add the capability-study summary (judged result paths, decisions) below the dashboard
#   bash monitor.sh --save          also write the frame to $STATE_DIR/monitor.last.txt (the only file this script ever writes)
#   bash monitor.sh -h              this help
#
# WHAT YOU SEE
#   CHAIN     is run-after-capability.sh alive (pid, uptime) and which phase it is in
#   PHASES    P1 WAIT, P2 PATCH, P3 AUTONOMY, P4 JUDGE, P5 SKILLBENCH, P6 SUMMARY with [x] done, [>] running, [ ] pending,
#             [!] failed, [-] skipped, [~] interrupted, and a one-line result for each
#   DOING     what is happening right now, in words (which task, arm and run, which judge call, which skill wave)
#   PROGRESS  a bar for the current phase (runs, task dirs, waves) with a rough ETA from the pace so far
#   HEALTH    isolation failure, waiting for credentials, FAILED lines, timeouts and errors, disk, stray bench processes
#   LOG       the last 5 lines of the log that belongs to the current phase
#   VERDICT   OK, ATTENTION (why and what to do), DONE or FAILED
#
# READ-ONLY. It reads state, logs and result.json files, and calls only `run-after-capability.sh --status` and
# `run-skill-bench.sh --status`. It never starts, stops or signals anything, never reads the credentials file (only the
# chain log's credential lines), and calls no AWS, kiro-cli, opencode or model. The two --status calls are the only
# subprocesses beyond ps/df/jq/grep; run-skill-bench --status makes a short-lived scratch dir under its SCRATCH_PARENT, which it removes.
#
# ENVIRONMENT (defaults in brackets)
#   STATE_DIR [/tmp/konductor-bench]   where the chain keeps its pid, log and state files
#   STUDY     [contents of $STATE_DIR/real-pilot.study]   the capability study directory
#   MON_COLS [118]  line width        MON_STALL_MIN [30]  minutes without log output before ATTENTION
#   MON_N_ARMS [4]  MON_REPS [5]      (a complete task dir holds N_ARMS x REPS runs)
#   MON_AC_SCRIPT, MON_SB_SCRIPT      the two scripts whose --status is called   [run-after-capability.sh and run-skill-bench.sh beside this script]
#   MON_DISK_PATH [/tmp]              filesystem whose free space is reported
#   MON_PROC_RE                       egrep pattern for "bench processes"; default matches bench.js and the run-*.sh scripts
#
# EXIT CODES: 0 printed (any verdict), 2 bad usage. With --json the verdict is in .verdict.status.

set -u -o pipefail
export LC_ALL=C

# shellcheck disable=SC2034  # globals are shared between gather, render and json_out
SELF=$(readlink -f "${BASH_SOURCE[0]}")
SELF_DIR=$(dirname "$SELF")
STATE_DIR=${STATE_DIR:-/tmp/konductor-bench}
STUDY=${STUDY:-}
COLS=${MON_COLS:-118}
N_ARMS=${MON_N_ARMS:-4}
REPS=${MON_REPS:-5}
STALL_MIN=${MON_STALL_MIN:-30}
AC_SCRIPT=${MON_AC_SCRIPT:-$SELF_DIR/run-after-capability.sh}
SB_SCRIPT=${MON_SB_SCRIPT:-$SELF_DIR/run-skill-bench.sh}
DISK_PATH=${MON_DISK_PATH:-/tmp}

LOG=$STATE_DIR/after-capability.log
STATEFILE=$STATE_DIR/after-capability.state
PIDFILE=$STATE_DIR/after-capability.pid
SUMMARY=$STATE_DIR/after-capability-summary.txt
PILOT_SUMMARY=$STATE_DIR/real-pilot-summary.txt
P2_TEST_LOG=$STATE_DIR/after-capability-p2-tests.log
RERUN_LOG=$STATE_DIR/real-pilot-autonomy-rerun.log
SB_LOG=$STATE_DIR/skill-bench.log
SB_STUDYFILE=$STATE_DIR/skill-bench.study
SNAPSHOT=$STATE_DIR/monitor.last.txt

MODE=once
WATCH_S=30
JSON=0
ALL=0
SAVE=0

usage() { awk 'NR>1 && /^set -u/ {exit} NR>1 {sub(/^# ?/, ""); print}' "$SELF"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --watch) MODE=watch; if [ $# -gt 1 ] && [[ $2 =~ ^[0-9]+$ ]]; then WATCH_S=$2; shift; fi ;;
    --json) JSON=1 ;;
    --all) ALL=1 ;;
    --save) SAVE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1 (see -h)" >&2; exit 2 ;;
  esac
  shift
done
if [ "$MODE" = watch ] && [ "$JSON" = 1 ]; then echo "--json cannot be combined with --watch" >&2; exit 2; fi
[ "$WATCH_S" -ge 1 ] 2>/dev/null || WATCH_S=30
[[ $COLS =~ ^[0-9]+$ ]] && [ "$COLS" -ge 60 ] || COLS=118

PN=("" WAIT PATCH AUTONOMY JUDGE SKILLBENCH SUMMARY)

# ---------------------------------------------------------------- small helpers
declare -A ST=()
NOW=0

load_state() {
  local line k v
  [ -r "$STATEFILE" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in *=*) k=${line%%=*}; v=${line#*=}; ST[$k]=$v ;; esac
  done < "$STATEFILE"
}
san() { tr -d '\000-\010\013-\037\177'; }
clip() { local s=$1 n=${2:-$COLS}; if [ "${#s}" -gt "$n" ]; then printf '%s...' "${s:0:$((n - 3))}"; else printf '%s' "$s"; fi; }
num() { if [[ ${1:-} =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then printf '%s' "$1"; else printf 'null'; fi; }
int() { if [[ ${1:-} =~ ^[0-9]+$ ]]; then printf '%s' "$1"; else printf '0'; fi; }
fmt_dur() {
  local s=${1:-}
  [[ $s =~ ^-?[0-9]+$ ]] || { printf '?'; return; }
  [ "$s" -lt 0 ] && s=0
  if [ "$s" -ge 3600 ]; then printf '%dh%02dm' $((s / 3600)) $(((s % 3600) / 60))
  elif [ "$s" -ge 60 ]; then printf '%dm%02ds' $((s / 60)) $((s % 60))
  else printf '%ds' "$s"; fi
}
iso_epoch() { local e; [ -n "${1:-}" ] && e=$(date -u -d "$1" +%s 2>/dev/null) && printf '%s' "$e" || printf '0'; }
hms_epoch() { # HH:MM:SS (UTC, today) -> epoch; a time that lies in the future is yesterday's
  local e
  e=$(date -u -d "$1" +%s 2>/dev/null) || { printf '0'; return; }
  if [ "$e" -gt $((NOW + 120)) ]; then e=$((e - 86400)); fi
  printf '%s' "$e"
}
hhmm_at() { date -u -d "@$1" +%H:%MZ 2>/dev/null || printf '?'; }
mtime() { stat -c %Y "$1" 2>/dev/null || printf '0'; }
cnt() { local n; n=$(grep -ac -- "$1" "$2" 2>/dev/null) || n=0; printf '%s' "${n:-0}"; }
bar() { # bar <done> <total> [width]
  local d t w=${3:-24} f i s=""
  d=$(int "${1:-0}"); t=$(int "${2:-0}")
  if [ "$t" -le 0 ]; then f=0; else f=$((d * w / t)); [ "$f" -gt "$w" ] && f=$w; fi
  for ((i = 0; i < w; i++)); do if [ "$i" -lt "$f" ]; then s+="#"; else s+="."; fi; done
  printf '[%s]' "$s"
}
pct() { local d t; d=$(int "${1:-0}"); t=$(int "${2:-0}"); if [ "$t" -le 0 ]; then printf '0'; else printf '%d' $((d * 100 / t)); fi; }
rx() { [[ $1 =~ $2 ]] && printf '%s' "${BASH_REMATCH[${3:-1}]}"; return 0; }
short_name() { local n=${1#real-real-}; n=${n#pilot-}; n=${n#real-}; printf '%s' "${n:0:18}"; }

# last_run_event <file> <prefix>: the newest "[bench HH:MM:SS] run|done arm / task / #n" line, stored in
# <prefix>_STATE (none|running|between), <prefix>_ARM, <prefix>_TASK, <prefix>_REP, <prefix>_AT (epoch)
last_run_event() {
  local line pfx=$2 re='^\[bench ([0-9:]+)\] (run|done) +([^ ]+) / ([^ ]+) / #([0-9]+)'
  printf -v "${pfx}_STATE" '%s' none; printf -v "${pfx}_ARM" '%s' ""; printf -v "${pfx}_TASK" '%s' ""
  printf -v "${pfx}_REP" '%s' ""; printf -v "${pfx}_AT" '%s' 0
  line=$(tail -n 400 "$1" 2>/dev/null | grep -aE '^\[bench [0-9:]+\] (run|done) ' | tail -n 1)
  if [[ $line =~ $re ]]; then
    printf -v "${pfx}_AT" '%s' "$(hms_epoch "${BASH_REMATCH[1]}")"
    printf -v "${pfx}_ARM" '%s' "${BASH_REMATCH[3]}"; printf -v "${pfx}_TASK" '%s' "${BASH_REMATCH[4]}"; printf -v "${pfx}_REP" '%s' "${BASH_REMATCH[5]}"
    if [ "${BASH_REMATCH[2]}" = run ]; then printf -v "${pfx}_STATE" '%s' running; else printf -v "${pfx}_STATE" '%s' between; fi
  fi
}
LR3_STATE=none; LR3_ARM=""; LR3_TASK=""; LR3_REP=""; LR3_AT=0
LR5_STATE=none; LR5_ARM=""; LR5_TASK=""; LR5_REP=""; LR5_AT=0
# run_status_counts <file> -> "total success timeout other" from the "done ... #n: status" lines
run_status_counts() {
  grep -aE '^\[bench [0-9:]+\] done .* #[0-9]+: ' "$1" 2>/dev/null | awk '
    { n = split($0, a, /#[0-9]+: /); split(a[n], b, /[,; ]/); s = b[1]; t++; if (s == "success") ok++; else if (s == "timeout") to++; else ot++ }
    END { printf "%d %d %d %d", t, ok, to, ot }'
}
# failed_line <file> <reset-regex>: last line with FAILED after the last line matching the reset regex
failed_line() { awk -v rs="$2" '$0 ~ rs { last = "" } /FAILED/ { last = $0 } END { print last }' "$1" 2>/dev/null | san | head -n 1; }

# ---------------------------------------------------------------- gather: chain
CH_PID=""; CH_ALIVE=no; CH_UP=""; ACS=""
gather_chain() {
  local d
  CH_PID=""; CH_ALIVE=no; CH_UP=""; ACS=""
  if [ -f "$AC_SCRIPT" ] && [ -d "$STATE_DIR" ]; then
    ACS=$(cd "$STATE_DIR" && env -u AC_CHILD AC_STATE_DIR="$STATE_DIR" timeout 15 bash "$AC_SCRIPT" --status </dev/null 2>/dev/null) || true
  fi
  d=$(sed -n 's/^daemon: running, pid \([0-9][0-9]*\).*/\1/p' <<<"$ACS" | head -n 1)
  if [ -n "$d" ]; then
    CH_PID=$d; CH_ALIVE=yes
  else
    CH_PID=$(tr -dc '0-9' 2>/dev/null < "$PIDFILE" || true)
    if [ -z "$ACS" ] && [ -n "$CH_PID" ] && grep -aq 'run-after-capability' "/proc/$CH_PID/cmdline" 2>/dev/null; then CH_ALIVE=yes; fi
  fi
  if [ "$CH_ALIVE" = yes ]; then CH_UP=$(ps -o etimes= -p "$CH_PID" 2>/dev/null | tr -d ' ' || true); fi
}

# ---------------------------------------------------------------- gather: P3 autonomy rerun
P3_DIRS=0; P3_DIRS_DONE=0; P3_RUNS=0; P3_TOTAL=0; P3_OK=0; P3_TO=0; P3_BAD=0; P3_ASKED=0; P3_QRUNS=0; P3_QSUM=0; P3_T2=0
P3_CRED=0; P3_ARMS=""; P3_TMO=0; P3_CUR_DIR=0
gather_p3() {
  local exp=$((N_ARMS * REPS)) names=() dirs=() nm d n agg a rest line re
  P3_DIRS=0; P3_DIRS_DONE=0; P3_RUNS=0; P3_TOTAL=0; P3_OK=0; P3_TO=0; P3_BAD=0; P3_ASKED=0; P3_QRUNS=0; P3_QSUM=0; P3_T2=0
  P3_CRED=0; P3_ARMS=""; P3_TMO=0
  [ -n "$V" ] || return 0
  if [ -n "${ST[P3_names]:-}" ]; then read -r -a names <<<"${ST[P3_names]}"
  else for d in "$V"/pilot-autonomy-*; do [ -d "$d" ] && names+=("$(basename "$d")"); done; fi
  P3_DIRS=${#names[@]}
  P3_TOTAL=$((exp * P3_DIRS))
  for nm in "${names[@]}"; do
    d=$V/$nm; [ -d "$d" ] || continue
    n=$(find "$d" -mindepth 4 -maxdepth 4 -name result.json 2>/dev/null | wc -l)
    P3_RUNS=$((P3_RUNS + n))
    if [ -f "$d/summary.json" ] && [ "$n" -ge "$exp" ]; then P3_DIRS_DONE=$((P3_DIRS_DONE + 1)); fi
    dirs+=("$d")
  done
  if [ "${#dirs[@]}" -gt 0 ]; then
    agg=$(find "${dirs[@]}" -mindepth 4 -maxdepth 4 -name result.json -print0 2>/dev/null |
      xargs -0 -r -n 1 -P 8 jq -r '[.armId, .status, (.askedUser|tostring), ((.questionsAsked // 0)|tostring), ((.turns // 0)|tostring), ((.creditsCharged // .credits // 0)|tostring)] | @tsv' 2>/dev/null |
      awk -F'\t' '{ runs++; arm[$1]++; if ($2 == "success") ok++; else if ($2 == "timeout") to++; else bad++
                    if ($3 == "true") asked++; if ($4 + 0 > 0) { q++; qs += $4 }; if ($5 + 0 == 2) t2++; cr += $6 }
                  END { printf "%d %d %d %d %d %d %d %d %.1f", runs, ok, to, bad, asked, q, qs, t2, cr
                        for (a in arm) printf " %s=%d", a, arm[a]; print "" }')
    if [ -n "$agg" ]; then
      read -r n P3_OK P3_TO P3_BAD P3_ASKED P3_QRUNS P3_QSUM P3_T2 P3_CRED rest <<<"$agg"
      P3_ARMS=$(tr ' ' '\n' <<<"$rest" | sort | paste -sd' ' -)
    fi
  fi
  last_run_event "$RERUN_LOG" LR3
  line=$(tail -n 400 "$RERUN_LOG" 2>/dev/null | grep -aE '\] START \(' | tail -n 1)
  re='timeout ([0-9]+)s per run'
  P3_TMO=$(rx "$line" "$re")
  P3_TMO=$(int "$P3_TMO")
  P3_CUR_DIR=$((P3_DIRS_DONE + 1)); [ "$P3_CUR_DIR" -gt "$P3_DIRS" ] && P3_CUR_DIR=$P3_DIRS
}

# ---------------------------------------------------------------- gather: P4 judging
P4_TOTAL=0; P4_JN=0; P4_JT=0; P4_CUR=""; P4_CUR_CALLS=0; P4_CUR_BAD=0; P4_CUR_LAST=0; P4_USD=0; P4_PF=0; P4_ERR=0; P4_PERDIR=""; P4_LASTLINE=""
P4_CALLS_ALL=0
gather_p4() {
  local d name jl calls bad sp pf er line re cur_re usd_log last_t logpf
  P4_TOTAL=0; P4_JN=0; P4_JT=0; P4_CUR=""; P4_CUR_CALLS=0; P4_CUR_BAD=0; P4_CUR_LAST=0; P4_USD=0; P4_PF=0; P4_ERR=0; P4_PERDIR=""; P4_LASTLINE=""
  P4_CALLS_ALL=0
  [ -n "$V" ] || return 0
  re='P4: \[([0-9]+)/([0-9]+)\]'
  line=$(grep -aE 'P4: \[[0-9]+/[0-9]+\]' "$LOG" 2>/dev/null | tail -n 1)
  P4_JN=$(int "$(rx "$line" "$re" 1)"); P4_JT=$(int "$(rx "$line" "$re" 2)")
  P4_LASTLINE=$(grep -aE '\] P4:' "$LOG" 2>/dev/null | tail -n 1 | san)
  cur_re='P4: judging ([^ ]+) \(attempt'
  line=$(grep -aE 'P4: (judging [^ ]+ \(attempt|\[[0-9]+/[0-9]+\])' "$LOG" 2>/dev/null | tail -n 1)
  P4_CUR=$(rx "$line" "$cur_re")
  for d in "$V"/real-* "$V"/pilot-*; do
    [ -f "$d/summary.json" ] || continue
    P4_TOTAL=$((P4_TOTAL + 1))
    name=$(basename "$d"); jl=$STATE_DIR/judge-capability-$name.log
    calls=$(cnt '^\[judge [0-9:]*\] judged ' "$jl")
    bad=$(grep -aE '^\[judge [0-9:]*\] judged ' "$jl" 2>/dev/null | grep -avc ': ok') || bad=0
    P4_CALLS_ALL=$((P4_CALLS_ALL + calls))
    sp=0; pf=0; er=0
    logpf=$(grep -aciE 'parse fail|unparse|could not parse|unusable' "$jl" 2>/dev/null) || logpf=0
    if [ -f "$d/judgments.json" ]; then
      read -r sp pf er < <(jq -r '([(.rubric//[]),(.pairwise//[]),(.graded//[])]|add) as $r | [(.spentUsd//0), ($r|map(.parseFailures//0)|add//0), ($r|map(select(.judgeError))|length)] | @tsv' "$d/judgments.json" 2>/dev/null || echo "0 0 0")
    else
      er=$bad; pf=$logpf
    fi
    if [ "$name" = "$P4_CUR" ]; then
      P4_CUR_CALLS=$calls; P4_CUR_BAD=$bad
      usd_log=$(grep -aoE 'usd: this command \$[0-9.]+' "$jl" 2>/dev/null | tail -n 1 | tr -dc '0-9.')
      sp=$(awk -v a="${sp:-0}" -v b="${usd_log:-0}" 'BEGIN { print (b > a ? b : a) }')
      line=$(grep -aE '^\[judge [0-9:]*\] judged ' "$jl" 2>/dev/null | tail -n 1)
      last_t=$(rx "$line" '^\[judge ([0-9:]+)\]')
      [ -n "$last_t" ] && P4_CUR_LAST=$(hms_epoch "$last_t")
    fi
    P4_USD=$(awk -v a="$P4_USD" -v b="${sp:-0}" 'BEGIN { printf "%.4f", a + b }')
    P4_PF=$((P4_PF + $(int "${pf:-0}")))
    P4_ERR=$((P4_ERR + $(int "${er:-0}")))
    [ "$calls" -gt 0 ] && P4_PERDIR+="$(short_name "$name")=$calls$([ "$name" = "$P4_CUR" ] && echo '*') "
  done
  P4_PERDIR=${P4_PERDIR% }
  if [ "$P4_JN" -eq 0 ]; then
    for d in "$V"/real-* "$V"/pilot-*; do [ -f "$d/judgments.json" ] && P4_JN=$((P4_JN + 1)); done
  fi
  [ "$P4_JT" -eq 0 ] && P4_JT=$P4_TOTAL
}

# ---------------------------------------------------------------- gather: P5 skill bench
SBV=""; SBS=""; SB_CONTROLS=""; SB_WD=0; SB_WT=0; SB_RUNS=""; SB_CREDITS=""; SB_NOWSKILL=""; SB_DECIDE=""; SB_DEC_N=""
SB_LT=0; SB_LOK=0; SB_LTO=0; SB_LOT=0; SB_CTX=""
gather_p5() {
  local re line
  SBV=$(cat "$SB_STUDYFILE" 2>/dev/null || true); [ -d "$SBV" ] || SBV=${ST[P5_study]:-}
  SBS=""; SB_CONTROLS=""; SB_WD=0; SB_WT=0; SB_RUNS=""; SB_CREDITS=""; SB_NOWSKILL=""; SB_DECIDE=""; SB_DEC_N=""
  if [ -f "$SB_SCRIPT" ] && [ -s "$SB_STUDYFILE" ] && [ -d "$STATE_DIR" ]; then
    SBS=$(cd "$STATE_DIR" && env -u SB_CHILD -u AC_CHILD STATE_DIR="$STATE_DIR" timeout 20 bash "$SB_SCRIPT" --status </dev/null 2>/dev/null) || true
  fi
  SB_CONTROLS=$(sed -n 's/^controls: //p' <<<"$SBS" | head -n 1)
  line=$(grep -a '^waves done:' <<<"$SBS" | head -n 1); re='waves done: ([0-9]+)/([0-9]+)'
  SB_WD=$(int "$(rx "$line" "$re" 1)"); SB_WT=$(int "$(rx "$line" "$re" 2)")
  line=$(grep -a '^runs logged:' <<<"$SBS" | head -n 1); re='runs logged: ([0-9]+) +credits so far: ([0-9.]+)'
  SB_RUNS=$(rx "$line" "$re" 1); SB_CREDITS=$(rx "$line" "$re" 2)
  SB_NOWSKILL=$(grep -aE '^ +.+ \(.+\): .*w[0-9] (running|todo)' <<<"$SBS" | head -n 1 | sed 's/^ *//' | san)
  if [ -n "$SBV" ] && [ -f "$SBV/decisions/decisions.json" ]; then
    SB_DEC_N=$(jq -r '. as $j | ["DELETE","PRUNE","KEEP","NEEDS DATA"] | map(. as $k | $k + "=" + ([$j.decisions[]? | select(.decision == $k)] | length | tostring)) | join(" ")' "$SBV/decisions/decisions.json" 2>/dev/null || true)
  fi
  [ -n "$SBV" ] && [ -f "$SBV/decisions/decisions.md" ] && SB_DECIDE=$SBV/decisions/decisions.md
  read -r SB_LT SB_LOK SB_LTO SB_LOT <<<"$(run_status_counts "$SB_LOG")"
  SB_LT=$(int "$SB_LT"); SB_LOK=$(int "$SB_LOK"); SB_LTO=$(int "$SB_LTO"); SB_LOT=$(int "$SB_LOT")
  last_run_event "$SB_LOG" LR5
  SB_CTX=$(tail -n 300 "$SB_LOG" 2>/dev/null | grep -aE 'wave [0-9]|screen|controls' | tail -n 1 | san)
}

# ---------------------------------------------------------------- gather: everything
declare -a PSTATE=() PRES=() DETAIL=() LOGTAIL=()
CUR=0; DONE_N=0; NOT_STARTED=0; V=""; V_NOTE=""
PH_ELAPSED=0; DOING=""; PG_DONE=0; PG_TOTAL=0; PG_UNIT=""; ETA_S=""
WAIT_CRED=no; WAIT_LINE=""; CRED_EXPIRE=""; CRED_LEFT=""
ISO="none"; FAILED_LINES="none"; TE_TEXT=""; TE_COUNT=0
DISK_FREE=""; DISK_USED=""; RES_FS=""; OTHER=""; OTHER_N=0
ACTIVE_LOG=""; IDLE_S=0; STALL=no
VERDICT=OK; WHY=""; TODO=""
FINAL=""; STARTED_AT=""

phase_result() { # n -> one-line result
  local n=$1 s r="" t pass fail skip c1 b a re k
  s=${ST[P$n]:-}
  case $s in
    skipped) printf 'skipped%s' "${ST[P${n}_note]:+ (${ST[P${n}_note]})}"; return ;;
    failed) printf 'FAILED: %s' "${ST[P${n}_reason]:-no reason recorded}"; return ;;
    interrupted) printf 'interrupted; rerun run-after-capability.sh to resume'; return ;;
  esac
  case $n in
    1) case $s in
         done) r="capability study finished; waited $(fmt_dur $(($(iso_epoch "${ST[P1_finished]:-}") - $(iso_epoch "${ST[P1_started]:-}"))))" ;;
         running) r="waiting for the capability study to finish" ;;
       esac ;;
    2) case $s in
         done)
           re='tests ([0-9]+), pass ([0-9]+), fail ([0-9]+), skipped ([0-9]+)'
           t=$(rx "${ST[P2_tests]:-}" "$re" 1); pass=$(rx "${ST[P2_tests]:-}" "$re" 2); fail=$(rx "${ST[P2_tests]:-}" "$re" 3); skip=$(rx "${ST[P2_tests]:-}" "$re" 4)
           c1=""
           for k in 1 2 3 4 5 6 7 8; do [ -n "${ST[P2_commit$k]:-}" ] && c1+="${c1:+, }${ST[P2_commit$k]%% *}"; done
           r="${t:-?} tests, ${fail:-?} fail (${pass:-?} pass, ${skip:-?} skipped), commits ${c1:-none}" ;;
         running) r="applying the patches and running the bench suite" ;;
       esac ;;
    3) case $s in
         done)
           re='askedUser=([0-9]+) secondTurn=([0-9]+)'
           b=${ST[P3_before]:-}; a=${ST[P3_after]:-}
           if [ -n "$a" ]; then
             r="$(rx "$a" 'runs=([0-9]+)') runs rerun; askedUser $(rx "$b" "$re" 1)->$(rx "$a" "$re" 1), secondTurn $(rx "$b" "$re" 2)->$(rx "$a" "$re" 2) (before->after the rerun)"
           else r="done (no before/after counts recorded)"; fi ;;
         running) r="${P3_RUNS}/${P3_TOTAL} runs, ${P3_DIRS_DONE}/${P3_DIRS} task dirs" ;;
       esac ;;
    4) case $s in
         done) r="judged ${P4_JT} dirs, judge USD ${P4_USD}; summary $(basename "$PILOT_SUMMARY")" ;;
         running) r="judged ${P4_JN}/${P4_JT} dirs so far, judge USD ${P4_USD}" ;;
       esac ;;
    5) case $s in
         done) r="${SB_DEC_N:-decisions: see ${SB_DECIDE:-decisions.md}}" ;;
         running) r="waves ${SB_WD}/${SB_WT}, controls: ${SB_CONTROLS:-not run yet}" ;;
       esac ;;
    6) case $s in done) r="summary written: $(basename "$SUMMARY")" ;; running) r="writing the summary" ;; esac ;;
  esac
  printf '%s' "$r"
}

gather() {
  local n s line other_re last mt
  NOW=$(date -u +%s); NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  ST=(); PSTATE=(); PRES=(); DETAIL=(); LOGTAIL=()
  load_state
  FINAL=${ST[FINAL]:-}; STARTED_AT=${ST[STARTED]:-}
  V=$STUDY; [ -n "$V" ] || V=$(cat "$STATE_DIR/real-pilot.study" 2>/dev/null || true)
  V_NOTE=""
  if [ -z "$V" ] || [ ! -d "$V" ]; then [ -n "$V" ] && V_NOTE="study dir not found: $V"; V=""; fi
  gather_chain

  # current phase
  CUR=0; DONE_N=0; NOT_STARTED=0
  for n in 1 2 3 4 5 6; do
    s=${ST[P$n]:-}; PSTATE[n]=$s
    case $s in done|skipped) DONE_N=$((DONE_N + 1)) ;; esac
  done
  for n in 1 2 3 4 5 6; do
    case ${PSTATE[n]} in running|failed|interrupted) CUR=$n; break ;; esac
  done
  if [ "$CUR" -eq 0 ]; then
    if [ "$DONE_N" -ge 6 ]; then CUR=6
    elif [ ! -f "$STATEFILE" ]; then NOT_STARTED=1
    else for n in 1 2 3 4 5 6; do [ -z "${PSTATE[n]}" ] && { CUR=$n; break; }; done; fi
  fi
  PH_ELAPSED=0
  if [ "$CUR" -gt 0 ] && [ "${PSTATE[CUR]:-}" = running ]; then PH_ELAPSED=$((NOW - $(iso_epoch "${ST[P${CUR}_started]:-}"))); [ "$PH_ELAPSED" -lt 0 ] && PH_ELAPSED=0; fi

  # phase data
  case ${PSTATE[3]:-} in running|done|failed|interrupted) gather_p3 ;; esac
  case ${PSTATE[4]:-} in running|done|failed|interrupted) gather_p4 ;; esac
  if [ -n "${PSTATE[5]:-}" ] || [ "$ALL" = 1 ]; then gather_p5; fi
  for n in 1 2 3 4 5 6; do PRES[n]=$(phase_result "$n" | san); done

  # credentials (log lines only; the credentials file is never opened)
  WAIT_CRED=no; WAIT_LINE=""
  if [ -n "${ST[WAITING_FOR_CREDENTIALS]:-}" ] && [ "${ST[WAITING_FOR_CREDENTIALS]}" != none ]; then WAIT_CRED=yes; fi
  last=$(grep -an 'WAITING FOR CREDENTIALS' "$LOG" 2>/dev/null | tail -n 1)
  if [ -n "$last" ]; then
    WAIT_LINE=$(printf '%s' "${last#*WAITING FOR CREDENTIALS: }" | san)
    n=$(grep -anE 'credentials are valid again|gave up waiting for credentials' "$LOG" 2>/dev/null | tail -n 1 | cut -d: -f1)
    if [ "$WAIT_CRED" = no ] && [ "${last%%:*}" -gt "${n:-0}" ] && [ "$CH_ALIVE" = yes ]; then WAIT_CRED=yes; fi
  fi
  line=$(grep -a 'expected to expire about' "$LOG" 2>/dev/null | tail -n 1)
  CRED_EXPIRE=$(rx "$line" 'expire about ([0-9T:Z-]+)'); CRED_LEFT=""
  if [ -n "$CRED_EXPIRE" ]; then CRED_LEFT=$(($(iso_epoch "$CRED_EXPIRE") - NOW)); fi

  # isolation
  ISO="none"
  if [ -n "$V" ]; then
    for s in "$V"/real-* "$V"/pilot-*; do
      [ -f "$s/isolation-gate.json" ] || continue
      if [ "$(jq -r '.ok' "$s/isolation-gate.json" 2>/dev/null)" = false ]; then ISO="FOUND in gate of $(basename "$s")"; break; fi
    done
  fi
  if [ "$ISO" = none ]; then
    for s in "$LOG" "$RERUN_LOG" "$SB_LOG"; do
      line=$(awk '/run-after-capability started, pid|STUDY: |resuming study|new study/ { last = "" } /ISOLATION FAILURE/ { last = $0 } END { print last }' "$s" 2>/dev/null | san | head -n 1)
      if [ -n "$line" ]; then ISO="FOUND in $(basename "$s"): $line"; break; fi
    done
  fi

  # FAILED lines
  FAILED_LINES="none"
  line=$(failed_line "$LOG" 'run-after-capability started, pid')
  [ -z "$line" ] && [ -f "$RERUN_LOG" ] && line=$(failed_line "$RERUN_LOG" 'STUDY: ')
  [ -z "$line" ] && [ -n "${PSTATE[5]:-}" ] && line=$(failed_line "$SB_LOG" 'resuming study|new study')
  [ -n "$line" ] && FAILED_LINES=$line

  # active log, idleness, last 5 lines
  ACTIVE_LOG=""
  case $CUR in
    2) ACTIVE_LOG=$P2_TEST_LOG ;;
    3) ACTIVE_LOG=$RERUN_LOG ;;
    4) [ -n "$P4_CUR" ] && [ -f "$STATE_DIR/judge-capability-$P4_CUR.log" ] && ACTIVE_LOG=$STATE_DIR/judge-capability-$P4_CUR.log
       [ -n "$ACTIVE_LOG" ] || ACTIVE_LOG=$(find "$STATE_DIR" -maxdepth 1 -name 'judge-capability-*.log' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2-); [ -n "$ACTIVE_LOG" ] || ACTIVE_LOG=$LOG ;;
    5) ACTIVE_LOG=$SB_LOG ;;
    *) ACTIVE_LOG=$LOG ;;
  esac
  [ -f "$ACTIVE_LOG" ] || ACTIVE_LOG=$LOG
  mt=$(mtime "$ACTIVE_LOG"); IDLE_S=$((NOW - mt)); [ "$mt" -eq 0 ] && IDLE_S=-1
  STALL=no
  if [ "$CH_ALIVE" = yes ] && [ "${PSTATE[CUR]:-}" = running ] && [ "$CUR" -ge 2 ] && [ "$CUR" -le 5 ] && [ "$WAIT_CRED" = no ] && [ "$IDLE_S" -gt $((STALL_MIN * 60)) ]; then STALL=yes; fi
  line=$(grep -a '^\[' "$ACTIVE_LOG" 2>/dev/null | tail -n 5 | san)
  [ -n "$line" ] || line=$(tail -n 5 "$ACTIVE_LOG" 2>/dev/null | san)
  mapfile -t LOGTAIL <<<"$line"
  [ -z "$line" ] && LOGTAIL=()

  # disk and stray processes
  DISK_FREE=$(df -Pk "$DISK_PATH" 2>/dev/null | awk 'NR == 2 { printf "%.1f", $4 / 1048576 }')
  DISK_USED=$(df -Pk "$DISK_PATH" 2>/dev/null | awk 'NR == 2 { print $5 }')
  RES_FS=""
  if [ -n "${ST[P5_results]:-}" ] && [ -d "${ST[P5_results]}" ]; then RES_FS="${ST[P5_results]}: $(df -Pk "${ST[P5_results]}" 2>/dev/null | awk 'NR == 2 { printf "%.1f GB free", $4 / 1048576 }')"; fi
  other_re=${MON_PROC_RE:-'bench/runner/bench[.]js|run-real-pilot|run-skill-bench|run-after-capability|run-judging'}
  OTHER=$(ps -eo pid=,ppid=,etimes=,args= 2>/dev/null | awk -v root="${CH_PID:-0}" -v alive="$CH_ALIVE" -v me="$$" -v re="$other_re" '
    { p = $1; pp[p] = $2; el[p] = $3; c = $0; sub(/^ *[0-9]+ +[0-9]+ +[0-9]+ +/, "", c); cmd[p] = c; ids[++n] = p }
    END {
      if (alive == "yes") desc[root] = 1
      ch = 1; while (ch) { ch = 0; for (i = 1; i <= n; i++) { p = ids[i]; if (!(p in desc) && (pp[p] in desc)) { desc[p] = 1; ch = 1 } } }
      for (i = 1; i <= n; i++) {
        p = ids[i]; if ((p in desc) || p == me || p == root) continue
        if (cmd[p] ~ /^(tail|less|more|vim?|nano|cat|grep|rg|sed|awk|watch|ps|bash [^ ]*monitor\.sh)/) continue
        if (cmd[p] ~ /^[^ ]*(zsh|bash|sh|dash) +-[a-z]*c /) continue
        if (cmd[p] ~ re) print p "\t" el[p] "\t" substr(cmd[p], 1, 90)
      }
    }')
  OTHER_N=0; [ -n "$OTHER" ] && OTHER_N=$(printf '%s\n' "$OTHER" | wc -l)

  # timeouts / errors in the current phase
  TE_COUNT=0; TE_TEXT="nothing running"
  case $CUR in
    3) TE_COUNT=$((P3_TO + P3_BAD)); TE_TEXT="$P3_TO timeouts, $P3_BAD other non-success (of $P3_RUNS runs)" ;;
    4) TE_COUNT=$((P4_ERR + P4_PF)); TE_TEXT="$P4_ERR judge errors, $P4_PF parse failures" ;;
    5) TE_COUNT=$((SB_LTO + SB_LOT)); TE_TEXT="$SB_LTO timeouts, $SB_LOT other non-success (of $SB_LT logged runs)" ;;
    1|2|6) TE_TEXT="none expected in this phase" ;;
  esac

  gather_doing
  gather_verdict
}

# ---------------------------------------------------------------- what is going on, progress, detail
gather_doing() {
  local el age re n s t1 lines
  DOING=""; PG_DONE=0; PG_TOTAL=0; PG_UNIT=""; ETA_S=""; DETAIL=()
  if [ "$NOT_STARTED" = 1 ]; then DOING="the chain has not started (no state file at $STATEFILE)"; return 0; fi
  case $CUR in
    1)
      DOING="waiting for the capability study to finish (the chain polls every 60 s)"
      t1=$(tail -n 1 "$STATE_DIR/real-pilot.log" 2>/dev/null | san)
      DETAIL+=("study last log line: $(clip "${t1:-(none)}" 90)") ;;
    2)
      el=$(mtime "$P2_TEST_LOG"); lines=$(cnt '' "$P2_TEST_LOG")
      DOING="applying the two patches and running the bench suite (test log updated $(fmt_dur $((NOW - el))) ago, $lines lines)"
      t1=$(tail -n 1 "$P2_TEST_LOG" 2>/dev/null | san)
      DETAIL+=("last test-log line: $(clip "${t1:-(empty)}" 90)") ;;
    3)
      PG_DONE=$P3_RUNS; PG_TOTAL=$P3_TOTAL; PG_UNIT=runs
      case $LR3_STATE in
        running) DOING="rerunning autonomy task ${LR3_TASK:-?} (dir ${P3_CUR_DIR}/${P3_DIRS}): arm ${LR3_ARM:-?}, replicate #${LR3_REP:-?}, running for $(fmt_dur $((NOW - LR3_AT)))$([ "$P3_TMO" -gt 0 ] && echo " of a $(fmt_dur "$P3_TMO") timeout")" ;;
        between) DOING="rerunning autonomy task ${LR3_TASK:-?} (dir ${P3_CUR_DIR}/${P3_DIRS}): finished ${LR3_ARM:-?} #${LR3_REP:-?} $(fmt_dur $((NOW - LR3_AT))) ago, starting the next run" ;;
        *) DOING="autonomy rerun starting (no run logged yet in $(basename "$RERUN_LOG"))" ;;
      esac
      if [ "$P3_RUNS" -ge 3 ] && [ "$PH_ELAPSED" -gt 0 ] && [ "$P3_RUNS" -lt "$P3_TOTAL" ]; then
        ETA_S=$((PH_ELAPSED * (P3_TOTAL - P3_RUNS) / P3_RUNS))
      fi
      DETAIL+=("task dirs done ${P3_DIRS_DONE}/${P3_DIRS} | runs done ${P3_RUNS}/${P3_TOTAL} | credits charged so far ${P3_CRED}")
      DETAIL+=("runs per arm: ${P3_ARMS:-none yet}")
      DETAIL+=("askedUser=${P3_ASKED} | questionsAsked: ${P3_QRUNS} run(s), ${P3_QSUM} question(s) | turns==2: ${P3_T2}  (all of ${P3_RUNS} runs so far)")
      DETAIL+=("run status: ${P3_OK} success, ${P3_TO} timeout, ${P3_BAD} other | before the rerun: ${ST[P3_before]:-n/a}") ;;
    4)
      PG_DONE=$P4_JN; PG_TOTAL=$P4_JT; PG_UNIT="dirs judged"
      re='\] P4: (.*)$'
      if [ "$WAIT_CRED" = yes ]; then DOING="paused: waiting for fresh credentials before judging ${P4_CUR:-the next dir}"
      elif [[ ${P4_LASTLINE} == *"report "* ]]; then DOING="all dirs judged; building the free reports ($(rx "$P4_LASTLINE" "$re"))"
      elif [ -n "$P4_CUR" ] && [ "${PSTATE[4]}" = running ]; then
        age=""; [ "$P4_CUR_LAST" -gt 0 ] && age=", last call $(fmt_dur $((NOW - P4_CUR_LAST))) ago"
        DOING="judging $P4_CUR (dir $((P4_JN + 1)) of $P4_JT): $P4_CUR_CALLS judge calls so far, $P4_CUR_BAD not ok$age"
      else DOING="judging: $(rx "$P4_LASTLINE" "$re")"; fi
      if [ "$P4_JN" -ge 1 ] && [ "$PH_ELAPSED" -gt 0 ] && [ "$P4_JN" -lt "$P4_JT" ]; then ETA_S=$((PH_ELAPSED * (P4_JT - P4_JN) / P4_JN)); fi
      DETAIL+=("dirs judged ${P4_JN}/${P4_JT} | judge calls ${P4_CALLS_ALL} | judge USD spent ${P4_USD} | parse failures ${P4_PF} | judge errors ${P4_ERR}")
      DETAIL+=("calls per task dir (* = current): ${P4_PERDIR:-none yet}")
      DETAIL+=("last chain line: $(rx "$P4_LASTLINE" "$re")") ;;
    5)
      PG_DONE=$SB_WD; PG_TOTAL=$SB_WT; PG_UNIT=waves
      case $LR5_STATE in
        running) n="run ${LR5_ARM:-?} / ${LR5_TASK:-?} #${LR5_REP:-?} for $(fmt_dur $((NOW - LR5_AT)))" ;;
        between) n="last run ${LR5_ARM:-?} / ${LR5_TASK:-?} #${LR5_REP:-?} finished $(fmt_dur $((NOW - LR5_AT))) ago" ;;
        *) n="no run logged yet" ;;
      esac
      if [ "$WAIT_CRED" = yes ]; then DOING="paused: waiting for fresh credentials for the skill bench"
      else DOING="skill bench stage 1: ${SB_NOWSKILL:-controls first}; $n"; fi
      if [ "$SB_WD" -ge 1 ] && [ "$PH_ELAPSED" -gt 0 ] && [ "$SB_WD" -lt "$SB_WT" ]; then ETA_S=$((PH_ELAPSED * (SB_WT - SB_WD) / SB_WD)); fi
      DETAIL+=("controls: ${SB_CONTROLS:-not run yet} | waves ${SB_WD}/${SB_WT} | runs logged ${SB_RUNS:-0} | credits ${SB_CREDITS:-0}")
      DETAIL+=("log run results: ${SB_LOK} success, ${SB_LTO} timeout, ${SB_LOT} other (of ${SB_LT})")
      [ -n "$SB_CTX" ] && DETAIL+=("latest wave line: $SB_CTX")
      if [ -n "$SB_DEC_N" ]; then DETAIL+=("decisions: $SB_DEC_N (${SB_DECIDE:-no decisions.md yet})")
      elif [ -n "$SB_DECIDE" ]; then DETAIL+=("decisions.md is present: $SB_DECIDE")
      else DETAIL+=("decisions: not available yet (decisions/decisions.md appears when the study ends)"); fi ;;
    6)
      DOING="writing the final summary"
      if [ "$DONE_N" -ge 6 ]; then DOING="finished: all phases complete"; PG_DONE=6; PG_TOTAL=6; PG_UNIT=phases; fi
      DETAIL+=("summary: $SUMMARY$([ -f "$SUMMARY" ] || echo ' (not written yet)')")
      [ -f "$SUMMARY" ] && DETAIL+=("summary last line: $(tail -n 1 "$SUMMARY" 2>/dev/null | san)") ;;
    *) DOING="nothing running" ;;
  esac
  s=${PSTATE[CUR]:-}
  case $s in
    failed) DOING="stopped: P${CUR} ${PN[CUR]} FAILED - ${ST[P${CUR}_reason]:-no reason recorded}" ;;
    interrupted) DOING="stopped: P${CUR} ${PN[CUR]} was interrupted (chain was told to stop)" ;;
  esac
  if [ -z "$s" ] && [ "$CUR" -gt 0 ] && [ "$DONE_N" -lt 6 ]; then DOING="between phases: P${CUR} ${PN[CUR]} has not started yet"; fi
  return 0
}

# ---------------------------------------------------------------- verdict
gather_verdict() {
  local why=() todo=() n bad="" lowdisk
  VERDICT=OK; WHY=""; TODO=""
  if [ "$NOT_STARTED" = 1 ]; then
    VERDICT=ATTENTION; WHY="the chain has not been started (no state file)"; TODO="start it: bash $AC_SCRIPT"; return
  fi
  for n in 1 2 3 4 5 6; do [ "${PSTATE[n]:-}" = failed ] && bad="P$n ${PN[n]}"; done
  if [ "${FINAL:-}" = DONE ] || { [ "$DONE_N" -ge 6 ] && [ -z "$bad" ]; }; then
    VERDICT=DONE; WHY="all six phases are complete"; TODO="read $SUMMARY"; return
  fi
  if [ -n "$bad" ] || [[ ${FINAL:-} == FAILED* ]]; then
    VERDICT=FAILED; WHY="${bad:-${FINAL}}: ${ST[P${CUR}_reason]:-see the log}"
    TODO="fix the cause, then resume with: bash $AC_SCRIPT (finished phases are skipped)"; return
  fi
  if [ "$CH_ALIVE" != yes ]; then
    why+=("chain not running (final='${FINAL:-?}', P${CUR} is '${PSTATE[CUR]:-?}')")
    todo+=("resume it: bash $AC_SCRIPT")
  fi
  if [ "$WAIT_CRED" = yes ]; then why+=("waiting for credentials"); todo+=("re-vend the credentials to the path in the chain log; the chain resumes by itself"); fi
  if [ "$ISO" != none ]; then why+=("ISOLATION FAILURE"); todo+=("stop and inspect; do not run konductor install or update during the study"); fi
  if [ "$TE_COUNT" -gt 0 ]; then why+=("$TE_COUNT timeouts/errors/parse failures in P${CUR}"); todo+=("look at $(basename "$ACTIVE_LOG"); results with timeouts stay in the study and are reported, decide after the phase"); fi
  if [ "$STALL" = yes ]; then why+=("no log output for $(fmt_dur "$IDLE_S")"); todo+=("check the process is alive: ps -ef | grep -E 'bench|judge'"); fi
  lowdisk=$(awk -v f="${DISK_FREE:-99}" 'BEGIN { print (f + 0 < 3) ? "yes" : "no" }')
  if [ "$lowdisk" = yes ]; then why+=("$DISK_PATH low: ${DISK_FREE} GB free"); todo+=("free space under $DISK_PATH"); fi
  if [ "$OTHER_N" -gt 0 ]; then why+=("$OTHER_N stray bench process(es)"); todo+=("check pid $(printf '%s\n' "$OTHER" | head -n 1 | cut -f1); it can disturb the study"); fi
  if [ "$FAILED_LINES" != none ]; then why+=("FAILED line in logs"); todo+=("read: $(clip "$FAILED_LINES" 80)"); fi
  if [ "${#why[@]}" -gt 0 ]; then
    VERDICT=ATTENTION
    WHY=$(printf '%s; ' "${why[@]}"); WHY=${WHY%; }
    TODO=${todo[0]}
    [ "${#todo[@]}" -gt 1 ] && TODO="$TODO (+$((${#todo[@]} - 1)) more: ${todo[1]})"
  else
    WHY="chain alive, P${CUR} ${PN[CUR]} progressing"
    [ "$CUR" -eq 1 ] && WHY="chain alive, waiting for the capability study"
    TODO="nothing; check again later or run: bash $SELF --watch"
  fi
}

# ---------------------------------------------------------------- render
OUT=""
emit() { OUT+="$1"$'\n'; }
row() { emit "$(clip "$(printf '%-9s%s' "$1" "$2")")"; }

mark_of() {
  case $1 in done) printf '[x]' ;; running) printf '[>]' ;; failed) printf '[!]' ;; skipped) printf '[-]' ;; interrupted) printf '[~]' ;; *) printf '[ ]' ;; esac
}

render() {
  local n s st left eta_txt exp_txt d
  OUT=""
  emit "=== KONDUCTOR PIPELINE MONITOR ===  $(date -u -d "@$NOW" '+%Y-%m-%d %H:%M:%S') UTC"
  if [ "$NOT_STARTED" = 1 ]; then
    row CHAIN "not started (no state file: $STATEFILE)"
  elif [ "$CH_ALIVE" = yes ]; then
    row CHAIN "ALIVE pid $CH_PID, up $(fmt_dur "$CH_UP") | now P${CUR} ${PN[CUR]}$([ "$PH_ELAPSED" -gt 0 ] && echo ", $(fmt_dur "$PH_ELAPSED") in phase") | final=${FINAL:-?}"
  elif [ "${FINAL:-}" = DONE ]; then
    row CHAIN "FINISHED (final=DONE); the chain has exited normally"
  else
    row CHAIN "NOT RUNNING | final=${FINAL:-?} | P${CUR} ${PN[CUR]} is '${PSTATE[CUR]:-?}'"
  fi
  row PHASES "$(bar "$DONE_N" 6 24) $DONE_N of 6 phases done"
  for n in 1 2 3 4 5 6; do
    s=${PSTATE[n]:-}; st=${s:-pending}
    emit "$(clip "$(printf '  %s P%d %-10s %-11s %s' "$(mark_of "$s")" "$n" "${PN[n]}" "$st" "${PRES[n]}")" | sed 's/ *$//')"
  done
  row DOING "$DOING"
  if [ "$CUR" -eq 0 ]; then
    row PROGRESS "nothing to report yet"
  elif [ "$PG_TOTAL" -gt 0 ]; then
    eta_txt=""
    [ -n "$ETA_S" ] && eta_txt=" | ETA ~$(fmt_dur "$ETA_S") (about $(hhmm_at $((NOW + ETA_S))))"
    row PROGRESS "P${CUR} $(bar "$PG_DONE" "$PG_TOTAL" 30) $PG_DONE/$PG_TOTAL $PG_UNIT, $(pct "$PG_DONE" "$PG_TOTAL")%$eta_txt"
  else
    row PROGRESS "P${CUR} ${PN[CUR]:-}: no countable progress in this phase"
  fi
  for d in "${DETAIL[@]}"; do emit "$(clip "$(printf '         %s' "$d")")"; done
  left=""; exp_txt=""
  if [ -n "$CRED_EXPIRE" ]; then
    if [ "${CRED_LEFT:-0}" -gt 0 ]; then left="in $(fmt_dur "$CRED_LEFT")"; [ "$CRED_LEFT" -lt 1800 ] && left="$left, SOON"; else left="already past"; fi
    exp_txt="  (credentials hint: expire about $(hhmm_at "$(iso_epoch "$CRED_EXPIRE")"), $left)"
  fi
  row HEALTH "ISOLATION FAILURE: $ISO"
  if [ "$WAIT_CRED" = yes ]; then
    emit "$(clip "         WAITING FOR CREDENTIALS: YES (re-vend the credentials to the path shown)  $WAIT_LINE")"
  else emit "$(clip "         WAITING FOR CREDENTIALS: no$exp_txt")"; fi
  emit "$(clip "         FAILED lines: $FAILED_LINES")"
  emit "$(clip "         timeouts/errors in $([ "$CUR" -gt 0 ] && echo "P$CUR" || echo "current phase"): $TE_TEXT")"
  emit "$(clip "         disk: $DISK_PATH ${DISK_FREE:-?} GB free (${DISK_USED:-?} used)${RES_FS:+ | results $RES_FS} | last log output $([ "$IDLE_S" -ge 0 ] && echo "$(fmt_dur "$IDLE_S") ago" || echo "none yet")")"
  if [ "$OTHER_N" -gt 0 ]; then
    emit "$(clip "         other bench processes (not the chain): $OTHER_N, first: pid $(printf '%s\n' "$OTHER" | head -n 1 | awk -F'\t' '{ print $1 ": " $3 }')")"
  else emit "         other bench processes (not the chain): none"; fi
  emit "-- last 5 lines of $(basename "$ACTIVE_LOG")"
  for d in "${LOGTAIL[@]}"; do emit "$(clip "  $d")"; done
  row VERDICT "$VERDICT: $WHY"
  if [ "$VERDICT" != OK ] && [ "$VERDICT" != DONE ]; then row TO-DO "$TODO"; fi
  [ "$ALL" = 1 ] && render_all
  printf '%s' "$OUT"
}

render_all() {
  local d n names_txt="" m
  emit ""
  emit "=== CAPABILITY STUDY SUMMARY (--all) ==="
  if [ -z "$V" ]; then emit "  study dir: not found ${V_NOTE:+($V_NOTE)}"; else
    n=0; m=0
    for d in "$V"/real-* "$V"/pilot-*; do [ -f "$d/summary.json" ] && n=$((n + 1)); [ -f "$d/judgments.json" ] && m=$((m + 1)); done
    emit "  study dir: $V"
    emit "  task dirs complete: $n | judged (judgments.json present): $m"
    if [ -d "$V/reports-judged" ]; then
      for d in "$V"/reports-judged/*/; do [ -d "$d" ] && names_txt+="$(basename "$d") "; done
      emit "  judged reports: $V/reports-judged/ (${names_txt:-empty})"
    else emit "  judged reports: not built yet ($V/reports-judged missing)"; fi
  fi
  if [ -s "$PILOT_SUMMARY" ]; then
    emit "  judging summary: $PILOT_SUMMARY"
    while IFS= read -r d; do emit "    $d"; done < <(grep -a '^Total judge spend' "$PILOT_SUMMARY" 2>/dev/null | head -n 1 | san)
    while IFS= read -r d; do emit "$(clip "$d")"; done < <(awk '/^Orchestrator pass rule/ { f = 1; next } /^Platform verdict/ { f = 0 } f && /^- / { print "    " $0 }' "$PILOT_SUMMARY" 2>/dev/null | san | head -n 8)
  else emit "  judging summary: not written yet ($PILOT_SUMMARY)"; fi
  if [ -f "$SUMMARY" ]; then emit "  chain summary: $SUMMARY"; else emit "  chain summary: not written yet"; fi
  emit "  P3 before the rerun: ${ST[P3_before]:-n/a} | after: ${ST[P3_after]:-n/a}"
  emit "  P3 earlier results kept in: ${ST[P3_dest]:-n/a}"
  if [ -n "$SBV" ]; then
    emit "  skill bench study: $SBV"
    if [ -f "$SBV/decisions/decisions.json" ]; then
      while IFS= read -r d; do emit "$d"; done < <(jq -r '.decisions[]? | "    \(.name): \(.decision) (\(.confidence))"' "$SBV/decisions/decisions.json" 2>/dev/null | san | head -n 14)
    fi
  else emit "  skill bench study: none yet"; fi
}

# ---------------------------------------------------------------- JSON
json_out() {
  local n phases d logtail all_json="null" others
  J=()
  ja() { J+=(--arg "$1" "${2:-}"); }
  jn() { J+=(--argjson "$1" "$(num "${2:-}")"); }
  phases=$(for n in 1 2 3 4 5 6; do
    jq -nc --arg id "P$n" --arg name "${PN[n]}" --arg state "${PSTATE[n]:-pending}" --arg started "${ST[P${n}_started]:-}" \
      --arg finished "${ST[P${n}_finished]:-}" --arg result "${PRES[n]:-}" '{id: $id, name: $name, state: $state, started: $started, finished: $finished, result: $result}'
  done | jq -s .)
  logtail=$(printf '%s\n' "${LOGTAIL[@]}" | jq -R . | jq -s .)
  [ "${#LOGTAIL[@]}" -eq 0 ] && logtail='[]'
  d=$(printf '%s\n' "${DETAIL[@]}" | jq -R . | jq -s .)
  [ "${#DETAIL[@]}" -eq 0 ] && d='[]'
  others=$(printf '%s' "$OTHER" | jq -R -s 'split("\n") | map(select(length > 0) | split("\t") | {pid: .[0], uptime_s: (.[1]|tonumber? // null), cmd: .[2]})')
  if [ "$ALL" = 1 ]; then
    all_json=$(jq -n --arg study "$V" --arg reports "$([ -d "$V/reports-judged" ] && echo "$V/reports-judged" || true)" \
      --arg judging_summary "$([ -s "$PILOT_SUMMARY" ] && echo "$PILOT_SUMMARY" || true)" --arg chain_summary "$([ -f "$SUMMARY" ] && echo "$SUMMARY" || true)" \
      --arg skill_study "$SBV" --arg decisions_md "$SB_DECIDE" --arg decisions "$SB_DEC_N" --arg p3_before "${ST[P3_before]:-}" --arg p3_after "${ST[P3_after]:-}" \
      '{study: $study, reports_judged: $reports, judging_summary: $judging_summary, chain_summary: $chain_summary, skill_study: $skill_study, decisions_md: $decisions_md, decisions: $decisions, p3_before: $p3_before, p3_after: $p3_after}')
  fi
  ja now_iso "$NOW_ISO"; jn now "$NOW"
  ja ch_alive "$CH_ALIVE"; ja ch_pid "$CH_PID"; jn ch_up "$CH_UP"; ja final "$FINAL"; ja started "$STARTED_AT"
  ja cur_name "${PN[CUR]:-}"; jn cur "$CUR"; jn ph_elapsed "$PH_ELAPSED"; ja doing "$DOING"
  jn pg_done "$PG_DONE"; jn pg_total "$PG_TOTAL"; ja pg_unit "$PG_UNIT"; jn pg_pct "$(pct "$PG_DONE" "$PG_TOTAL")"; jn eta_s "$ETA_S"
  jn p3_runs "$P3_RUNS"; jn p3_total "$P3_TOTAL"; jn p3_dirs "$P3_DIRS"; jn p3_dirs_done "$P3_DIRS_DONE"; jn p3_asked "$P3_ASKED"
  jn p3_qruns "$P3_QRUNS"; jn p3_qsum "$P3_QSUM"; jn p3_t2 "$P3_T2"; jn p3_timeouts "$P3_TO"; jn p3_other "$P3_BAD"; jn p3_credits "$P3_CRED"; ja p3_arms "$P3_ARMS"
  jn p4_total "$P4_TOTAL"; jn p4_judged "$P4_JN"; jn p4_calls "$P4_CALLS_ALL"; jn p4_usd "$P4_USD"; jn p4_pf "$P4_PF"; jn p4_err "$P4_ERR"; ja p4_current "$P4_CUR"; ja p4_perdir "$P4_PERDIR"
  ja p5_controls "$SB_CONTROLS"; jn p5_wd "$SB_WD"; jn p5_wt "$SB_WT"; jn p5_runs "$SB_RUNS"; jn p5_credits "$SB_CREDITS"; ja p5_decisions "$SB_DEC_N"; ja p5_decisions_md "$SB_DECIDE"
  ja iso "$ISO"; ja wait_cred "$WAIT_CRED"; ja wait_line "$WAIT_LINE"; ja cred_expire "$CRED_EXPIRE"; jn cred_left "$CRED_LEFT"
  ja failed_lines "$FAILED_LINES"; ja te_text "$TE_TEXT"; jn te_count "$TE_COUNT"; jn disk_free "$DISK_FREE"; ja disk_used "$DISK_USED"; ja res_fs "$RES_FS"
  jn idle_s "$IDLE_S"; ja stall "$STALL"; ja active_log "$ACTIVE_LOG"
  ja verdict "$VERDICT"; ja why "$WHY"; ja todo "$TODO"
  jq -n "${J[@]}" --argjson phases "$phases" --argjson detail "$d" --argjson logtail "$logtail" --argjson others "$others" --argjson all "$all_json" '
    { time_utc: $now_iso, epoch: $now,
      chain: { alive: ($ch_alive == "yes"), pid: (if $ch_pid == "" then null else ($ch_pid | tonumber) end), uptime_s: $ch_up, final: $final, started: $started },
      current: { phase_number: $cur, phase: $cur_name, elapsed_s: $ph_elapsed, doing: $doing,
                 progress: { done: $pg_done, total: $pg_total, unit: $pg_unit, percent: $pg_pct, eta_s: $eta_s } },
      phases: $phases,
      detail: $detail,
      p3: { runs: $p3_runs, runs_total: $p3_total, task_dirs: $p3_dirs, task_dirs_done: $p3_dirs_done, askedUser: $p3_asked,
            runs_with_questionsAsked: $p3_qruns, questionsAsked_total: $p3_qsum, runs_with_turns_2: $p3_t2,
            timeouts: $p3_timeouts, other_non_success: $p3_other, credits_charged: $p3_credits, runs_per_arm: $p3_arms },
      p4: { task_dirs: $p4_total, judged_dirs: $p4_judged, judge_calls: $p4_calls, judge_usd: $p4_usd, parse_failures: $p4_pf,
            judge_errors: $p4_err, current_dir: $p4_current, calls_per_dir: $p4_perdir },
      p5: { controls: $p5_controls, waves_done: $p5_wd, waves_total: $p5_wt, runs_logged: $p5_runs, credits: $p5_credits,
            decisions: $p5_decisions, decisions_md: $p5_decisions_md },
      health: { isolation_failure: $iso, waiting_for_credentials: ($wait_cred == "yes"), credential_log_line: $wait_line,
                credentials_expire_hint: $cred_expire, credentials_seconds_left: $cred_left, failed_lines: $failed_lines,
                timeouts_errors: { count: $te_count, text: $te_text }, disk_tmp_free_gb: $disk_free, disk_tmp_used: $disk_used,
                results_fs: $res_fs, seconds_since_log_output: $idle_s, stalled: ($stall == "yes"), other_bench_processes: $others },
      log: { file: $active_log, last5: $logtail },
      verdict: { status: $verdict, why: $why, todo: $todo },
      all: $all }'
}

# ---------------------------------------------------------------- frames and main loop
make_frame() { gather; if [ "$JSON" = 1 ]; then json_out; else render; fi; }
save_frame() { [ "$SAVE" = 1 ] && printf '%s\n' "$1" > "$SNAPSHOT" 2>/dev/null; return 0; }

if [ "$MODE" = once ]; then
  frame=$(make_frame)
  printf '%s\n' "$frame"
  save_frame "$frame"
  exit 0
fi

cleanup_watch() { printf '\033[?25h\n'; exit 0; }
trap cleanup_watch INT TERM
printf '\033[?25l\033[2J'
while :; do
  t0=$(date +%s)
  frame=$(make_frame)
  save_frame "$frame"
  printf '\033[H'
  printf '%s\n' "$frame" | sed $'s/$/\033[K/'
  printf '(refresh every %ss, Ctrl-C to exit, frame took %ss)\033[K\n\033[J' "$WATCH_S" "$(($(date +%s) - t0))"
  sleep "$WATCH_S" &
  wait $!
done
