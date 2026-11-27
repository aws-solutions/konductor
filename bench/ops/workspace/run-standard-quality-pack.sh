#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# run-standard-quality-pack.sh: the quality-dimensions judge pass (bench --criteria-pack quality) over every judged
# STANDARD v2 unit, then a report with the pack beside the rubric scores. Paid (USD, opencode on Bedrock).
#   bash run-standard-quality-pack.sh [--plan]     --plan is free: prints calls and the estimate, calls nothing
# Env: STANDARD_DIR (test override), AWS_PROFILE_NAME (default "default"), CAP_USD (default 25, the whole pass). Owner terminal only.
# judgments.json is not read or changed; each unit gets judgments-quality.json beside it. Rerun resumes (cached).
set -euo pipefail

S=${STANDARD_DIR:-/var/tmp/konductor-standard-v2}   # STANDARD_DIR: tests only
B=$S/judge/bench
J=$S/judge
PANEL=gpt-5.6-luna,deepseek-3.2,qwen3-coder-next
PROFILE=${AWS_PROFILE_NAME:-default}
CAP_USD=${CAP_USD:-25}
PLAN=""; [ "${1:-}" = --plan ] && PLAN=--plan
say() { printf '[%s] %s\n' "$(date -u +%H:%M)" "$*"; }
export TMPDIR=/tmp

[ -d "$B" ] || { say "STOP: no judge bench at $B"; exit 1; }
[ -n "$PLAN" ] || aws sts get-caller-identity --profile "$PROFILE" > /dev/null 2>&1 \
  || { say "STOP: AWS credentials for profile $PROFILE expired; refresh and rerun"; exit 1; }
cd "$B"

spent=0
for U in "$J"/runs/r*-*; do
  [ -d "$U" ] || continue
  tag=$(basename "$U"); batch=${tag#*-}
  [ -e "$U.done" ] || { say "$tag: not judged yet, left out"; continue; }
  left=$(awk -v c="$CAP_USD" -v s="$spent" 'BEGIN { printf "%.4f", c - s }')
  awk -v l="$left" 'BEGIN { exit !(l > 0.5) }' || { say "STOP: cap USD $CAP_USD reached (spent $spent)"; exit 0; }
  say "$tag: quality pack, spent USD $spent, left USD $left"
  log=$J/runs/$tag-quality.log
  nice -n 19 node bench/runner/bench.js judge --run "$U" --extra-tasks "$J/packs/$batch" --judges "$PANEL" \
    --criteria-pack quality --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$left" \
    --concurrency 1 $PLAN > "$log" 2>&1 || { say "$tag: judge exited non-zero, see $log"; tail -n 5 "$log"; exit 1; }
  tail -n 3 "$log"
  if [ -z "$PLAN" ]; then
    u=$(grep -oE 'usd: this command \$[0-9.]+' "$log" | tail -1 | grep -oE '[0-9.]+$' || echo 0)
    spent=$(awk -v s="$spent" -v u="${u:-0}" 'BEGIN { printf "%.4f", s + u }')
  fi
done

[ -n "$PLAN" ] && { say "plan only: nothing was called"; exit 0; }
say "all units done, spent USD $spent of $CAP_USD; writing the report with the pack"
extra=$(find "$J/packs" -mindepth 1 -maxdepth 1 -type d | sort | paste -sd, -)
runs=$(ls -d "$J"/runs/r*-* | grep -v -E '\.(log|done)$' | paste -sd, -)
node bench/runner/bench.js report --run "$runs" --baseline vanilla --extra-tasks "$extra" --criteria-pack quality \
  --out "$J/report-quality" > "$J/report-quality.log" 2>&1 || { say "report failed, see $J/report-quality.log"; exit 1; }
tail -n 3 "$J/report-quality.log"
say "done: $J/report-quality/report.md"
