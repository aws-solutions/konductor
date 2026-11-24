#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Free test of run-nudge-judge.sh --fill's guards. No judge call: each case stops before the first one.
#   case 1: a fill task with no runs-nudge/<task>.done stops, and nothing is judged
#   case 2: a cap over the approved USD 0.5 stops
# Needs the LITE judge worktree of the owner workspace (KONDUCTOR_WS); the study folder is a scratch copy (HERE is not
# read by the judge script, so the test points KONDUCTOR_WS at a scratch workspace that links to the real judge bench).
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace}"
SRC=$(cd "$(dirname "$0")" && pwd)/run-nudge-judge.sh
T=$(mktemp -d "${KIROCREW_SCRATCH:-/var/tmp}/nudge-judge-fill.XXXXXX")
mkdir -p "$T/reports/next-experiment-2026-11-22/runs-nudge/t1-nfr-report-queries" "$T/reports/lite-run-2026-11-21/judge" "$T/scripts"
ln -s "$KONDUCTOR_WS/reports/lite-run-2026-11-21/judge/bench" "$T/reports/lite-run-2026-11-21/judge/bench"
touch "$T/reports/next-experiment-2026-11-22/runs-nudge/t8-dec-deploy-strategy.done"
fail() { echo "FAIL: $*"; exit 1; }

if KONDUCTOR_WS=$T bash "$SRC" --fill > "$T/a.log" 2>&1; then fail "case 1 should stop"; fi
grep -q 't1-nfr-report-queries.done is missing' "$T/a.log" || { cat "$T/a.log"; fail "case 1: wrong stop"; }
[ -z "$(ls "$T/reports/next-experiment-2026-11-22/judge-nudge/runs")" ] || fail "case 1: a judge copy was made"
echo "case 1 ok: a fill task with no .done is not judged"

if CAP_USD_FILL=0.6 KONDUCTOR_WS=$T bash "$SRC" --fill > "$T/b.log" 2>&1; then fail "case 2 should stop"; fi
grep -q 'outside the approved USD 0.5' "$T/b.log" || { cat "$T/b.log"; fail "case 2: wrong stop"; }
echo "case 2 ok: a cap over USD 0.5 is refused"
echo "all judge-fill cases passed (scratch $T)"
