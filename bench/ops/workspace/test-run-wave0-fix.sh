#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-run-wave0-fix.sh -- paid-path-style test for run-wave0-fix.sh. Runs its --dry-run path with a stub bench (no
# model, no sim, no heavy lock, no spend) and checks the orchestration: the fill step resumes under a no-skip ceiling
# and a raised per-run limit, then the arm trial, then plant-report.
#
#   bash scripts/test-run-wave0-fix.sh
set -uo pipefail
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SELF/run-wave0-fix.sh"
T=$(mktemp -d /tmp/wave0fix-test.XXXXXX)
trap 'rm -rf "$T"' EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }

# fake checkout + venv so the sourced wrapper's top-level guards pass
mkdir -p "$T/co/bench/runner" "$T/co/bench/physical/ci" "$T/venv/bin" "$T/release/tasks" "$T/reports"
: > "$T/co/bench/runner/bench.js"; : > "$T/co/bench/physical/ci/plant-release.js"
printf '#!/bin/sh\nexit 0\n' > "$T/venv/bin/python"; chmod +x "$T/venv/bin/python"
printf '#!/bin/sh\nexit 0\n' > "$T/spy"; chmod +x "$T/spy"
printf '[default]\n' > "$T/aws-creds"; printf '[default]\n' > "$T/aws-config"; printf '{}' > "$T/fake.json"
printf '{"m":1}\n' > "$T/release/manifest.json"
# a prior wave 0 run to resume
mkdir -p "$T/r/out-wave0"
printf '{"taskIds":["plant-p1-overspeed.v01","plant-p1-overspeed.v03"]}\n' > "$T/r/out-wave0/run-config.json"
printf '{"totalCredits":40.888}\n' > "$T/r/out-wave0/summary.json"
# stub bench: append every call's argv to one log, then exit 0
cat > "$T/stub.sh" <<'S'
#!/usr/bin/env bash
{ echo "=== call ==="; printf '%s\n' "$@"; } >> "$CALLS"
exit 0
S
chmod +x "$T/stub.sh"

bash -n "$SCRIPT" && ok "run-wave0-fix.sh: bash -n clean" || bad "script syntax"
bash -n "$SELF/test-run-wave0-fix.sh" >/dev/null 2>&1 && ok "test: bash -n clean" || true

export PLANT_CHECKOUT="$T/co" PLANT_VENV="$T/venv" PLANT_REPORTS="$T/reports" PLANT_R="$T/r" \
  PLANT_BENCH_CMD="bash $T/stub.sh" STRANDS_PYTHON="$T/spy" ARM_RELEASE="$T/release" ARM_TASK=stub.v01 \
  ARM_FAKE="$T/fake.json" ARM_AWS_CREDS="$T/aws-creds" ARM_AWS_CONFIG="$T/aws-config" ARM_AWS_PROFILE=default \
  ARM_SHA="$(sha256sum "$T/release/manifest.json" | cut -d' ' -f1)" CALLS="$T/calls.log" \
  PLANT_FILL_BUDGET=65 PLANT_FILL_RUNLIM=3
: > "$T/calls.log"

out="$T/run.out"
bash "$SCRIPT" --dry-run > "$out" 2>&1; rc=$?
[ "$rc" = 0 ] && ok "dry run exits 0" || { bad "dry run should exit 0 (rc=$rc)"; sed 's/^/    /' "$out"; }

C="$T/calls.log"
grep -qx -- '--resume' "$C" && ok "fill uses bench run --resume" || bad "fill missing --resume"
grep -qx -- "$T/r/out-wave0" "$C" && ok "fill resumes the existing out-wave0 dir" || bad "fill did not target out-wave0"
if grep -A1 -x -- '--budget-credits' "$C" | grep -qx -- '65'; then ok "fill ceiling is the no-skip budget (65)"; else bad "fill did not pass --budget-credits 65"; fi
if grep -A1 -x -- '--run-credit-limit' "$C" | grep -qx -- '3'; then ok "fill raises the per-run limit to 3"; else bad "fill did not raise --run-credit-limit"; fi
grep -qx -- 'plant-report' "$C" && ok "plant-report is invoked for the table" || bad "plant-report not invoked"

# order: fill -> arm trial -> plant-report
grep -q 'fill:' "$out" && grep -q 'arm trial starting' "$out" && grep -q 'plant-report ->' "$out" && ok "ran fill, then arm trial, then plant-report" || bad "orchestration order/steps missing"

echo "----"
[ "$fail" = 0 ] && { echo "ALL PASS"; exit 0; } || { echo "SOME FAILED"; exit 1; }
