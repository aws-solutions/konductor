#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# judge-standard.sh: the judge pass of STANDARD, after run-standard.sh (Kiro units) and claude-standard.sh (Claude
# Code units). Owner terminal only: paid (USD, Bedrock keys of the AWS_PROFILE_NAME profile).
#
#   S=<study dir> R=<worktree> bash judge-standard.sh --plan   free: bench judge --plan per finished unit; no model call
#   S=<study dir> R=<worktree> AWS_PROFILE_NAME=<profile> bash judge-standard.sh   judge every finished unit, then report
#
# Panel and mode as the LITE judge: gpt-5.6-luna, deepseek-3.2, qwen3-coder-next (no Claude family), rubric mode,
# opencode backend on Bedrock, one call at a time. Cap: USD 25 in all (CAP_USD). Before each unit, spend so far plus
# one unit's worst case (PER_UNIT_WORST) must stay under the cap, and bench's own USD guard (--budget-usd, what is left
# of the cap) checks before every call. Each unit is judged in a copy under judge/runs/, so the raw runs stay as they
# ran; tasks with no judge items stay code-only and are left out of the copy. Task packs are exported at the bench
# commit of the frozen plan. Units: $S/runs/r*/<batch> (Kiro, copied to judge/runs/r<n>-<batch>) and
# $S/claude/runs/r*/<batch> (Claude Code, copied to judge/runs/cc-r<n>-<batch>), judged in one pass so both harnesses
# share a judge day. Reports (free, no model call): judge/report over the Kiro units against vanilla (its three-arm
# section gives konductor minus noskills and noskills minus vanilla, D-54), judge/report-vs-konductor (konductor-list
# minus konductor) and judge/report-vs-noskills (konductor-list minus noskills) over the same units, and
# judge/report-cc, judge/report-cc-vs-konductor and judge/report-cc-vs-noskills over the Claude Code units (the same
# three baselines under the cc- prefix). Rerun to resume:
# judged units are skipped, finished calls are cached. Never beside a pilot, a forced-small run or a held heavy lock:
# it stops instead.
#
# Needs: S, R (as run-standard.sh). Test overrides: HELPER, CAP_USD, PER_UNIT_WORST, HEAVY_LOCK, HOST_CHECK.
set -u

KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=${S:-}
R=${R:-}
LH=${HELPER:-$KIT/helper.js}
CAP_USD=${CAP_USD:-25}
PER_UNIT_WORST=${PER_UNIT_WORST:-0.6}
PROFILE=${AWS_PROFILE_NAME:-default}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
PANEL=gpt-5.6-luna,deepseek-3.2,qwen3-coder-next
J=$ROOT/judge
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }

host_free() {
  flock -n "$HEAVY_LOCK" true 2>/dev/null || { echo "the heavy lock $HEAVY_LOCK is held"; return 1; }
  [ "${HOST_CHECK:-1}" = 0 ] && return 0
  pgrep -f 'run-pilot|run-forced' >/dev/null && { echo "a pilot or forced-small script is running"; return 1; }
  return 0
}

main() {
  local plan_only=0 bench_sha b rep U C t arm spent left rc=0 why extra runs tag B=$J/bench
  local -a units=() judged=() judged_cc=()
  case "${1:-}" in '') ;; --plan) plan_only=1 ;; *) echo "usage: S=DIR R=WORKTREE bash $0 [--plan]"; exit 64 ;; esac
  [ -n "$ROOT" ] && [ -n "$R" ] || stop "set S (the study dir) and R (the STANDARD worktree)"
  [ -s "$ROOT/plan.json" ] || stop "no $ROOT/plan.json: run run-standard.sh first"
  why=$(host_free) || stop "$why; rerun later"
  export TMPDIR=/tmp   # bench refuses a Claude Code or judge scratch dir under HOME (home .claude skills would load)
  bench_sha=$(node -p 'require(process.argv[1]).benchSha' "$ROOT/plan.json")
  mkdir -p "$J/packs" "$J/runs"
  [ -d "$B" ] || git -C "$R" worktree add -q --detach "$B" "$bench_sha" || stop "cannot add a judge worktree at $bench_sha"
  [ "$(git -C "$B" rev-parse HEAD)" = "$(git -C "$B" rev-parse -q --verify "$bench_sha^{commit}")" ] || stop "$B is not at $bench_sha"
  mapfile -t units < <({ find "$ROOT"/runs/r* -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort; find "$ROOT"/claude/runs/r* -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort; })
  [ "${#units[@]}" -gt 0 ] || stop "no run units under $ROOT/runs or $ROOT/claude/runs"
  cd "$B" || exit 1
  for U in "${units[@]}"; do
    b=$(basename "$U"); rep=$(basename "$(dirname "$U")")
    case "$U" in "$ROOT"/claude/*) tag=cc-$rep ;; *) tag=$rep ;; esac
    C=$J/runs/$tag-$b
    [ -e "$U.done" ] || { say "$tag $b: run not finished, left out"; continue; }
    [ -d "$J/packs/$b" ] || git -C "$B" archive "$bench_sha" "bench/scenarios/$b" | tar -x -C "$J/packs" --strip-components=2 || stop "pack export $b"
    if [ "$plan_only" = 1 ]; then
      say "== $tag $b"
      node bench/runner/bench.js judge --run "$U" --extra-tasks "$J/packs/$b" --judges "$PANEL" --mode rubric \
        --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$CAP_USD" --concurrency 1 --plan 2>&1 | tail -n 12
      continue
    fi
    case "$tag" in cc-*) judged_cc+=("$C") ;; *) judged+=("$C") ;; esac
    [ -e "$C.done" ] && { say "$tag $b: judged, skipped"; continue; }
    if [ ! -d "$C" ]; then
      cp -a -- "$U" "$C" || stop "copy $U"
      for t in $(node "$LH" code-only "$B" "$J/packs/$b"); do
        for arm in "$C"/*/; do [ -d "$arm$t" ] && rm -r -- "$arm$t"; done
        grep -qx "$t" "$J/code-only.txt" 2>/dev/null || echo "$t" >> "$J/code-only.txt"
        say "$tag $b: $t has no judge items, code-only"
      done
    fi
    aws sts get-caller-identity --profile "$PROFILE" > /dev/null 2>&1 || stop "AWS credentials for profile $PROFILE expired before $tag $b"
    spent=$(node "$LH" judge-spent "$B" "$J/runs")
    left=$(awk -v s="$spent" -v c="$CAP_USD" -v w="$PER_UNIT_WORST" 'BEGIN { if (s + w > c) print "STOP"; else printf "%.4f", c - s }')
    [ "$left" = STOP ] && stop "spent USD $spent of the USD $CAP_USD cap before $tag $b (one unit may cost USD $PER_UNIT_WORST)"
    say "$tag $b: judging, spent USD $spent, guard USD $left"
    rc=0
    nice -n 19 node bench/runner/bench.js judge --run "$C" --extra-tasks "$J/packs/$b" --judges "$PANEL" --mode rubric \
      --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$left" --concurrency 1 >> "$C-judge.log" 2>&1 || rc=$?
    say "$tag $b: exit $rc, $(grep '^judged' "$C-judge.log" | tail -n 1)"
    [ "$rc" = 0 ] || stop "judge exit $rc on $tag $b (see $C-judge.log); rerun to resume"
    touch "$C.done"
  done
  [ "$plan_only" = 1 ] && { say "plan only: no judge call made. Paid pass: bash $0"; exit 0; }
  [ "${#judged[@]}" -gt 0 ] || [ "${#judged_cc[@]}" -gt 0 ] || stop "no finished unit to report"
  extra=$(find "$J/packs" -mindepth 1 -maxdepth 1 -type d | sort | paste -sd, -)
  if [ "${#judged[@]}" -gt 0 ]; then
    runs=$(printf '%s,' "${judged[@]}"); runs=${runs%,}
    node bench/runner/bench.js report --run "$runs" --baseline vanilla --extra-tasks "$extra" --out "$J/report" > "$J/report.log" 2>&1 \
      || say "report failed: see $J/report.log"
    node bench/runner/bench.js report --run "$runs" --baseline konductor --extra-tasks "$extra" --out "$J/report-vs-konductor" > "$J/report-vs-konductor.log" 2>&1 \
      || say "report against konductor failed: see $J/report-vs-konductor.log"
    node bench/runner/bench.js report --run "$runs" --baseline konductor-noskills --extra-tasks "$extra" --out "$J/report-vs-noskills" > "$J/report-vs-noskills.log" 2>&1 \
      || say "report against noskills failed: see $J/report-vs-noskills.log"
  fi
  if [ "${#judged_cc[@]}" -gt 0 ]; then
    runs=$(printf '%s,' "${judged_cc[@]}"); runs=${runs%,}
    node bench/runner/bench.js report --run "$runs" --baseline cc-vanilla --extra-tasks "$extra" --out "$J/report-cc" > "$J/report-cc.log" 2>&1 \
      || say "Claude Code report failed: see $J/report-cc.log"
    node bench/runner/bench.js report --run "$runs" --baseline cc-konductor --extra-tasks "$extra" --out "$J/report-cc-vs-konductor" > "$J/report-cc-vs-konductor.log" 2>&1 \
      || say "Claude Code report against cc-konductor failed: see $J/report-cc-vs-konductor.log"
    node bench/runner/bench.js report --run "$runs" --baseline cc-konductor-noskills --extra-tasks "$extra" --out "$J/report-cc-vs-noskills" > "$J/report-cc-vs-noskills.log" 2>&1 \
      || say "Claude Code report against cc-konductor-noskills failed: see $J/report-cc-vs-noskills.log"
  fi
  say "judge spend USD $(node "$LH" judge-spent "$B" "$J/runs") of $CAP_USD"
  say "reports: $J/report (Kiro: every arm minus vanilla; konductor - noskills, noskills - vanilla), $J/report-vs-konductor (konductor-list - konductor), $J/report-vs-noskills (konductor-list - noskills) and $J/report-cc, $J/report-cc-vs-konductor, $J/report-cc-vs-noskills (Claude Code, the same three baselines under cc-); DEV, not a verdict"
  say "next: a calibration sheet for a person, node bench/runner/bench.js calibrate export --run $J/runs/<unit> --n 20 --extra-tasks $J/packs/<batch>"
}
main "$@"
