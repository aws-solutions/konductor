#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-physical-ai-wave0.sh -- ONE command the owner runs once in his own terminal.
# It runs, in order: (1) Physical AI wave 0 (p1, both arms) signed with the owner's REAL plant key, then
# (2) one arm real-model trial. Only these two steps spend credits; everything else is free.
# The arm trial defaults to the Strands/Bedrock harness (USD-costed, --budget-usd 8; set STRANDS_PYTHON to a strands
# venv and ARM_MODEL to a Bedrock id). ARM_HARNESS=kiro runs it on kiro-cli instead, credit-costed (--budget-credits).
#
# NOTE on "wave 0": wave 0 is the dev-box UNCOUNTED dress rehearsal (p1, ~26 credits, ceiling 45) -- it does NOT
# count toward the 360-credit soft cap. The 360 cap is for the COUNTED waves 1-4 (on the quiet host). The ledger
# below still records wave 0's spend so cumulative credits are visible, but the counted budget is spent by waves 1-4.
#
# SAFETY the wrapper adds on top of bench's own budget flags:
#   - waits (up to 60 min) for a QUIET host: no pilot-wave.sh running AND 1-min load < 4;
#   - holds the shared heavy lock (/var/tmp/konductor-heavy.lock) for the whole run, so no other heavy job overlaps;
#   - a credit LEDGER under reports/: before each paid step it refuses to start unless at least 15 credits of headroom
#     remain under the 360 soft cap (the owner's "each call counts 15" guard), and reconciles to the real spend after;
#   - wave 0's own ceiling (--budget-credits 45, enforced by bench) and the arm trial's USD 8 cap (--budget-usd 8);
#   - every log under one stable folder in reports/, whose paths are printed at the end.
#
#   bash run-physical-ai-wave0.sh            # the paid run (spends credits; uses the real key via PLANT_KEY)
#   bash run-physical-ai-wave0.sh --dry-run  # FREE: throwaway key, prepare-only, no lock/wait, no spend
#
# The owner's REAL key is used only by plant-wave.sh / plant-release.js as the file at PLANT_KEY; this script never
# reads or prints it. Overrides (env):
#   PLANT_CHECKOUT  konductor checkout on feat/bench-pilot-nk (default: the phys-nk worktree below)
#   PLANT_KEY       the Ed25519 signing key for the real run (default: ~/.plant-release-key/private.pem)
#   PLANT_VENV      a python 3.12 with cedarpy+mujoco (default: the konductor-arm cache venv below)
#   ARM_RELEASE     a signed arm release dir for the arm trial (default: cut+signed from the arm stub under $R)
#   ARM_TASK        the arm task id to run in the trial (default: the first arm-sim task in $ARM_RELEASE/tasks)
#   PLANT_CAP       the counted soft-cap ceiling in credits (default: 360)
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; -h|--help) sed -n '2,30p' "$0"; exit 0 ;; *) echo "unknown arg $a" >&2; exit 64 ;; esac; done

CHECKOUT=${PLANT_CHECKOUT:-$KONDUCTOR_WS/worktrees/konductor-plant/.worktrees/phys-nk}
VENV=${PLANT_VENV:-/home/$USER/.cache/konductor-arm/venv}
KEY=${PLANT_KEY:-$HOME/.plant-release-key/private.pem}
CAP=${PLANT_CAP:-360}
PERCALL=15
FFI=/local/apollo/package/local_1/AL2023_x86_64/Libffi/Libffi-119967.0-0/lib
HEAVY_LOCK=/var/tmp/konductor-heavy.lock
REPORTS=${PLANT_REPORTS:-$KONDUCTOR_WS/reports}  # tests point this at a temp dir
TS=$(date -u +%Y%m%d-%H%M%S)
LOGDIR="$REPORTS/physical-ai-wave0-$TS"
LEDGER="$REPORTS/physical-ai-spend-ledger.tsv"
# Dry and paid must NEVER share a working dir: a dry run signs its release with a THROWAWAY key, so a later paid
# run that reused that dir would fail release intake (the owner's 05:59 STOP). Dry defaults to a separate dir.
if [ "$DRY" = 1 ]; then R=${PLANT_R:-/var/tmp/plant-counted-r1-dry}; else R=${PLANT_R:-/var/tmp/plant-counted-r1}; fi
SELFDIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STRANDS_PYTHON=${STRANDS_PYTHON:-/home/$USER/.cache/konductor-strands/bin/python}  # a venv with strands-agents
ARM_MODEL=${ARM_MODEL:-qwen.qwen3-coder-next}                                      # the Bedrock id used in trial 2
ARM_FAKE=${ARM_FAKE:-$SELFDIR/arm-fake-turns.json}                                 # the free scripted model for --dry-run
ARM_RELEASE=${ARM_RELEASE:-/var/tmp/plant-arm-release/release}                      # the owner-signed arm release
ARM_TASK=${ARM_TASK:-plant-a2-door-no-approval.v01}
ARM_SHA=${ARM_SHA:-bcaa554d17e2f31ae382a79f6aa8b325f04b867a2899b5d0ca6f59dd412a79a8}  # expected manifest SHA-256
ARM_AWS_CREDS=${ARM_AWS_CREDS:-$HOME/.aws/credentials}   # Bedrock creds for the real Strands model (region us-east-1 from the pin)
ARM_AWS_PROFILE=${ARM_AWS_PROFILE:-default}
ARM_AWS_CONFIG=${ARM_AWS_CONFIG:-$HOME/.aws/config}   # bench resolves --aws-profile with the AWS CLI, which reads these two env paths
# The benchmark command. The PAID-path test overrides it with a stub via PLANT_BENCH_CMD so the paid
# code path runs with no model/Bedrock call; the real run uses bench.js.
if [ -n "${PLANT_BENCH_CMD:-}" ]; then read -r -a BJ <<<"$PLANT_BENCH_CMD"; else BJ=(node "$CHECKOUT/bench/runner/bench.js"); fi
# The release tool (its `verify`). The paid-path test overrides it via PLANT_RELEASE_TOOL with a pass/fail stub so
# the stale-release guard runs with no real crypto; the real run uses plant-release.js (verify uses the runner's pins).
if [ -n "${PLANT_RELEASE_TOOL:-}" ]; then read -r -a RELEASE_TOOL <<<"$PLANT_RELEASE_TOOL"; else RELEASE_TOOL=(node "$CHECKOUT/bench/physical/ci/plant-release.js"); fi

[ -f "$CHECKOUT/bench/runner/bench.js" ] || { echo "STOP: no bench at $CHECKOUT (set PLANT_CHECKOUT)" >&2; exit 1; }
[ -x "$VENV/bin/python" ] || { echo "STOP: no python3.12 venv at $VENV (set PLANT_VENV)" >&2; exit 1; }
mkdir -p "$LOGDIR"
[ -f "$LEDGER" ] || printf 'ts\tlabel\tcredits\tcumulative\n' > "$LEDGER"
say() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# ---- credit ledger: cumulative credits across runs; refuse a step without >=PERCALL headroom under CAP ----
ledger_used() { awk -F'\t' 'NR>1{s=$4} END{print s+0}' "$LEDGER"; }
ledger_check() { # label -- refuse unless used+PERCALL <= CAP
  local used; used=$(ledger_used)
  awk -v u="$used" -v p="$PERCALL" -v c="$CAP" 'BEGIN{exit !(u+p<=c)}' \
    || { echo "STOP: ledger at $used credits; a paid call (+$PERCALL headroom) would pass the $CAP soft cap. Review $LEDGER." >&2; exit 1; }
  say "ledger ok for '$1': used $used + $PERCALL headroom <= $CAP"
}
ledger_add() { # label credits
  local used; used=$(ledger_used); local cum; cum=$(awk -v u="$used" -v a="$2" 'BEGIN{print u+a}')
  printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$1" "$2" "$cum" >> "$LEDGER"
  say "ledger += $2 for '$1' (cumulative $cum / $CAP)"
}

# ---- quiet-host gate: no pilot-wave.sh, 1-min load < 4, up to 60 min ----
quiet() { ! pgrep -f 'pilot-wave.sh' >/dev/null 2>&1 && awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN{exit !(l<4)}'; }
wait_quiet() {
  if [ "$DRY" = 1 ]; then quiet && say "host quiet" || say "host busy (dry-run goes on)"; return 0; fi
  for _ in $(seq 1 120); do quiet && { say "host quiet (no pilot-wave, load $(cut -d' ' -f1 /proc/loadavg))"; return 0; }; say "host busy; waiting 30s"; sleep 30; done
  echo "STOP: host still busy after 60 min (pilot-wave running or load >= 4)." >&2; exit 1
}

# ---- PAID guard: never reuse a release that does not verify against the real pinned key ----
# plant-wave.sh reuses $R/release when it already holds a signed manifest. A stale throwaway-signed release (e.g.
# one left by an older run that shared this dir) does not verify against the real pins, so intake STOPs. Here, in
# PAID mode only, we verify it first; if it fails we move the whole dir aside (mv, never rm) so plant-wave.sh cuts
# and signs a fresh release with the owner's real key (KEY/PLANT_KEY, which this script never reads).
ensure_paid_release() {
  [ "$DRY" = 1 ] && return 0
  [ -f "$R/release/manifest.json.sig" ] || return 0   # nothing to reuse; plant-wave.sh will sign fresh
  if "${RELEASE_TOOL[@]}" verify --release "$R/release" >/dev/null 2>&1; then
    say "paid: release in $R/release verifies against the pinned key; reusing it"
  else
    local aside="$R.old-unverified-$(date +%s)"
    say "paid: release in $R/release does NOT verify against the pinned key; moving $R aside to $aside, signing fresh"
    mv "$R" "$aside"; mkdir -p "$R"
  fi
}

# ---- step 1: wave 0 (delegates to the tested plant-wave.sh; real key via PLANT_KEY) ----
wave0() {
  ledger_check "wave 0"
  ensure_paid_release
  local log="$LOGDIR/wave0.log"
  local args=(0); [ "$DRY" = 1 ] && args+=(--prepare-only)
  say "wave 0 starting ($([ "$DRY" = 1 ] && echo 'prepare-only, FREE' || echo 'PAID, ceiling 45 credits')); log $log"
  # In dry-run, sign with a throwaway key so plant-wave.sh can run its checks without the real key.
  if [ "$DRY" = 1 ]; then
    local tk; tk=$(mktemp -d /tmp/arm-dry-key.XXXX); node "$CHECKOUT/bench/physical/ci/plant-release.js" keygen --out "$tk" >/dev/null
    printf '[]\n' > "$tk/pinned.json"; node "$CHECKOUT/bench/physical/ci/plant-release.js" pin --public "$tk/public.pem" --keys "$tk/pinned.json" >/dev/null
    PLANT_KEY="$tk/private.pem" PLANT_KEYS="$tk/pinned.json" PLANT_CHECKOUT="$CHECKOUT" PLANT_VENV="$VENV/bin/python" PLANT_R="$R" \
      LD_LIBRARY_PATH="$FFI" bash "$CHECKOUT/bench/scripts/plant-wave.sh" "${args[@]}" 2>&1 | tee "$log" || true
  else
    PLANT_KEY="$KEY" PLANT_CHECKOUT="$CHECKOUT" PLANT_VENV="$VENV/bin/python" PLANT_R="$R" \
      LD_LIBRARY_PATH="$FFI" bash "$CHECKOUT/bench/scripts/plant-wave.sh" "${args[@]}" 2>&1 | tee "$log"
    local cr; cr=$("$VENV/bin/python" -c "import json;print(round(json.load(open('$R/out-wave0/summary.json'))['totalCredits'],2))" 2>/dev/null || echo "$PERCALL")
    ledger_add "wave0" "$cr"
  fi
  say "wave 0 done"
}

# ---- step 2: arm real-model trial, USD 8 cap (one arm task, policy arm, real kiro) ----
# Needs a signed arm release that holds arm-sim TASKS (the in-repo arm_release_stub is policy-test-only, no tasks),
# so the owner points ARM_RELEASE at a signed arm release and ARM_TASK at an arm-sim task id in it.
CANDPUB=${ARM_KEYPUB:-$KONDUCTOR_WS/plant-arm-release-cand/key/public.pem}

arm_trial() {
  # Real: a signed release the owner made with sign-arm-release.sh. Dry-run: a throwaway-signed candidate whose key
  # we pin into the runner for the free fake-model run, then restore.
  local rel=$ARM_RELEASE task=$ARM_TASK
  # Dry-run falls back to the throwaway candidate only when the owner-signed release is not there yet.
  [ "$DRY" = 1 ] && [ ! -f "$rel/manifest.json" ] && rel=/var/tmp/plant-arm-cand/release
  local log="$LOGDIR/arm-trial.log"
  if [ ! -f "$rel/manifest.json" ]; then
    say "arm trial SKIPPED: no signed arm release at $rel. Run first (ONE command, signs + pins with your real key):"
    say "  bash $KONDUCTOR_WS/scripts/sign-arm-release.sh"
    printf 'arm trial not run: no signed arm release at %s\n' "$rel" > "$log"; return 0
  fi
  ledger_check "arm trial"
  local sha; sha=$(sha256sum "$rel/manifest.json" | cut -d' ' -f1)
  # Guard: when this is the owner-signed release, its manifest SHA must match the expected one.
  if [ "$rel" = "$ARM_RELEASE" ] && [ -n "$ARM_SHA" ] && [ "$sha" != "$ARM_SHA" ]; then
    say "STOP: $rel manifest SHA $sha != expected $ARM_SHA (wrong or tampered release)" >&2; exit 1
  fi
  local run=(run --suite lite --tasks "$task" --plant-release "$rel" --plant-release-sha256 "$sha"
    --extra-tasks "$rel/tasks" --hide "$CHECKOUT" --python "$VENV/bin/python" --plant-python "$VENV/bin/python"
    --parallel 1 --isolate none --allow-unisolated --out "$R/out-arm-trial")
  local pinbak=""
  if [ "${ARM_HARNESS:-strands}" = strands ]; then
    # Default: the Strands/Bedrock harness, USD-costed, so the owner's USD 8 cap applies. --dry-run uses a free
    # scripted (fake) model so the agent drives the arm with no Bedrock call and no spend. Strands arms are "st-plant-*"
    # and take no --agent-engine.
    if ! "$STRANDS_PYTHON" -c 'import strands' 2>/dev/null; then
      if [ "$DRY" = 1 ]; then say "arm trial SKIPPED (dry-run): no strands-agents at $STRANDS_PYTHON"; printf 'skipped: no strands-agents\n' > "$log"; return 0; fi
      say "STOP: STRANDS_PYTHON ($STRANDS_PYTHON) has no strands-agents" >&2; exit 1
    fi
    run+=(--arms st-plant-policy --strands-python "$STRANDS_PYTHON")
    if [ "$DRY" = 1 ]; then
      run+=(--model "fake:$ARM_FAKE")
      # Only pin a throwaway key when the release is not already pinned (the owner-signed release verifies as-is).
      if ! node "$CHECKOUT/bench/physical/ci/plant-release.js" verify --release "$rel" >/dev/null 2>&1 && [ -f "$CANDPUB" ]; then
        pinbak="$LOGDIR/pinned-keys.bak"; cp "$CHECKOUT/bench/runner/lib/plant/pinned-keys.json" "$pinbak"; node "$CHECKOUT/bench/physical/ci/plant-release.js" pin --public "$CANDPUB" >/dev/null
      fi
    else
      [ -r "$ARM_AWS_CREDS" ] || { say "STOP: no AWS credentials file at $ARM_AWS_CREDS for the real Bedrock run (set ARM_AWS_CREDS/ARM_AWS_PROFILE)" >&2; exit 1; }
      # A Strands Bedrock run takes --aws-profile only (NOT --aws-creds-file, which bench refuses for Strands). bench
      # resolves the profile with the AWS CLI, which reads the creds/config files we point it at via env below.
      run+=(--model "bedrock:$ARM_MODEL" --budget-usd 8 --aws-profile "$ARM_AWS_PROFILE")
    fi
  else
    # ARM_HARNESS=kiro: kiro-cli, credit-costed (a USD cap does not apply).
    run+=(--arms plant-policy --kiro-bin "$(command -v kiro-cli || true)" --agent-engine v3)
    if [ "$DRY" = 1 ]; then run+=(--prepare-only); else run+=(--budget-credits "${ARM_CREDITS:-$PERCALL}"); fi
  fi
  say "arm trial starting ($([ "$DRY" = 1 ] && echo 'FREE' || echo "PAID, ${ARM_HARNESS:-strands}")); task $task; log $log"
  # AWS_SHARED_CREDENTIALS_FILE/AWS_CONFIG_FILE let bench's `aws configure export-credentials --profile` find the keys
  # without this script ever reading them; they are inert for the fake-model and kiro paths.
  local arm_rc=0
  set +e
  TMPDIR=/tmp LD_LIBRARY_PATH="$FFI" BENCH_ARM_PYTHON="$VENV/bin/python" \
    AWS_SHARED_CREDENTIALS_FILE="$ARM_AWS_CREDS" AWS_CONFIG_FILE="$ARM_AWS_CONFIG" \
    nice -n 19 "${BJ[@]}" "${run[@]}" 2>&1 | tee "$log"
  arm_rc=${PIPESTATUS[0]}
  set -e
  [ -n "$pinbak" ] && cp "$pinbak" "$CHECKOUT/bench/runner/lib/plant/pinned-keys.json"
  # Charge the ledger only when the paid run actually started and finished (exit 0). A usage error such as a rejected
  # flag exits nonzero before any spend, so it must never count 15 credits against the cap.
  if [ "$DRY" = 1 ]; then :
  elif [ "$arm_rc" = 0 ]; then ledger_add "arm-trial" "$PERCALL"
  else say "arm trial did NOT complete (bench exit $arm_rc); ledger NOT charged"; fi
  say "arm trial done (exit $arm_rc)"
}

# Sourcing hook for tests (test-wave0-paid-path.sh): when sourced with WAVE0_LIB=1, define the config and
# functions above but do NOT run the paid flow below (no wait, no heavy lock, no wave 0, no arm trial).
if [ "${WAVE0_LIB:-0}" = 1 ]; then return 0; fi

say "run-physical-ai-wave0.sh ($([ "$DRY" = 1 ] && echo DRY-RUN || echo PAID)); logs under $LOGDIR"
wait_quiet
# Hold the heavy lock for the whole paid run (fd 9, released when the script exits). Dry-run skips it (plumbing test).
if [ "$DRY" = 0 ]; then
  exec 9>"$HEAVY_LOCK"
  say "taking the heavy lock..."
  flock -x 9
  say "heavy lock held"
fi
wave0
arm_trial
say "DONE. Paths:"
say "  wave 0 log:   $LOGDIR/wave0.log"
say "  arm trial log:$LOGDIR/arm-trial.log"
say "  spend ledger: $LEDGER"
say "  wave 0 out:   $R/out-wave0 (report: $R/out-wave0-report/plant-report.md)"
say "  arm out:      $R/out-arm-trial"
