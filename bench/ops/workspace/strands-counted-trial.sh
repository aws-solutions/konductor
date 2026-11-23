#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# strands-counted-trial.sh -- ONE counted Strands plant trial on the real pinned model, in one command from the owner's
# own terminal (KR k9c5fffd6 asks for one trial; this one is meant to count). PAID: one trial of plant-p1-overspeed.v01
# on st-plant-policy, model bedrock:qwen.qwen3-coder-next, capped by bench before every model call (--budget-usd).
#
# A Strands trial counts only when all of these hold (bench/runner/lib/plant/intake.js countingOf, strandsSuiteOf):
#   1. the release pins the strands-agents version (versions.strands.version) and the venv has that version;
#   2. it runs in the sandbox (--isolate unshare), which needs user namespaces: the owner's terminal, not an agent's;
#   3. the host is quiet: no TCP or UDP listener on loopback or wildcard that the release does not allow.
# No signed release pins Strands yet, so this script builds plant-st-r2: the signed plant-r2 conveyor release, byte for
# byte, with versions.strands added, signed with the owner's key (by path only; never read or printed here).
#
#   bash scripts/strands-counted-trial.sh --dry-run      # FREE: checks every gate and prints PASS or FAIL for each;
#        builds plant-st-r2 with a throwaway key and verifies it against a scratch keys file; runs the same trial
#        with the scripted fake model (path-strands.json) on the signed plant-r2 (a control: no model, no keys, no
#        cost); prints the paid command and the cap estimate
#   bash scripts/strands-counted-trial.sh --cap-usd 1    # PAID, owner only: signs plant-st-r2 with PLANT_KEY, stops
#        unless every gate passes, runs the trial, and checks from its result.json that it counted, completed, had
#        zero stream-to-gateway mismatches and cost no more than the cap
#
# Waits for the heavy lock (/var/tmp/konductor-heavy.lock) on the paid path. Overrides (env): PLANT_CHECKOUT,
# PLANT_KEY, PLANT_VENV, PLANT_FFI, ST_BASE, ST_BASE_SHA, ST_DEST, ST_RID, ST_PYTHON, ST_PIN, ST_TASK, ST_PROFILE,
# ST_WORKSPACE, ST_HEAVY_LOCK, ST_OUT_ROOT (the last three for tests).
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

stop() { echo "STOP: $*" >&2; exit 1; }

main() {
  local dry cap w checkout key venv ffi base base_sha dest rid stpy pin task profile heavy outroot model tool ts logdir
  local rel sha out fails gate_line keys_arg fake
  dry=0
  cap=""
  w=${ST_WORKSPACE:-$KONDUCTOR_WS}
  checkout=${PLANT_CHECKOUT:-$w/worktrees/konductor-plant/.worktrees/arm-test}
  key=${PLANT_KEY:-$HOME/.plant-release-key/private.pem}
  venv=${PLANT_VENV:-/home/$USER/.cache/konductor-arm/venv}
  ffi=${PLANT_FFI:-/local/apollo/package/local_1/AL2023_x86_64/Libffi/Libffi-119967.0-0/lib}
  base=${ST_BASE:-/var/tmp/plant-pilot-r2/release}
  base_sha=${ST_BASE_SHA:-54e6ba6c96f7cd7eab3abde3606b015b2c3cab275fc5acba98d002fd81976605}
  rid=${ST_RID:-plant-st-r2}
  stpy=${ST_PYTHON:-/home/$USER/strands-venv/bin/python}
  pin=${ST_PIN:-1.65.0}
  task=${ST_TASK:-plant-p1-overspeed.v01}
  profile=${ST_PROFILE:-bench-strands}
  heavy=${ST_HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
  outroot=${ST_OUT_ROOT:-/var/tmp}
  model=bedrock:qwen.qwen3-coder-next
  ts=$(date -u +%Y%m%d-%H%M%S)
  fails=()
  keys_arg=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1 ;;
      --cap-usd) cap=${2:?--cap-usd needs a number}; shift ;;
      -h|--help) sed -n '2,29p' "$0"; return 0 ;;
      *) echo "unknown argument: $1" >&2; return 64 ;;
    esac
    shift
  done
  dest=${ST_DEST:-$outroot/plant-st-r2}
  if [ "$dry" = 0 ] && [ -z "$cap" ]; then echo "a paid run needs --cap-usd N: the USD the owner approved for this one trial" >&2; return 64; fi
  tool="$checkout/bench/physical/ci/plant-release.js"
  rel=""
  fake="$checkout/bench/physical/controls/strands/path-strands.json"
  logdir="$w/reports/strands-counted-trial-$ts$([ "$dry" = 1 ] && echo -dry || true)"

  # --- hard checks: a wrong input stops here ---
  [ -f "$checkout/bench/runner/bench.js" ] || stop "no bench at $checkout (set PLANT_CHECKOUT)"
  [ -f "$tool" ] || stop "no plant-release.js at $tool"
  [ -f "$base/manifest.json.sig" ] || stop "no signed base release at $base (set ST_BASE)"
  [ "$(sha256sum "$base/manifest.json" | cut -d' ' -f1)" = "$base_sha" ] || stop "$base is not the release $base_sha"
  [ -f "$base/tasks/$task.json" ] || stop "no task $task in $base"
  [ "$("$stpy" -I -c 'import importlib.metadata as m; print(m.version("strands-agents"))' 2>/dev/null)" = "$pin" ] || stop "$stpy has no strands-agents $pin (set ST_PYTHON)"
  LD_LIBRARY_PATH="$ffi" "$venv/bin/python" -c 'import cedarpy' 2>/dev/null || stop "the plant venv $venv lacks cedarpy (set PLANT_VENV)"
  mkdir -p "$logdir"

  # --- the counting gates: the dry run reports them, the paid run stops on any FAIL ---
  gate() { if "${@:2}" >/dev/null 2>&1; then echo "PASS  $1"; else echo "FAIL  $1"; fails+=("$1"); fi; }
  gate "user namespaces (--isolate unshare)" unshare -Urm true
  gate "host load under 4" awk -v l="$(cut -d' ' -f1 "${ST_LOADAVG:-/proc/loadavg}")" 'BEGIN{exit !(l<4)}'
  gate_line=$(node -e '
    const fs = require("fs"), p = require("path");
    const { hostNoise } = require(p.join(process.argv[1], "bench/runner/lib/plant/walls.js"));
    const R = process.argv[2];
    const n = hostNoise({ sha256Of: (f) => (fs.existsSync(p.join(R, f)) ? "y" : null), fileOf: (f) => p.join(R, f) });
    console.log(n.length ? `${n.length} listener(s) the release does not allow: ${n.slice(0, 6).join(", ")}${n.length > 6 ? ", ..." : ""}` : "none");
  ' "$checkout" "$base")
  if [ "$gate_line" = none ]; then echo "PASS  quiet host"; else echo "FAIL  quiet host: $gate_line"; fails+=("quiet host"); fi
  echo "PASS  strands-agents $pin in $stpy; the release below pins it"
  if [ "$dry" = 0 ] && [ "${#fails[@]}" != 0 ]; then stop "not run, it could not count: ${fails[*]}. Run from your own terminal on a quiet host"; fi

  # --- the release: plant-r2 byte for byte, plus versions.strands ---
  # The dry run builds in a new dir it removes at the end; the paid run keeps its release (the report reads it).
  if [ "$dry" = 1 ]; then
    dest=$(mktemp -d "$outroot/plant-st-r2-dry.XXXXXX")
  else
    if [ -e "$dest" ]; then mv "$dest" "$dest.old-$(date +%s)"; fi
    mkdir -p "$dest"
  fi
  rel="$dest/release"
  cp -r "$base" "$rel"
  rm -f "$rel/manifest.json" "$rel/manifest.json.sig"
  node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const computed = ["manifestVersion", "release", "keyId", "files", "maxParallel", "analysisPlanSha256", "exclusionPolicy"];
    const fields = Object.fromEntries(Object.entries(m).filter(([k]) => !computed.includes(k)));
    fields.versions = { ...fields.versions, strands: { version: process.argv[2] } };
    fs.writeFileSync(process.argv[3], JSON.stringify(fields, null, 1));
  ' "$base/manifest.json" "$pin" "$dest/fields.json"
  if [ "$dry" = 1 ]; then
    node "$tool" keygen --out "$dest/dry-key" >/dev/null
    printf '[]\n' > "$dest/pinned.json"
    node "$tool" pin --public "$dest/dry-key/public.pem" --keys "$dest/pinned.json" >/dev/null
    key="$dest/dry-key/private.pem"
    keys_arg=(--keys "$dest/pinned.json")
    echo "dry run: $rid signed with a throwaway key, pinned in $dest/pinned.json (NOT the runner)"
  else
    [ -r "$key" ] || stop "no signing key at $key (set PLANT_KEY to your Ed25519 private key)"
  fi
  sha=$(node "$tool" sign --release "$rel" --key "$key" --release-id "$rid" --fields "$dest/fields.json" | grep -oE '[0-9a-f]{64}' | tail -1)
  [ -n "$sha" ] || stop "sign printed no manifest SHA-256"
  node "$tool" verify --release "$rel" ${keys_arg[@]+"${keys_arg[@]}"} >/dev/null || stop "verify failed; pin your PUBLIC key in the runner: node $tool pin --public <public key .pem>"
  for f in "$base"/tasks/*.json; do cmp -s "$f" "$rel/tasks/$(basename "$f")" || stop "$(basename "$f") differs from the base release"; done
  echo "PASS  $rid signed and verified, manifest SHA-256 $sha, strands-agents $pin pinned"

  # --- the cap estimate, from the pin file bench reads ---
  node -e '
    const pin = require(process.argv[1]).models["qwen.qwen3-coder-next"];
    const cap = Number(process.argv[2]);
    // shortcut: assumes a request of at most 64 KB (the 2026-11-18 trial sent far less); bench reserves the real bytes.
    const worst = ((64 * 1024 + 2000) * pin.inputUsdPerMTok + pin.maxTokens * pin.outputUsdPerMTok) / 1e6;
    console.log(`cap: each model call reserves at most about USD ${worst.toFixed(4)} (64 KB request + 2000 tokens at $${pin.inputUsdPerMTok}/M in, ${pin.maxTokens} tokens at $${pin.outputUsdPerMTok}/M out); ` +
      (cap > 0 ? `USD ${cap} covers at least ${Math.floor(cap / worst)} model calls; ` : "") + "the one real trial so far (2026-11-18) cost USD 0.0015");
  ' "$checkout/bench/physical/strands/plant_strands/bedrock_models.json" "${cap:-0}"

  local -a run_args=(run --suite lite --arms st-plant-policy --tasks "$task" --replicates 1 --parallel 1 --seed 1
    --strands-python "$stpy" --python "$venv/bin/python" --plant-python "$venv/bin/python" --hide "$checkout")
  if [ "$dry" = 1 ]; then
    out=$(mktemp -d "$outroot/strands-trial-$ts.XXXXXX")
    echo "dry run: the same trial with the scripted fake model on the signed plant-r2 (a control, free)"
    LD_LIBRARY_PATH="$ffi" TMPDIR=/tmp nice -n 19 node "$checkout/bench/runner/bench.js" "${run_args[@]}" --model "fake:$fake" \
      --plant-release "$base" --plant-release-sha256 "$base_sha" --extra-tasks "$base/tasks" --isolate none --allow-unisolated \
      --out "$out" > "$logdir/bench.log" 2>&1 || true
    echo "paid command (after the owner approves a cap): bash $0 --cap-usd <USD>"
  else
    exec 9>"$heavy"
    echo "waiting for the heavy lock $heavy ..."
    flock -x 9
    out=$(mktemp -d "$outroot/strands-trial-$ts.XXXXXX")
    local -a paid=("${run_args[@]}" --model "$model" --budget-usd "$cap" --aws-profile "$profile"
      --plant-release "$rel" --plant-release-sha256 "$sha" --extra-tasks "$rel/tasks" --isolate unshare)
    LD_LIBRARY_PATH="$ffi" TMPDIR=/tmp node "$checkout/bench/runner/bench.js" "${paid[@]}" --out "$out.prep" --prepare-only > "$logdir/prepare.log" 2>&1 \
      || stop "prepare-only failed (no model call made): see $logdir/prepare.log"
    echo "PAID: one trial on $model, at most USD $cap"
    LD_LIBRARY_PATH="$ffi" TMPDIR=/tmp nice -n 19 node "$checkout/bench/runner/bench.js" "${paid[@]}" --out "$out" > "$logdir/bench.log" 2>&1 || true
  fi

  # --- the verdict, from the trial's own result.json ---
  set +e
  OUT="$out" TASK="$task" CAP="${cap:-0}" DRY="$dry" python3 - <<'PY' | tee "$logdir/verdict.txt"
import glob, json, os, sys
out, task, cap, dry = os.environ["OUT"], os.environ["TASK"], float(os.environ["CAP"]), os.environ["DRY"] == "1"
files = glob.glob(os.path.join(out, "st-plant-policy", task, "1", "result.json"))
if not files:
    print(f"FAIL: no result.json under {out}"); sys.exit(1)
r = json.load(open(files[0])); p = r.get("plant") or {}
cost = r.get("costUsd")
checks = {
    "trial complete": p.get("runState") == "complete",
    "zero stream-to-gateway mismatches": (p.get("counts") or {}).get("mismatches") == 0,
    # The fake model is a control, so the dry run expects counted false with no reason; the paid trial must count.
    "counted" if not dry else "a control (not counted, no reason)": (p.get("counted") is True and not p.get("notCounted")) if not dry else (p.get("counted") is False and not p.get("notCounted")),
    "cost reported and within the cap": dry or (cost is not None and cost <= cap),
}
for name, ok in checks.items(): print(f"{'ok  ' if ok else 'FAIL'} {name}")
print(f"safety {p.get('safety')}, {(p.get('counts') or {}).get('calls')} plant call(s), cost USD {cost or 0:.4f}, notCounted {p.get('notCounted')}")
bad = [k for k, v in checks.items() if not v]
if bad: print("FAIL: " + "; ".join(bad)); sys.exit(1)
print("PASS: " + ("the trial shape works on the fake model (dry run)" if dry else "one counted Strands trial on the real model"))
PY
  local rc=${PIPESTATUS[0]}
  set -e
  mkdir -p "$logdir/run" && cp -r "$out/." "$logdir/run/" 2>/dev/null || true
  (cd "$outroot" && chmod -R u+rwX "$(basename "$out")" && find "$(basename "$out")" -delete) || echo "note: could not remove $out"
  if [ -d "$out.prep" ]; then (cd "$outroot" && chmod -R u+rwX "$(basename "$out").prep" && find "$(basename "$out").prep" -delete) || true; fi
  if [ "$dry" = 1 ]; then
    (cd "$outroot" && chmod -R u+rwX "$(basename "$dest")" && find "$(basename "$dest")" -delete) || echo "note: could not remove $dest"
    echo "release (dry, removed): $rid signed with a throwaway key, SHA-256 $sha; the owner's key gives another SHA"
  else
    echo "release: $rel (SHA-256 $sha)"
  fi
  echo "logs: $logdir"
  return "$rc"
}

main "$@"
