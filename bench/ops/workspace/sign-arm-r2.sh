#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# sign-arm-r2.sh -- sign arm release plant-arm-r2 in ONE command, from the owner's own terminal. Free: no model.
#
# plant-arm-r2 = the signed plant-arm-r1 (its 12 tasks and every other file, byte for byte) + the 3 new variants
# plant-a1-overspeed.v03, plant-a3-hidden-person.v03, plant-a4-pillar-contact.v03 from the arm draft, with r1's
# seeds and Kiro CLI pin, the draft's seeds for the 3 new tasks, and EXACT wheel pins (DEBT D-30) checked against the
# arm venv before signing. The key is passed to plant-release.js as a path only; this script never reads or prints it.
#
#   bash scripts/sign-arm-r2.sh            # real: signs with PLANT_KEY, verifies against the runner's pinned keys
#   bash scripts/sign-arm-r2.sh --dry-run  # free: a throwaway key, pinned into a scratch keys file (not the runner)
#
# Overrides (env): PLANT_CHECKOUT, PLANT_KEY (default ~/.plant-release-key/private.pem), PLANT_VENV, PLANT_FFI,
# ARM_R1 (signed r1 release dir), ARM_R1_SHA, ARM_DRAFT, ARM_R2_DEST, ARM_R2_ID.
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
DRY=0; for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; -h|--help) sed -n '2,18p' "$0"; exit 0 ;; *) echo "unknown arg $a" >&2; exit 64 ;; esac; done

W=$KONDUCTOR_WS
CHECKOUT=${PLANT_CHECKOUT:-$W/worktrees/konductor-plant/.worktrees/arm-test}
VENV=${PLANT_VENV:-/home/$USER/.cache/konductor-arm/venv}
FFI=${PLANT_FFI:-/local/apollo/package/local_1/AL2023_x86_64/Libffi/Libffi-119967.0-0/lib}
KEY=${PLANT_KEY:-$HOME/.plant-release-key/private.pem}
R1=${ARM_R1:-/var/tmp/plant-arm-release/release}
R1_SHA=${ARM_R1_SHA:-bcaa554d17e2f31ae382a79f6aa8b325f04b867a2899b5d0ca6f59dd412a79a8}
DRAFT=${ARM_DRAFT:-$W/plant-release-arm-draft}
# Outside home, scratch and the repo, as the runner requires. A dry run never lands where the real release goes.
if [ "$DRY" = 1 ]; then DEST=${ARM_R2_DEST:-/var/tmp/plant-arm-r2-dry}; else DEST=${ARM_R2_DEST:-/var/tmp/plant-arm-r2}; fi
RID=${ARM_R2_ID:-plant-arm-r2}
NEW="plant-a1-overspeed.v03 plant-a3-hidden-person.v03 plant-a4-pillar-contact.v03"
# D-30: the exact wheels the 90-trial arm test ran on (arm venv, 2026-11-22). sign refuses when the venv differs.
WHEELS='{"mujoco": "3.13.0", "numpy": "2.5.5", "cedarpy": "4.12.2"}'
# D-179: the checkout's bench/physical/gateway-wheels.json is the one copy; use it when the checkout has it.
if [ -f "$CHECKOUT/bench/physical/gateway-wheels.json" ]; then
  WHEELS=$(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1])))' "$CHECKOUT/bench/physical/gateway-wheels.json")
fi
TOOL="$CHECKOUT/bench/physical/ci/plant-release.js"
stop() { echo "STOP: $*" >&2; exit 1; }

[ -f "$TOOL" ] || stop "no plant-release.js at $TOOL (set PLANT_CHECKOUT)"
[ -f "$R1/manifest.json.sig" ] || stop "no signed r1 release at $R1 (set ARM_R1)"
[ "$(sha256sum "$R1/manifest.json" | cut -d' ' -f1)" = "$R1_SHA" ] || stop "$R1/manifest.json is not r1 ($R1_SHA)"
for t in $NEW; do [ -f "$DRAFT/tasks/$t.json" ] || stop "no draft task $DRAFT/tasks/$t.json"; done
[ -x "$VENV/bin/python" ] || stop "no arm venv at $VENV (set PLANT_VENV)"

# --- the arm venv must hold exactly the pinned wheels ---
LD_LIBRARY_PATH="$FFI" "$VENV/bin/python" - "$WHEELS" <<'PY' || stop "the arm venv wheels differ from the pins (see above)"
import importlib.metadata as m, json, sys
pins = json.loads(sys.argv[1])
bad = {k: (v, m.version(k)) for k, v in pins.items() if m.version(k) != v}
for k, (want, got) in bad.items(): print(f"wheel {k}: pinned {want}, venv has {got}")
sys.exit(1 if bad else 0)
PY
echo "wheels ok: $WHEELS"

# --- build the release: r1's files, then the 3 new tasks ---
[ -e "$DEST" ] && mv "$DEST" "$DEST.old-$(date +%s)"
REL="$DEST/release"
mkdir -p "$DEST"
cp -r "$R1" "$REL"
rm -f "$REL/manifest.json" "$REL/manifest.json.sig"
for t in $NEW; do
  [ -e "$REL/tasks/$t.json" ] && stop "r1 already holds $t"
  cp "$DRAFT/tasks/$t.json" "$REL/tasks/"
done

# --- fields: r1's seeds, versions and formats, the draft's seeds for the new tasks, the exact wheels ---
python3 - "$R1/manifest.json" "$DRAFT/plant-fields-arm.json" "$NEW" "$WHEELS" "$DEST/fields.json" <<'PY'
import json, sys
r1, draft, new, wheels, out = sys.argv[1], sys.argv[2], sys.argv[3].split(), json.loads(sys.argv[4]), sys.argv[5]
m = json.load(open(r1)); d = json.load(open(draft))["seeds"]
fields = {k: m[k] for k in ("seeds", "versions", "formats", "model", "window", "armOrderSeed") if k in m}
missing = [t for t in new if t not in d]
if missing: sys.exit(f"STOP: the draft has no seed for {missing}")
fields["seeds"] = {**fields["seeds"], **{t: d[t] for t in new}}
fields["wheels"] = wheels
json.dump(fields, open(out, "w"), indent=1)
print(f"fields: {len(fields['seeds'])} seeds, Kiro CLI {fields['versions']['kiroCli']['version']}, wheels {wheels}")
PY

# --- sign: the real key by path, or a throwaway one under --dry-run ---
KEYS_ARG=()
if [ "$DRY" = 1 ]; then
  TK="$DEST/dry-key"; node "$TOOL" keygen --out "$TK" >/dev/null; KEY="$TK/private.pem"
  printf '[]\n' > "$DEST/pinned.json"; node "$TOOL" pin --public "$TK/public.pem" --keys "$DEST/pinned.json" >/dev/null
  KEYS_ARG=(--keys "$DEST/pinned.json")
  echo "dry-run: throwaway key, pinned into $DEST/pinned.json (NOT the runner)"
else
  [ -r "$KEY" ] || stop "no signing key at $KEY (set PLANT_KEY to your Ed25519 private key)"
fi
signout=$(node "$TOOL" sign --release "$REL" --key "$KEY" --release-id "$RID" --fields "$DEST/fields.json")
SHA=$(printf '%s\n' "$signout" | grep -oE '[0-9a-f]{64}' | tail -1)
[ -n "$SHA" ] || stop "sign printed no manifest SHA-256"
node "$TOOL" verify --release "$REL" "${KEYS_ARG[@]}" >/dev/null || stop "verify failed; if your key is not pinned in the runner, pin its PUBLIC key: node $TOOL pin --public <public key .pem>"
echo "verify ok"

# --- the 12 r1 tasks must be byte-identical to r1 ---
for f in "$R1"/tasks/*.json; do cmp -s "$f" "$REL/tasks/$(basename "$f")" || stop "$(basename "$f") differs from r1"; done

echo ""
echo "$RID signed: $(ls "$REL"/tasks/*.json | wc -l) tasks"
echo "  ARM_RELEASE=$REL"
echo "  ARM_SHA=$SHA"
echo "Next (free, waits for the heavy lock): the arm test on r2"
echo "  ARM_RELEASE=$REL ARM_SHA=$SHA bash $W/scripts/run-arm-test-on-head.sh"
