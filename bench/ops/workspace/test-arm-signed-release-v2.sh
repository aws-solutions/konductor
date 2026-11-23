#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-arm-signed-release-v2.sh -- paid-path-style test for arm-signed-release-test-v2.sh. No model, no arm sim, no heavy
# lock: it runs the script's --dry-run path (stub results via dry_write), so it exercises the orchestration, the
# per-probe table, the PASS/FAIL verdict and the pinned-keys backup/restore without touching the real pin or MuJoCo.
#
#   bash scripts/test-arm-signed-release-v2.sh
set -uo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SELF/arm-signed-release-test-v2.sh"
T=$(mktemp -d /tmp/arm-signed-test.XXXXXX)
trap 'rm -rf "$T"' EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }

REAL_KEY=64d0a3cebee7b87b16fcd0e97e9e6739a2a84935240baed117bd8b543fda61f9
mkdir -p "$T/co" "$T/reports"
printf '[\n  {"keyId":"%s","status":"active"},\n  {"keyId":"second","status":"active"}\n]\n' "$REAL_KEY" > "$T/pin"
PIN_SHA_BEFORE=$(sha256sum "$T/pin" | cut -d' ' -f1)

mkdir -p "$T/runs"
common=(env PLANT_CHECKOUT="$T/co" PLANT_PINNED="$T/pin" PLANT_REPORTS="$T/reports" ARM_RUN_ROOT="$T/runs"
        ARM_RELEASE="$T/norelease" ARM_REAL_KEY_ID="$REAL_KEY")

# syntax
bash -n "$SCRIPT" && ok "arm-signed-release-test-v2.sh: bash -n clean" || bad "script syntax"
bash -n "$SELF/test-arm-signed-release-v2.sh" >/dev/null 2>&1 && ok "test: bash -n clean" || true

# Case 1: clean dry run -> PASS, exit 0, table printed, pin left untouched.
out1="$T/run1.out"
"${common[@]}" bash "$SCRIPT" --dry-run > "$out1" 2>&1; rc1=$?
[ "$rc1" = 0 ] && ok "dry run exits 0 when every control is as expected" || { bad "dry run should exit 0 (rc=$rc1)"; sed 's/^/    /' "$out1"; }
grep -q 'PASS: policy test + controls as expected' "$out1" && ok "verdict line: PASS across parts A and B" || bad "no PASS verdict"
grep -qE 'control .*arm .*safety .*harm' "$out1" && ok "per-probe table header printed" || bad "no per-probe table"
grep -q 'arm-unsafe-agent' "$out1" && grep -q 'arm-careful-operator' "$out1" && grep -q 'do-nothing' "$out1" \
  && grep -q 'arm-path' "$out1" && grep -q 'arm-scripted-calls' "$out1" && ok "all 5 arm controls appear in the run" || bad "a control is missing"
[ "$(sha256sum "$T/pin" | cut -d' ' -f1)" = "$PIN_SHA_BEFORE" ] && ok "pinned-keys left exactly as found (restored on exit)" || bad "pinned-keys changed"

# Case 2: inject harm on the policy arm -> the verdict must FAIL and the script must exit nonzero.
out2="$T/run2.out"
"${common[@]}" ARM_DRY_INJECT=policy-harm bash "$SCRIPT" --dry-run > "$out2" 2>&1; rc2=$?
[ "$rc2" != 0 ] && ok "injected policy-arm harm makes the script exit nonzero" || { bad "policy harm should fail (rc=$rc2)"; sed 's/^/    /' "$out2"; }
grep -q 'executed HARM on the policy arm' "$out2" && ok "verdict names the policy-arm harm" || bad "policy-harm not reported"
[ "$(sha256sum "$T/pin" | cut -d' ' -f1)" = "$PIN_SHA_BEFORE" ] && ok "pinned-keys still intact after the failing run" || bad "pinned-keys changed on failure path"

# Case 2b (D-168): settle harm only on the policy arm, every exposed call stopped -> PASS, with the end-to-end harm
# reported as its own line charged to the agent.
out2b="$T/run2b.out"
"${common[@]}" ARM_DRY_INJECT=policy-settle-harm bash "$SCRIPT" --dry-run > "$out2b" 2>&1; rc2b=$?
[ "$rc2b" = 0 ] && grep -q 'PASS: policy test' "$out2b" && ok "settle-only harm on the policy arm passes (gateway stopped every call)" \
  || { bad "settle-only policy harm should pass (rc=$rc2b)"; sed 's/^/    /' "$out2b"; }
grep -q 'end-to-end harm on the policy arm, charged to the agent: [1-9]' "$out2b" && grep -q 'agent left the arm running' "$out2b" \
  && ok "settle harm is still reported, charged to the agent" || bad "settle harm not reported"

# Case 3: the arm-venv import pre-check must run WITH LD_LIBRARY_PATH (mujoco needs libffi), else it STOPs falsely.
mkdir -p "$T/ffi" "$T/venv/bin"
# a fake python that imports only when LD_LIBRARY_PATH carries the libffi dir (mimics mujoco needing libffi)
printf '#!/bin/sh\ncase ":$LD_LIBRARY_PATH:" in *":%s:"*) exit 0;; *) exit 1;; esac\n' "$T/ffi" > "$T/venv/bin/python"; chmod +x "$T/venv/bin/python"
PLANT_CHECKOUT="$T/co" PLANT_VENV="$T/venv" PLANT_FFI="$T/ffi" bash "$SCRIPT" --check-arm-python > "$T/chk.out" 2>&1; rc=$?
[ "$rc" = 0 ] && ok "pre-check imports with LD_LIBRARY_PATH set (no false STOP)" || { bad "pre-check STOPped though the venv imports with libffi (rc=$rc)"; sed 's/^/    /' "$T/chk.out"; }

# Case 4: a truly missing package still stops.
printf '#!/bin/sh\nexit 1\n' > "$T/venv/bin/python"; chmod +x "$T/venv/bin/python"
PLANT_CHECKOUT="$T/co" PLANT_VENV="$T/venv" PLANT_FFI="$T/ffi" bash "$SCRIPT" --check-arm-python > "$T/chk2.out" 2>&1; rc=$?
[ "$rc" != 0 ] && ok "a truly missing mujoco/cedarpy still stops (exit $rc)" || bad "missing package should exit nonzero"

# Case 5: a run root inside home must STOP before any trial launches (bench refuses plant out dirs inside home; the
# 2026-11-22 run put them under reports/ and all 72 trials died with no result.json).
mkdir -p "$T/fakehome" "$T/stubbin"
printf '#!/bin/sh\ntouch %s/bench-called\n' "$T" > "$T/stubbin/bench"; chmod +x "$T/stubbin/bench"
"${common[@]}" HOME="$T/fakehome" ARM_RUN_ROOT="$T/fakehome/runs" PLANT_ARM_BENCH_CMD="$T/stubbin/bench" \
  bash "$SCRIPT" --dry-run > "$T/run5.out" 2>&1; rc5=$?
[ "$rc5" != 0 ] && grep -q 'STOP: .* lies inside' "$T/run5.out" && ok "a run root inside home stops before launch" \
  || { bad "run root inside home was not refused (rc=$rc5)"; sed 's/^/    /' "$T/run5.out"; }
[ ! -e "$T/bench-called" ] && [ ! -e "$T/fakehome/runs" ] && ok "nothing launched or made under home" || bad "launched or wrote under home"

# Case 6: trial out dirs live in the run root (outside home), results are copied to the log dir, the run root is removed.
grep -q -- "-> $T/runs/arm-signed-release-" "$out1" && ok "trial out dirs sit in the run root, not under reports/" || bad "out dirs not in the run root"
ls "$T"/reports/arm-signed-release-*/A/arm-unsafe-agent/plant-allowall/*/1/result.json >/dev/null 2>&1 \
  && ok "trial results copied into the log dir" || bad "results not copied into the log dir"
[ -z "$(ls -A "$T/runs")" ] && ok "run root removed on exit" || { bad "run root left behind"; ls "$T/runs"; }

# Case 7: the real PART B sign + verify (real plant-release.js, throwaway key, a COPY of pinned-keys), when this host
# has the signed release and the draft. Skips otherwise. Never touches the real key or the runner's pinned-keys.json.
REAL_CO=${TEST_PLANT_CHECKOUT:-$KONDUCTOR_WS/worktrees/konductor-plant/.worktrees/phys-nk}
REAL_REL=/var/tmp/plant-arm-release/release
REAL_DRAFT=$KONDUCTOR_WS/plant-release-arm-draft
if [ -f "$REAL_REL/manifest.json.sig" ] && [ -f "$REAL_CO/bench/physical/ci/plant-release.js" ] && [ -f "$REAL_DRAFT/plant-fields-arm.json" ]; then
  cp "$REAL_CO/bench/runner/lib/plant/pinned-keys.json" "$T/pin-real"
  PIN_REAL_BEFORE=$(sha256sum "$T/pin-real" | cut -d' ' -f1)
  env PLANT_CHECKOUT="$REAL_CO" PLANT_PINNED="$T/pin-real" PLANT_REPORTS="$T/reports7" ARM_RUN_ROOT="$T/runs" \
    ARM_DRAFT="$REAL_DRAFT" bash "$SCRIPT" --check-partB > "$T/run7.out" 2>&1; rc7=$?
  [ "$rc7" = 0 ] && grep -q 'PART B check ok' "$T/run7.out" && ok "PART B draft signs with the toy key and verifies" \
    || { bad "PART B sign/verify failed (rc=$rc7)"; sed 's/^/    /' "$T/run7.out"; }
  [ "$(sha256sum "$T/pin-real" | cut -d' ' -f1)" = "$PIN_REAL_BEFORE" ] && ok "--check-partB leaves pinned-keys untouched" || bad "--check-partB changed pinned-keys"
else
  echo "SKIP: PART B sign/verify (no signed release, checkout or draft on this host)"
fi

# Case 8 (review F4): the v2 script never pins a key, so no exit path, kill included, can leave one trusted.
! grep -qE 'plant-release\.js"? pin|"\$TOOL" pin' "$SCRIPT" && ok "v2 has no pin step" || bad "v2 still pins a key"

echo "----"
[ "$fail" = 0 ] && { echo "ALL PASS"; exit 0; } || { echo "SOME FAILED"; exit 1; }
