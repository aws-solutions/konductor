#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# One command for the owner after the 2026-11-22 morning failures. Free: no model, no credits.
#   1. the arm script's own tests (dry run, out-dir guard, real PART B throwaway sign + verify);
#   2. the D-165 namespace case with a pytest venv on PATH (scripts/run-namespace-test-v2.sh);
#   3. the arm signed-release test itself (waits for /var/tmp/konductor-heavy.lock, up to its 90 min timeout).
# Each step's exit code is printed; the script exits nonzero if any step failed.
set -uo pipefail
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
rc=0
step() { echo "== $1"; shift; "$@"; local c=$?; echo "== exit $c"; [ "$c" = 0 ] || rc=1; }
step "1/3 arm script tests" env TMPDIR=/tmp bash "$SELF/test-arm-signed-release-v2.sh"
step "2/3 namespace test (D-165)" bash "$SELF/run-namespace-test-v2.sh"
step "3/3 arm signed-release test" bash "$SELF/arm-signed-release-test-v2.sh"
echo "== all steps done; overall $([ "$rc" = 0 ] && echo PASS || echo FAIL)"
exit "$rc"
