#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-strands-counted-trial.sh -- paid-path test for strands-counted-trial.sh, with a stub checkout, release, venvs,
# release tool and bench: no model, no keys, no spend, a private heavy lock. Checks that the paid path
#   1. stops before signing or running anything when a counting gate fails (this host: no user namespaces);
#   2. with every gate passing (a stub unshare on PATH, a quiet stub host, a low load file), signs, runs prepare-only
#      and then exactly one paid bench run with the pinned model, the cap, the profile and --isolate unshare, and
#      reaches its PASS verdict from the trial's result.json;
#   3. fails its verdict when the trial did not count.
#
#   bash scripts/test-strands-counted-trial.sh
set -uo pipefail
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
T=$(mktemp -d /tmp/st-trial-test.XXXXXX)
trap 'chmod -R u+rwX "$T"; rm -rf "$T"' EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }
TASK=plant-p1-overspeed.v01

mkdir -p "$T/co/bench/runner/lib/plant" "$T/co/bench/physical/ci" "$T/co/bench/physical/strands/plant_strands" \
  "$T/co/bench/physical/controls/strands" "$T/base/tasks" "$T/venv/bin" "$T/ws/reports" "$T/out" "$T/bin"
printf '{"release":"plant-r2","seeds":{"%s":1},"versions":{"kiroCli":{"version":"x"}}}\n' "$TASK" > "$T/base/manifest.json"
: > "$T/base/manifest.json.sig"; printf '{}\n' > "$T/base/tasks/$TASK.json"
BASE_SHA=$(sha256sum "$T/base/manifest.json" | cut -d' ' -f1)
printf '#!/bin/sh\necho 1.65.0\n' > "$T/stpy"; printf '#!/bin/sh\nexit 0\n' > "$T/venv/bin/python"; chmod +x "$T/stpy" "$T/venv/bin/python"
: > "$T/key.pem"
printf '{"models":{"qwen.qwen3-coder-next":{"inputUsdPerMTok":0.5,"outputUsdPerMTok":1.2,"maxTokens":4096}}}\n' > "$T/co/bench/physical/strands/plant_strands/bedrock_models.json"
printf '{}\n' > "$T/co/bench/physical/controls/strands/path-strands.json"
printf 'module.exports = { hostNoise: () => (process.env.NOISY ? ["tcp 127.0.0.1:1"] : []) };\n' > "$T/co/bench/runner/lib/plant/walls.js"
# stub release tool: sign writes a manifest and prints a SHA; verify passes; keygen and pin make their files
cat > "$T/co/bench/physical/ci/plant-release.js" <<'JS'
const fs = require('fs'); const path = require('path'); const a = process.argv.slice(2); const v = (k) => a[a.indexOf(k) + 1];
fs.appendFileSync(process.env.CALLS, `release ${a[0]}\n`);
if (a[0] === 'sign') { const f = JSON.parse(fs.readFileSync(v('--fields'), 'utf8')); fs.writeFileSync(path.join(v('--release'), 'manifest.json'), JSON.stringify({ release: v('--release-id'), ...f })); console.log('manifest SHA-256 ' + 'a'.repeat(64)); }
if (a[0] === 'keygen') { fs.mkdirSync(v('--out'), { recursive: true }); fs.writeFileSync(path.join(v('--out'), 'private.pem'), ''); fs.writeFileSync(path.join(v('--out'), 'public.pem'), ''); }
JS
# stub bench: logs argv; a run writes one trial whose plant.counted follows COUNTED
cat > "$T/co/bench/runner/bench.js" <<'JS'
const fs = require('fs'); const path = require('path'); const a = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, `bench ${a.join(' ')}\n`);
if (a.includes('--prepare-only')) process.exit(0);
const d = path.join(a[a.indexOf('--out') + 1], 'st-plant-policy', a[a.indexOf('--tasks') + 1], '1'); fs.mkdirSync(d, { recursive: true });
const counted = process.env.COUNTED !== '0';
fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ costUsd: 0.002, plant: { runState: 'complete', safety: 'safe', counted, notCounted: counted ? [] : ['run without sandbox'], counts: { mismatches: 0, calls: 2 } } }));
JS
printf '#!/bin/sh\nexit 0\n' > "$T/bin/unshare"; chmod +x "$T/bin/unshare"
echo "0.50 0.40 0.30 1/100 1" > "$T/loadavg"

run() {  # run [env...]: the paid path with every override pointed at the stubs
  env CALLS="$T/calls" PLANT_CHECKOUT="$T/co" PLANT_KEY="$T/key.pem" PLANT_VENV="$T/venv" PLANT_FFI="$T" ST_BASE="$T/base" \
    ST_BASE_SHA="$BASE_SHA" ST_PYTHON="$T/stpy" ST_WORKSPACE="$T/ws" ST_HEAVY_LOCK="$T/heavy.lock" ST_OUT_ROOT="$T/out" "$@" \
    bash "$SELF/strands-counted-trial.sh" --cap-usd 1 > "$T/log" 2>&1
}

bash -n "$SELF/strands-counted-trial.sh" && ok "bash -n clean" || bad "syntax"

: > "$T/calls"
run NOISY=1 ST_LOADAVG="$T/loadavg" PATH="$T/bin:$PATH"; rc=$?
[ "$rc" = 1 ] && grep -q "STOP: not run, it could not count: quiet host" "$T/log" && ok "a failed gate stops the paid path and names the gate" || { bad "gate stop (rc $rc)"; cat "$T/log"; }
[ -s "$T/calls" ] && bad "something ran despite a failed gate: $(cat "$T/calls")" || ok "nothing signed or run after a failed gate"

: > "$T/calls"
run ST_LOADAVG="$T/loadavg" PATH="$T/bin:$PATH"; rc=$?
[ "$rc" = 0 ] && grep -q "^PASS: one counted Strands trial on the real model" "$T/log" && ok "all gates pass: the paid path reaches PASS" || { bad "paid path rc $rc"; cat "$T/log"; }
[ "$(grep -c '^bench run' "$T/calls")" = 2 ] && grep -q -- '--prepare-only' "$T/calls" && ok "prepare-only, then one paid run" || bad "bench calls: $(grep -c '^bench' "$T/calls")"
paid=$(grep '^bench run' "$T/calls" | grep -v -- '--prepare-only')
for want in "--model bedrock:qwen.qwen3-coder-next" "--budget-usd 1" "--aws-profile bench-strands" "--isolate unshare" "--plant-release $T/out/plant-st-r2/release"; do
  case "$paid" in *"$want"*) ok "paid run has $want" ;; *) bad "paid run lacks $want" ;; esac
done
grep -q '"strands":{"version":"1.65.0"}' "$T/out/plant-st-r2/release/manifest.json" && ok "the signed release pins strands-agents 1.65.0" || bad "no strands pin in the release"
[ -z "$(ls -A "$T/out" | grep -v '^plant-st-r2$')" ] && ok "only the release is left in the out root" || bad "out root: $(ls -A "$T/out")"

run COUNTED=0 ST_LOADAVG="$T/loadavg" PATH="$T/bin:$PATH"; rc=$?
[ "$rc" = 1 ] && grep -q "^FAIL: counted" "$T/log" && ok "a trial that did not count fails the verdict" || { bad "not-counted verdict rc $rc"; cat "$T/log"; }

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
