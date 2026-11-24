#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Stub test of run-overnight.sh: a fake workspace whose steps only log their call. No wait, no spend, no credentials.
# Checks the step order, the stop at the first failing step, and the give-up after the wait limit.
#   bash bench/ops/workspace/test-run-overnight-stub.sh
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
T=$(mktemp -d "${KIROCREW_SCRATCH:-/tmp}/overnight-stub.XXXX")
trap 'rm -rf "$T"' EXIT
fails=0; ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
mkdir -p "$T/ws/scripts" "$T/ws/reports/next-experiment-2026-11-22"
step() { printf '#!/bin/sh\necho "%s $*" >> "%s/calls"\nexit ${%s:-0}\n' "$1" "$T" "$2" > "$3"; }
step clean-fill RC_FILL "$T/ws/scripts/run-clean-fill.sh"
step cc-judge RC_JUDGE "$T/ws/reports/next-experiment-2026-11-22/run-cc-compare-judge.sh"
run() { KONDUCTOR_WS="$T/ws" OVERNIGHT_WAIT_PAT="${PAT:-no-such-process-$$}" OVERNIGHT_POLL_S=1 MAX_WAIT_MIN="${MAXW:-480}" "$@" bash "$HERE/run-overnight.sh" > "$T/log" 2>&1; }

bash -n "$HERE/run-overnight.sh" && ok "bash -n clean" || bad "syntax"
: > "$T/calls"; run env; rc=$?
[ "$rc" = 0 ] && [ "$(tr '\n' '|' < "$T/calls")" = "clean-fill --go|cc-judge --plan|cc-judge |" ] && ok "steps run in order: fill, judge plan, judge" || bad "order: rc $rc, $(cat "$T/calls")"
grep -q 'no keep-creds-fresh.sh' "$T/log" && ok "no refresher: says so and goes on" || bad "refresher line"
: > "$T/calls"; run env RC_FILL=4; rc=$?
[ "$rc" = 4 ] && [ "$(wc -l < "$T/calls")" = 1 ] && grep -q 'FAILED clean fills and their judges (exit 4): chain stopped' "$T/log" && ok "a failing step stops the chain with its exit" || bad "stop: rc $rc, $(cat "$T/calls")"
sleep 300 & held=$!
: > "$T/calls"; PAT="sleep 300" MAXW=0 run env; rc=$?
kill "$held" 2>/dev/null; wait "$held" 2>/dev/null
[ "$rc" = 3 ] && [ ! -s "$T/calls" ] && grep -q 'still runs after 0 min: giving up' "$T/log" && ok "a study still running at the limit: gives up, starts nothing" || bad "give-up: rc $rc, $(cat "$T/log")"
[ "$fails" = 0 ] && echo "all cases pass" || { echo "$fails case(s) failed"; exit 1; }
