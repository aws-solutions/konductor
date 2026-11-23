#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Stub test of run-full-suite-twice-v2.sh: no real suite, no fetch, no heavy lock. Each case runs the script with a stub
# SUITE_CMD in a fake checkout and checks the exit code and the summary's first line. v2 cases: the arm venv
# preflight, Python failures, and arm tests that skip (review 2026-11-23 F1). The suite's output is the one TAP stream
# bench/scripts/test.sh --tap prints (FW-23): node TAP, then the Python tests as "py:" lines with "# py" totals.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
SCRIPT=$HERE/run-full-suite-twice-v2.sh
T=$(mktemp -d "${KIROCREW_SCRATCH:-/tmp}/fst2.XXXX")
R=$T/repo
mkdir -p "$R/bench/scripts" "$T/leak" "$T/out"
printf '# base set\nknown flaky-free base test\n' > "$R/bench/test-base-set.txt"
printf '#!/bin/sh\nexit 0\n' > "$T/py-ok"; printf '#!/bin/sh\nexit 1\n' > "$T/py-bad"; chmod +x "$T/py-ok" "$T/py-bad"
fails=0

stub() {   # stub NAME BODY: a suite command that prints BODY
  printf '%s\n' "$2" > "$T/$1.sh"
  echo "bash $T/$1.sh"
}
check() {  # check LABEL WANT_EXIT WANT_TOTAL SUITE_CMD [ARM_PYTHON]   (an empty SUITE_CMD means the script's default)
  local label=$1 want=$2 total=$3 cmd=$4 armpy=${5:-$T/py-ok} code=0 out
  rm -rf "$T/out"/*
  R=$R SUITE_CMD=$cmd ARM_PYTHON=$armpy ARM_FFI=$T LOCK=$T/lock OUT_ROOT=$T/out LEAK_DIR=$T/leak \
    RUN_TIMEOUT=${CASE_TIMEOUT:-30} bash "$SCRIPT" > "$T/log" 2>&1 || code=$?
  out=$(head -1 "$T"/out/full-suite-*/summary.txt)
  if [ "$code" = "$want" ] && [ "$out" = "${total}" ]; then echo "ok   $label"
  else echo "FAIL $label: exit $code (want $want), '$out' (want '$total')"; fails=$((fails + 1)); fi
}
r() { echo "KR k485f5870 reading: $1"; }
PY_TAP='echo "ok 1 - py: test_x.X.test_a"; echo "1..1"; echo "# py tests 1"; echo "# py fail 0"'
TAP_OK="echo 'ok 1 - a'; echo 'ok 2 - b'; echo '# tests 2'; echo '# pass 2'; echo '# fail 0'; $PY_TAP"

check "clean runs read 0, exit 0" 0 "$(r 0)" "$(stub clean "$TAP_OK")"
check "a failure in both runs, not in the base set, counts once" 1 "$(r 1)" "$(stub newfail "echo 'ok 1 - a'; echo 'not ok 2 - b broke'; echo '# tests 2'; echo '# fail 1'; $PY_TAP")"
check "a base-set failure in both runs counts 0" 0 "$(r 0)" "$(stub base "echo 'not ok 1 - known flaky-free base test'; echo '# tests 1'; echo '# fail 1'; $PY_TAP")"
check "a failure in one run only is flaky" 1 "$(r 1)" "$(stub flaky "c=$T/n; n=\$(cat \$c 2>/dev/null || echo 0); echo \$((n+1)) > \$c; if [ \$n = 0 ]; then echo 'not ok 1 - a'; else echo 'ok 1 - a'; fi; echo '# tests 1'; $PY_TAP")"
check "a kbench dir left in the leak dir counts" 1 "$(r 1)" "$(stub leak "mkdir -p $T/leak/kbench-x$$; $TAP_OK")"
rm -rf "$T/leak"/*
check "a run that prints no totals is broken (node and Python, both runs: 4)" 1 "$(r 4)" "$(stub crash 'echo "Error: Cannot find module"; exit 1')"
CASE_TIMEOUT=1 check "a run past its timeout is broken (both runs: 2)" 1 "$(r 2)" "$(stub slow "sleep 5; $TAP_OK")"
# v2
check "no arm venv: STOP, exit 2" 2 "STOP: $T/py-bad cannot import mujoco and cedarpy (LD_LIBRARY_PATH=$T); set ARM_PYTHON to the arm venv's python" "$(stub clean2 "$TAP_OK")" "$T/py-bad"
check "a node arm test that skips makes both runs broken" 1 "$(r 2)" "$(stub armskip "echo 'ok 1 - arm # SKIP no Python with mujoco and cedarpy'; echo '# tests 1'; echo '# skipped 1'; $PY_TAP")"
check "a Python arm test that skips makes both runs broken" 1 "$(r 2)" "$(stub pyarmskip "echo 'ok 1 - a'; echo '# tests 1'; echo 'ok 1 - py: t.A.test_arm # SKIP MuJoCo is not installed in this Python'; echo '# py tests 1'")"
check "a Python failure in both runs counts once" 1 "$(r 1)" "$(stub pyfail "echo 'ok 1 - a'; echo '# tests 1'; echo 'not ok 1 - py: test_arm.ArmTest.test_x'; echo '# py tests 1'; echo '# py fail 1'; exit 1")"
check "Python tests with no totals are broken (both runs: 2)" 1 "$(r 2)" "$(stub pycrash "echo 'ok 1 - a'; echo '# tests 1'; echo 'ImportError: no module'; exit 1")"
check "the suite sees BENCH_ARM_PYTHON" 0 "$(r 0)" "$(stub envcheck "[ \"\$BENCH_ARM_PYTHON\" = $T/py-ok ] || exit 3; $TAP_OK")"
printf '%s\n' "[ \"\$1\" = --tap ] || exit 3; $TAP_OK" > "$R/bench/scripts/test.sh"
check "by default the suite is bench/scripts/test.sh --tap" 0 "$(r 0)" ""

rm -rf "$T"
[ "$fails" = 0 ] && echo "all cases pass" || { echo "$fails case(s) failed"; exit 1; }
