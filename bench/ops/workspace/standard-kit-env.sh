#!/usr/bin/env bash
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
# Sourced by run-standard-v1.sh, run-standard-judge.sh and run-standard-claude.sh: this host's paths for the STANDARD
# kit (bench/scenarios/konductor/standard on feat/bench-pilot-nk), and KIT, the kit copy to run. A study whose first paid start froze
# the kit runs $S/kit; before that, the kit is exported fresh from origin/feat/bench-pilot-nk into $S/kit-src.
WS=$KONDUCTOR_WS
export S=${S:-/var/tmp/konductor-standard-v1}
export R=${R:-$WS/worktrees/standard}
export KBIN=${KBIN:-/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli}
export COST=${COST:-$WS/reports/lock-table-and-lite-proposal-2026-11-21-data/lite.json}
export REPORTS=${REPORTS:-$WS/reports/standard-run-v1}
if [ ! -e "$R/.git" ]; then
  git -C "$WS/worktrees/konductor-debt5" worktree add -q --detach "$R" origin/feat/bench-pilot-nk || { echo "STOP: cannot add $R"; exit 1; }
fi
KIT=$S/kit
if [ ! -f "$KIT/run-standard.sh" ]; then
  KIT=$S/kit-src
  git -C "$R" fetch -q origin feat/bench-pilot-nk || { echo "STOP: fetch failed in $R"; exit 1; }
  mkdir -p "$KIT" && git -C "$R" archive origin/feat/bench-pilot-nk bench/scenarios/konductor/standard | tar -x -C "$KIT" --strip-components=4 \
    || { echo "STOP: cannot export the kit from origin/feat/bench-pilot-nk"; exit 1; }
fi
