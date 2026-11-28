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
# D-302: spent and judge-spent sum through the bench's one ledger helper (runner/lib/credit-ledger.js sumLedgers), so
# they work with a stub R that has no credit-ledger.js, and skip an agent's workspace.
mkdir -p "$T/led/a/workspace" "$T/led/b"
printf '%s\n' '{"kind":"run","credits":1.5}' > "$T/led/a/credit-ledger.jsonl"
printf '%s\n' '{"kind":"run","credits":9}' > "$T/led/a/workspace/credit-ledger.jsonl"
printf '%s\n' '{"kind":"judge","unit":"usd","credits":0,"usd":0.012}' '{"kind":"run","credits":2}' > "$T/led/b/credit-ledger.jsonl"
out=$(node "$HERE/lite-helper.js" spent "$T/R" "$T/led" 2>&1 || true)
[ "$out" = '{"credits":3.5,"unknown":0}' ] && echo "ok   spent sums run credits through sumLedgers" || { echo "FAIL spent: $out"; fails=1; }
out=$(node "$HERE/lite-helper.js" judge-spent "$T/led" 2>&1 || true)
[ "$out" = '0.012' ] && echo "ok   judge-spent sums USD through sumLedgers" || { echo "FAIL judge-spent: $out"; fails=1; }
rm -rf "$T"
exit "$fails"
