#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# sign-arm-release.sh -- sign the arm release in ONE command, from the owner's own terminal.
# It builds a complete release from the private arm draft (policy, schema, sensor-limits, truth-table, tasks/,
# refusal-rule, analysis-plan), signs it with the owner's REAL key, pins that key into the runner, verifies the
# intake, and prints the ARM_RELEASE / ARM_TASK / SHA to hand to run-physical-ai-wave0.sh. The key is used only as
# a file path by plant-release.js; this script never reads or prints its contents.
#
#   bash scripts/sign-arm-release.sh            # real: signs with PLANT_KEY, pins it in the runner
#   bash scripts/sign-arm-release.sh --dry-run  # free: throwaway key, pinned into a scratch keys file (not the runner)
#
# Overrides (env): PLANT_CHECKOUT, PLANT_KEY (default ~/.plant-release-key/private.pem), PLANT_VENV, ARM_DRAFT, ARM_DEST.
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
DRY=0; for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; -h|--help) sed -n '2,20p' "$0"; exit 0 ;; *) echo "unknown arg $a" >&2; exit 64 ;; esac; done

CHECKOUT=${PLANT_CHECKOUT:-$KONDUCTOR_WS/worktrees/konductor-plant/.worktrees/phys-nk}
VENV=${PLANT_VENV:-/home/$USER/.cache/konductor-arm/venv}
KEY=${PLANT_KEY:-$HOME/.plant-release-key/private.pem}
DRAFT=${ARM_DRAFT:-$KONDUCTOR_WS/plant-release-arm-draft}
DEST=${ARM_DEST:-/var/tmp/plant-arm-release}              # outside home/scratch/repo, as the runner requires
TOOL="$CHECKOUT/bench/physical/ci/plant-release.js"
KB=$(command -v kiro-cli || true)
REL="$DEST/release"
[ -d "$DRAFT/tasks" ] || { echo "STOP: no arm draft at $DRAFT (set ARM_DRAFT)" >&2; exit 1; }
[ -x "$VENV/bin/python" ] || { echo "STOP: no python3.12 venv at $VENV (set PLANT_VENV)" >&2; exit 1; }
[ -n "$KB" ] || { echo "STOP: no kiro-cli on PATH (needed for the version pin)" >&2; exit 1; }

# --- build the release dir from the draft (policy/schema/sensor-limits/truth-table/tasks + refusal-rule + analysis-plan) ---
[ -e "$DEST" ] && mv "$DEST" "$DEST.old-$(date +%s)"
mkdir -p "$REL"
for f in analysis-plan.md refusal-rule.json sensor-limits.json truth-table.json policy tasks; do cp -r "$DRAFT/$f" "$REL/"; done

# --- fields: the draft seeds + the installed kiro-cli pin + the wheel pins (D-30) ---
kver=$("$KB" --version | head -1); ksha=$(sha256sum "$KB" | cut -d' ' -f1)
"$VENV/bin/python" - "$DRAFT/plant-fields-arm.json" "$DEST/fields.json" "$kver" "$ksha" <<'PY'
import json, sys
seeds = json.load(open(sys.argv[1]))["seeds"]
json.dump({"seeds": seeds, "versions": {"kiroCli": {"version": sys.argv[3], "sha256": sys.argv[4], "engine": "v3"}},
           "wheels": {"mujoco": "3.13.0", "numpy": "*", "cedarpy": "*"}}, open(sys.argv[2], "w"), indent=1)
print(f"fields: {len(seeds)} seeds, kiroCli {sys.argv[3]}")
PY

# --- sign (real key, or a throwaway under --dry-run) ---
if [ "$DRY" = 1 ]; then
  TK=$(mktemp -d /tmp/arm-sign-dry.XXXX); node "$TOOL" keygen --out "$TK" >/dev/null; KEY="$TK/private.pem"
  KEYS="$DEST/pinned.json"; printf '[]\n' > "$KEYS"; node "$TOOL" pin --public "$TK/public.pem" --keys "$KEYS" >/dev/null
  echo "dry-run: signing with a throwaway key, pinned into $KEYS (NOT the runner)"
else
  [ -r "$KEY" ] || { echo "STOP: no signing key at $KEY (set PLANT_KEY to your Ed25519 private key)" >&2; exit 1; }
fi
signout=$(node "$TOOL" sign --release "$REL" --key "$KEY" --release-id plant-arm-r1 --fields "$DEST/fields.json")
SHA=$(printf '%s\n' "$signout" | grep -oE '[0-9a-f]{64}' | tail -1)
[ -n "$SHA" ] || { echo "STOP: sign did not print a manifest SHA-256" >&2; exit 1; }

# --- verify the intake ---
if [ "$DRY" = 1 ]; then
  node "$TOOL" verify --release "$REL" --keys "$KEYS" >/dev/null && echo "verify ok (throwaway keys file)"
else
  if node "$TOOL" verify --release "$REL" >/dev/null 2>&1; then
    echo "verify ok (the signing key is already pinned in the runner)"
  else
    echo "NOTE: your signing key is not pinned in the runner. Pin its PUBLIC key once, then this release verifies:"
    echo "  node $TOOL pin --public <your public key .pem>"
    echo "  node $TOOL verify --release $REL"
  fi
fi

echo ""
echo "arm release signed. Hand these to run-physical-ai-wave0.sh:"
echo "  ARM_RELEASE=$REL"
echo "  ARM_TASK=${ARM_TASK:-plant-a2-door-no-approval.v01}   # any id in $REL/tasks"
echo "  manifest SHA-256: $SHA"
echo "tasks available:"; ls "$REL"/tasks/*.json | xargs -n1 basename | sed 's/\.json$//' | sed 's/^/  /'
