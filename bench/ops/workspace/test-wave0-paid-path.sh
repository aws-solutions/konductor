#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-wave0-paid-path.sh -- regression test for run-physical-ai-wave0.sh's arm_trial on the PAID path.
#
# Why this exists: the owner's 18:24 PAID run died with "log: unbound variable" / "pinbak: unbound variable"
# (set -u) because those vars were bound only on the dry-run path, so --dry-run never caught it. This test runs
# the real arm_trial with DRY=0 against a STUB benchmark command (PLANT_BENCH_CMD) and a throwaway key, for BOTH
# paid harnesses (strands/Bedrock and kiro). No model/Bedrock call, no heavy run, no heavy lock: it sources the
# script as a library (WAVE0_LIB=1) and calls arm_trial directly, with every real dependency faked under a tmp dir.
#
# It also covers the 05:59 release-intake STOP: in PAID mode ensure_paid_release moves aside (never removes) an
# existing release that fails `verify` against the real pinned key, keeps one that passes, and never touches a
# release in dry mode (dry uses a separate working dir).
#
#   bash scripts/test-wave0-paid-path.sh      # prints PASS/FAIL per case; exit 0 only if all pass
set -uo pipefail

SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SELF/run-physical-ai-wave0.sh"
T=$(mktemp -d /tmp/wave0-paid-test.XXXXXX)
trap 'rm -rf "$T"' EXIT

fail=0
ok()   { printf 'PASS: %s\n' "$*"; }
bad()  { printf 'FAIL: %s\n' "$*"; fail=1; }

# --- a fake checkout + venv so the script's top-level existence guards pass (nothing here is executed on the
#     arm_trial PAID path except the stub benchmark) ---
mkdir -p "$T/checkout/bench/runner" "$T/checkout/bench/physical/ci" "$T/venv/bin"
: > "$T/checkout/bench/runner/bench.js"
: > "$T/checkout/bench/physical/ci/plant-release.js"
printf '#!/bin/sh\nexit 0\n' > "$T/venv/bin/python"; chmod +x "$T/venv/bin/python"
# a fake "strands python" that reports strands is importable, so the strands PAID branch is taken
printf '#!/bin/sh\nexit 0\n' > "$T/strands-python"; chmod +x "$T/strands-python"
# a throwaway AWS creds file (no real credentials; just makes the readable-file guard pass)
printf '[default]\naws_access_key_id=STUB\naws_secret_access_key=STUB\n' > "$T/aws-creds"
# a fake signed arm release: manifest + a tasks dir
mkdir -p "$T/release/tasks"
printf '{"stub":"manifest"}\n' > "$T/release/manifest.json"

# a stub benchmark command: record argv, then exit 0 (no node, no model, no spend)
cat > "$T/stub-bench.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$STUB_ARGV_OUT"
echo "stub-bench ran"
exit 0
STUB
chmod +x "$T/stub-bench.sh"

# --- shared environment that steers the PAID path onto the stub (set before sourcing) ---
export PLANT_REPORTS="$T/reports"          # isolate the credit ledger under the tmp dir
export PLANT_CHECKOUT="$T/checkout"
export PLANT_VENV="$T/venv"
export PLANT_R="$T/r"
export PLANT_BENCH_CMD="bash $T/stub-bench.sh"
export STRANDS_PYTHON="$T/strands-python"
export ARM_RELEASE="$T/release"
export ARM_TASK="stub-task.v01"
export ARM_SHA="$(sha256sum "$T/release/manifest.json" | cut -d' ' -f1)"  # match the fake release so the SHA guard passes
export ARM_AWS_CREDS="$T/aws-creds"
export ARM_AWS_PROFILE=default
export WAVE0_LIB=1                          # source as a library: define functions, do NOT run main

# Source the real script. This also runs its top-level `set -euo pipefail`, so the rest of this test runs
# under set -u -- exactly the mode that killed the owner's run; an unbound var here fails the case below.
# shellcheck disable=SC1090
source "$SCRIPT"
set +e              # the sourced script turned on errexit; our assertions handle their own exit codes.
set -u              # keep nounset ON -- that is the exact condition that killed the owner's run.
DRY=0                                       # PAID path

run_case() { # run_case LABEL  (harness env is set by the caller)
  local label=$1 out="$T/${1}.out" argv="$T/${1}.argv"
  export STUB_ARGV_OUT="$argv"
  # Subshell: a STOP/exit inside arm_trial must fail the case, never abort the whole test.
  if ( arm_trial ) > "$out" 2>&1; then
    if grep -qiE 'unbound variable|: line [0-9]+:' "$out"; then
      bad "$label: arm_trial printed an unbound/line error"; sed 's/^/    /' "$out"
    else
      ok "$label: arm_trial completed on the PAID path (set -u) with no unbound error"
    fi
  else
    bad "$label: arm_trial exited non-zero on the PAID path"; sed 's/^/    /' "$out"
  fi
}

# Case 1: default harness = strands/Bedrock. Expect the USD budget flags, no model call (stub).
unset ARM_HARNESS 2>/dev/null || true
run_case strands-paid
if [ -f "$T/strands-paid.argv" ]; then
  grep -qx -- '--budget-usd' "$T/strands-paid.argv" && ok "strands-paid: passed --budget-usd (owner's USD cap)" \
    || bad "strands-paid: missing --budget-usd"
  grep -qx -- "bedrock:${ARM_MODEL}" "$T/strands-paid.argv" && ok "strands-paid: used the Bedrock model arg" \
    || bad "strands-paid: missing bedrock model arg"
  grep -qx -- 'st-plant-policy' "$T/strands-paid.argv" && ok "strands-paid: used the strands arm st-plant-policy" \
    || bad "strands-paid: missing st-plant-policy arm"
  grep -qx -- '--aws-profile' "$T/strands-paid.argv" && ok "strands-paid: passed --aws-profile" \
    || bad "strands-paid: missing --aws-profile"
  if grep -qx -- '--aws-creds-file' "$T/strands-paid.argv"; then bad "strands-paid: must NOT pass --aws-creds-file (Strands rejects it)"; else ok "strands-paid: does not pass --aws-creds-file"; fi
else
  bad "strands-paid: the stub benchmark was never invoked"
fi

# Case 2: kiro harness, credit-costed.
export ARM_HARNESS=kiro
run_case kiro-paid
if [ -f "$T/kiro-paid.argv" ]; then
  grep -qx -- '--budget-credits' "$T/kiro-paid.argv" && ok "kiro-paid: passed --budget-credits" \
    || bad "kiro-paid: missing --budget-credits"
  grep -qx -- 'plant-policy' "$T/kiro-paid.argv" && ok "kiro-paid: used the kiro arm plant-policy" \
    || bad "kiro-paid: missing plant-policy arm"
else
  bad "kiro-paid: the stub benchmark was never invoked"
fi

# --- a paid arm run that does NOT start (bench rejects a flag / exits nonzero) must NOT charge the ledger ---
LEDGER0="$PLANT_REPORTS/physical-ai-spend-ledger.tsv"
before=$(grep -c 'arm-trial' "$LEDGER0" 2>/dev/null || echo 0)
printf '#!/usr/bin/env bash\necho "bench: --aws-creds-file does not apply to Strands arms" >&2\nexit 3\n' > "$T/fail-bench.sh"; chmod +x "$T/fail-bench.sh"
BJ=(bash "$T/fail-bench.sh")           # reassign the sourced global so arm_trial calls the failing stub
unset ARM_HARNESS 2>/dev/null || true
export STUB_ARGV_OUT="$T/failstart.argv"
( arm_trial ) > "$T/failstart.out" 2>&1
after=$(grep -c 'arm-trial' "$LEDGER0" 2>/dev/null || echo 0)
[ "$before" = "$after" ] && ok "a failed-to-start arm run does not charge the ledger ($before entries)" \
  || bad "ledger charged ($before -> $after) on a run that did not start"
grep -q 'ledger NOT charged' "$T/failstart.out" && ok "wrapper reports the ledger was not charged" || { bad "no 'ledger NOT charged' note"; sed 's/^/    /' "$T/failstart.out"; }
BJ=(bash "$T/stub-bench.sh")           # restore the passing stub

# --- the stale throwaway release in the PAID path (the owner's 05:59 release-intake STOP) ---
# A prior run left a release in $R that does not verify against the real pinned key. In PAID mode
# ensure_paid_release must move $R aside (mv, never rm) and leave a fresh empty $R so plant-wave.sh signs anew.
printf '#!/bin/sh\nexit 1\n' > "$T/verify-fail.sh"; chmod +x "$T/verify-fail.sh"
printf '#!/bin/sh\nexit 0\n' > "$T/verify-ok.sh";   chmod +x "$T/verify-ok.sh"

mkdir -p "$R/release"; printf 'sig\n' > "$R/release/manifest.json.sig"
RELEASE_TOOL=("$T/verify-fail.sh")
( ensure_paid_release ) > "$T/stale.out" 2>&1
if [ -f "$R/release/manifest.json.sig" ]; then
  bad "stale-release (paid): a non-verifying release was NOT moved aside (still in $R)"; sed 's/^/    /' "$T/stale.out"
elif ls -d "$R".old-unverified-* >/dev/null 2>&1; then
  ok "stale-release (paid): non-verifying release moved aside, \$R left fresh for a re-sign"
else
  bad "stale-release (paid): \$R neither kept nor moved aside"; sed 's/^/    /' "$T/stale.out"
fi

mkdir -p "$R/release"; printf 'sig\n' > "$R/release/manifest.json.sig"   # a release that DOES verify
before=$(ls -d "$R".old-unverified-* 2>/dev/null | wc -l)
RELEASE_TOOL=("$T/verify-ok.sh")
( ensure_paid_release ) > "$T/ok.out" 2>&1
after=$(ls -d "$R".old-unverified-* 2>/dev/null | wc -l)
if [ -f "$R/release/manifest.json.sig" ] && [ "$before" = "$after" ]; then
  ok "verifying release (paid): kept and reused, not moved aside"
else
  bad "verifying release (paid): should be kept, not moved"; sed 's/^/    /' "$T/ok.out"
fi

mkdir -p "$R/release"; printf 'sig\n' > "$R/release/manifest.json.sig"   # dry must not touch the release
DRY=1; RELEASE_TOOL=("$T/verify-fail.sh"); ( ensure_paid_release ) >/dev/null 2>&1; DRY=0
[ -f "$R/release/manifest.json.sig" ] && ok "dry: ensure_paid_release leaves the release untouched (separate dir)" \
  || bad "dry: ensure_paid_release must not touch a release"

# The ledger must have recorded one paid arm-trial entry per case (+15 each), proving the paid tail ran fully.
LEDGER="$PLANT_REPORTS/physical-ai-spend-ledger.tsv"
n=$(grep -c 'arm-trial' "$LEDGER" 2>/dev/null || echo 0)
[ "$n" = 2 ] && ok "ledger recorded both paid arm-trial entries" \
  || bad "ledger has $n arm-trial entries, expected 2 ($LEDGER)"

echo "----"
[ "$fail" = 0 ] && { echo "ALL PASS"; exit 0; } || { echo "SOME FAILED"; exit 1; }
