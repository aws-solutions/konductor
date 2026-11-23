#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Free test of sign-arm-r2.sh: its --dry-run path (throwaway key, scratch keys file) builds and verifies a 15-task
# plant-arm-r2 whose 12 r1 tasks are byte-identical, with r1's Kiro CLI pin and exact wheels; a wrong r1 hash stops it.
set -uo pipefail
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SELF/sign-arm-r2.sh"
R1=/var/tmp/plant-arm-release/release
T=$(mktemp -d /var/tmp/test-sign-r2.XXXXXX)
pass=0; fail=0
ok() { echo "ok - $1"; pass=$((pass + 1)); }
bad() { echo "not ok - $1"; fail=$((fail + 1)); }

out="$T/run1.out"
ARM_R2_DEST="$T/r2" bash "$SCRIPT" --dry-run > "$out" 2>&1; rc=$?
[ "$rc" = 0 ] && ok "dry run exits 0" || { bad "dry run exits 0 (rc=$rc)"; sed 's/^/  /' "$out"; }
REL="$T/r2/release"
n=$(ls "$REL"/tasks/*.json 2>/dev/null | wc -l)
[ "$n" = 15 ] && ok "release holds 15 tasks" || bad "release holds 15 tasks (has $n)"
same=1; for f in "$R1"/tasks/*.json; do cmp -s "$f" "$REL/tasks/$(basename "$f")" || same=0; done
[ "$same" = 1 ] && ok "the 12 r1 tasks are byte-identical" || bad "the 12 r1 tasks are byte-identical"
python3 - "$REL/manifest.json" "$R1/manifest.json" <<'PY' && ok "manifest: plant-arm-r2, 15 seeds, r1 Kiro CLI pin, exact wheels" || bad "manifest fields"
import json, sys
m, r1 = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
assert m["release"] == "plant-arm-r2", m["release"]
assert len(m["seeds"]) == 15 and all(m["seeds"][k] == v for k, v in r1["seeds"].items())
assert m["versions"] == r1["versions"]
assert m["wheels"] == {"mujoco": "3.13.0", "numpy": "2.5.5", "cedarpy": "4.12.2"}, m["wheels"]
assert "*" not in m["wheels"].values()
PY
grep -q '^  ARM_SHA=[0-9a-f]\{64\}$' "$out" && ok "prints the manifest SHA-256" || bad "prints the manifest SHA-256"
grep -q 'verify ok' "$out" && ok "the release verifies against the throwaway keys file" || bad "verify"

ARM_R2_DEST="$T/r2b" ARM_R1_SHA=$(printf '0%.0s' {1..64}) bash "$SCRIPT" --dry-run > "$T/run2.out" 2>&1; rc2=$?
[ "$rc2" != 0 ] && grep -q 'is not r1' "$T/run2.out" && ok "a wrong r1 hash stops before signing" || bad "a wrong r1 hash stops (rc=$rc2)"
[ ! -e "$T/r2b" ] && ok "nothing is built after that stop" || bad "nothing is built after that stop"

# The run made $T; remove only it (relative path, as the crew policy wants).
cd /var/tmp && chmod -R u+rwX "$(basename "$T")" && find "$(basename "$T")" -delete
echo "pass $pass fail $fail"
[ "$fail" = 0 ]
