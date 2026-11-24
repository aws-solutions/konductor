#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Re-score the Claude Code study's saved runs with the newest task keys, the way rescore.sh did for the Kiro arms.
# Free: hidden tests and checks only, no model call. Copies each cell (result.json + workspace) under scratch and
# runs the fixed bench's recheck there; the raw runs are not touched.
#   KIROCREW_SCRATCH=... bash rescore-cc.sh   -> $KIROCREW_SCRATCH/rescore-cc/scores.tsv
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/reports sets it)}"
WS=$KONDUCTOR_WS
HERE0=$(cd "$(dirname "$0")" && pwd)
RUNS=${CC_RUNS:-/var/tmp/cc-compare/runs}
FROZEN=$WS/reports/lite-run-2026-11-21/judge/bench/bench
PACKS=$WS/reports/lite-run-2026-11-21/judge/packs
FIXED=${FIXED_BENCH:-${KIROCREW_SCRATCH:?}/keyfix/bench}
OUT=${KIROCREW_SCRATCH:?}/rescore-cc
ARMS=${CC_ARMS:-cc-vanilla cc-konductor}   # run-cc-team.sh: cc-konductor-team
DEST=${CC_SCORES_DEST:-$WS/reports/next-experiment-2026-11-22/cc-scores-newest-keys.tsv}
export TMPDIR=${KIROCREW_SCRATCH:?}/tmp; mkdir -p "$TMPDIR"
# task : batch : newest key version. The report job (python 3.12 gate in its tests) and field inspections (question
# count read from the runner's conversation file) are not rechecked; they are scored from the saved result.json.
TASKS="t8-dec-deploy-strategy:t8:t8-dec-deploy-strategy-v7
t7-program-brief:t7:t7-program-brief-v6
t2-dr-notify-fanout:t2:t2-dr-notify-fanout-v6
t2-arch-dr-split-checkout:t2:t2-arch-dr-split-checkout-v4
t5-qa-checkout-strategy:t5:t5-qa-checkout-strategy-v5
t5-qa-sync-strategy:t5:t5-qa-sync-strategy-v4"
rm -rf "$OUT"; mkdir -p "$OUT/packs-after" "$OUT/runs"
for line in $TASKS; do
  IFS=: read -r task batch vhidden <<<"$line"
  [ -d "$OUT/packs-after/$batch" ] || cp -r "$PACKS/$batch" "$OUT/packs-after/$batch"
  rm -rf "$OUT/packs-after/$batch/hidden/$task"
  cp -r "$FIXED/scenarios/$batch/hidden/$vhidden" "$OUT/packs-after/$batch/hidden/$task"
  node -e '
    const fs = require("node:fs"); const [src, dst, id] = process.argv.slice(1);
    const t = JSON.parse(fs.readFileSync(src, "utf8")); t.id = id; t.hidden = id; if (t.fixture === undefined) t.fixture = id;
    fs.writeFileSync(dst, JSON.stringify(t, null, 2) + "\n");
  ' "$FIXED/scenarios/$batch/$vhidden.json" "$OUT/packs-after/$batch/$task.json" "$task"
done
for line in $TASKS; do
  IFS=: read -r task batch vhidden <<<"$line"
  for arm in $ARMS; do
    for rep in "$RUNS/$task/$arm/$task"/*/; do
      rep=${rep%/}; [ -f "$rep/result.json" ] && [ -d "$rep/workspace" ] || continue
      for phase in before after; do
        dst="$OUT/runs/$phase/cc/$task/$arm/$task/$(basename "$rep")"; mkdir -p "$dst"
        cp "$rep/result.json" "$dst/"; cp -r "$rep/workspace" "$dst/"
      done
    done
  done
  for phase in before after; do cp "$RUNS/$task/run-config.json" "$OUT/runs/$phase/cc/$task/" 2>/dev/null || true; done
  d="$OUT/runs/before/cc/$task"
  node "$FROZEN/runner/bench.js" recheck --run "$d" --bench-dir "$FROZEN" --extra-tasks "$PACKS/$batch" > "$d/recheck.log" 2>&1 || { echo "before recheck failed: $task" >&2; tail -3 "$d/recheck.log" >&2; }
  d="$OUT/runs/after/cc/$task"
  node "$FIXED/runner/bench.js" recheck --run "$d" --bench-dir "$FIXED" --extra-tasks "$OUT/packs-after/$batch" > "$d/recheck.log" 2>&1 || { echo "after recheck failed: $task" >&2; tail -3 "$d/recheck.log" >&2; }
done
node "$HERE0/rescore-table.js" "$OUT" "$FROZEN" > "$OUT/scores.tsv"
cp "$OUT/scores.tsv" "$DEST"
echo "wrote $OUT/scores.tsv and $DEST"
