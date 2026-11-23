#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SUPERSEDED by scripts/test-run-full-suite-twice-v2.sh (review 2026-11-23); kept for reference, use the v2 script.
# Stub test of run-full-suite-twice.sh: no real suite, no fetch, no heavy lock. Each case runs the script with a stub
# SUITE_CMD in a fake checkout and checks the exit code and the summary's first line.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
SCRIPT=$HERE/run-full-suite-twice.sh
T=$(mktemp -d "${KIROCREW_SCRATCH:-/tmp}/fst.XXXX")
R=$T/repo
mkdir -p "$R/bench" "$T/leak" "$T/out"
printf '# base set\nknown flaky-free base test\n' > "$R/bench/test-base-set.txt"
fails=0

stub() {   # stub NAME BODY: a suite command that prints BODY; run N is told apart by a counter file
  printf '%s\n' "$2" > "$T/$1.sh"
  echo "bash $T/$1.sh"
}
check() {  # check LABEL WANT_EXIT WANT_TOTAL SUITE_CMD
  local label=$1 want=$2 total=$3 cmd=$4 code=0 out
  rm -rf "$T/out"/*
  R=$R SUITE_CMD=$cmd LOCK=$T/lock OUT_ROOT=$T/out LEAK_DIR=$T/leak RUN_TIMEOUT=${CASE_TIMEOUT:-30} bash "$SCRIPT" > "$T/log" 2>&1 || code=$?
  out=$(head -1 "$T"/out/full-suite-*/summary.txt)
  if [ "$code" = "$want" ] && [ "$out" = "KR k485f5870 reading: $total" ]; then echo "ok   $label"
  else echo "FAIL $label: exit $code (want $want), '$out' (want $total)"; fails=$((fails + 1)); fi
}
TAP_OK='echo "ok 1 - a"; echo "ok 2 - b"; echo "# tests 2"; echo "# pass 2"; echo "# fail 0"'

check "clean runs read 0, exit 0" 0 0 "$(stub clean "$TAP_OK")"
check "a failure in both runs, not in the base set, counts once" 1 1 "$(stub newfail 'echo "ok 1 - a"; echo "not ok 2 - b broke"; echo "# tests 2"; echo "# pass 1"; echo "# fail 1"')"
check "a base-set failure in both runs counts 0" 0 0 "$(stub base 'echo "not ok 1 - known flaky-free base test"; echo "# tests 1"; echo "# fail 1"')"
check "a failure in one run only is flaky" 1 1 "$(stub flaky "c=$T/n; n=\$(cat \$c 2>/dev/null || echo 0); echo \$((n+1)) > \$c; if [ \$n = 0 ]; then echo 'not ok 1 - a'; else echo 'ok 1 - a'; fi; echo '# tests 1'")"
check "a kbench dir left in the leak dir counts" 1 1 "$(stub leak "mkdir -p $T/leak/kbench-x$$; $TAP_OK")"
rm -rf "$T/leak"/*
check "a run that prints no totals is broken (both runs: 2)" 1 2 "$(stub crash 'echo "Error: Cannot find module"; exit 1')"
CASE_TIMEOUT=1 check "a run past its timeout is broken (both runs: 2)" 1 2 "$(stub slow "sleep 5; $TAP_OK")"

rm -rf "$T"
[ "$fails" = 0 ] && echo "all cases pass" || { echo "$fails case(s) failed"; exit 1; }
