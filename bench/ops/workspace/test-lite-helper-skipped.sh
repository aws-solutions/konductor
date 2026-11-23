#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Stub test of lite-helper.js (DEBT D-160): a budget-skipped row (skipped: true, from a bench pin with paired fill) is not
# counted as a run by `stage` or `summary`. The stub R has a fake pilot-table.js, so no bench checkout is needed.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
T=$(mktemp -d "${KIROCREW_SCRATCH:-/tmp}/lhs.XXXX")
mkdir -p "$T/R/bench/scenarios" "$T/run"
echo '{}' > "$T/run/run-config.json"
cat > "$T/R/bench/scenarios/pilot-table.js" <<'EOF'
module.exports = { pilotRows: () => [
  { arm: 'vanilla', task: 't1', rep: 1, score: 50, flags: {}, credits: 1, loads: [] },
  { arm: 'konductor', task: 't1', rep: 1, score: 70, flags: {}, credits: 2, loads: ['x'] },
  { arm: 'konductor', task: 't1', rep: 2, skipped: true, score: null, flags: {}, credits: 0, loads: [] },
] };
EOF
fails=0
out=$(node "$HERE/lite-helper.js" stage "$T/R" "$T/run")
echo "$out" | grep -q '^konductor: 0 of 1 runs' && echo "ok   stage counts the konductor arm as 1 run, not 2" || { echo "FAIL stage: $out"; fails=1; }
node "$HERE/lite-helper.js" summary "$T/R" "$T/sum.md" "$T/run"
grep -q '| t1 | 50.0 | 70.0 | 20.0 | 1/1 | 0 of 1 |' "$T/sum.md" && echo "ok   summary: no skipped run in the no-load count" || { echo "FAIL summary:"; cat "$T/sum.md"; fails=1; }
rm -rf "$T"
exit "$fails"
