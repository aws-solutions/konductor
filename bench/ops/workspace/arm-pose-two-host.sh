#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# arm-pose-two-host.sh -- the two-host pose repeat check of DEBT D-30, in one command per step. Free: no model, no
# gateway, no release; about two seconds of simulator time.
#
#   bash scripts/arm-pose-two-host.sh here                 # this host: writes reports/arm-pose-<host>-<date>.json
#   bash scripts/arm-pose-two-host.sh compare A.json B.json   # exit 0: same poses on every case; 1: names what differs
#
# On the second host (any Linux x86_64 or arm64 box, NOT this dev desktop), from a checkout of the SAME commit:
#   python3.12 -m venv /tmp/arm-venv && /tmp/arm-venv/bin/pip install mujoco==3.13.0 numpy==2.5.5 cedarpy==4.12.2
#   /tmp/arm-venv/bin/python bench/physical/ci/arm_pose_fingerprint.py --out arm-pose-hostB.json
# then copy arm-pose-hostB.json back here and run `compare` on it and this host's file.
#
# Overrides (env): PLANT_CHECKOUT, PLANT_VENV, PLANT_FFI, POSE_REPORTS.
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
W=$KONDUCTOR_WS
CHECKOUT=${PLANT_CHECKOUT:-$W/worktrees/konductor-plant/.worktrees/arm-test}
VENV=${PLANT_VENV:-/home/$USER/.cache/konductor-arm/venv}
FFI=${PLANT_FFI:-/local/apollo/package/local_1/AL2023_x86_64/Libffi/Libffi-119967.0-0/lib}
REPORTS=${POSE_REPORTS:-$W/reports}
TOOL="$CHECKOUT/bench/physical/ci/arm_pose_fingerprint.py"
[ -f "$TOOL" ] || { echo "STOP: no $TOOL (set PLANT_CHECKOUT to a checkout at or after the commit that adds it)" >&2; exit 1; }
case "${1:-}" in
  here)
    out="$REPORTS/arm-pose-$(hostname -s)-$(date -u +%Y%m%d).json"
    LD_LIBRARY_PATH="$FFI" "$VENV/bin/python" "$TOOL" --out "$out"
    echo "commit: $(git -C "$CHECKOUT" rev-parse HEAD)   (the second host must use this commit)" ;;
  compare)
    [ $# -eq 3 ] || { echo "usage: $0 compare A.json B.json" >&2; exit 64; }
    LD_LIBRARY_PATH="$FFI" "$VENV/bin/python" "$TOOL" --compare "$2" "$3" ;;
  *) sed -n '2,16p' "$0"; exit 64 ;;
esac
