#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# plant-wave.sh: run one wave of the physical-AI counted set as ONE command, from the owner's own terminal.
# It cuts and signs the release, runs every free preflight check with a clear STOP (and what to do), then runs the
# wave. Only the paid run spends credits; --prepare-only does every check and a free `bench run --prepare-only`.
#
#   bash "$CHECKOUT/bench/scripts/plant-wave.sh" 0                 # wave 0 (p1, dev box, NOT COUNTED), paid
#   bash "$CHECKOUT/bench/scripts/plant-wave.sh" 0 --prepare-only  # free: all checks, then bench run --prepare-only
#   bash "$CHECKOUT/bench/scripts/plant-wave.sh" 0 --wait          # wait for a quiet host / login instead of STOP
#   bash "$CHECKOUT/bench/scripts/plant-wave.sh" --list            # print the wave table
#
# Overrides are PLANT_* only. Bare R / CHECKOUT / VENV / OUT / KBIN from the shell are IGNORED, because a stale one
# has broken runs; set the PLANT_* name to override a default:
#   PLANT_CHECKOUT  a konductor checkout with bench/ (default: the repo this script sits in)
#   PLANT_CS        the private counted-set folder holding release/ (required; no host path is assumed, D-182)
#   PLANT_VENV      a python 3.12 with cedarpy (default: BENCH_ARM_PYTHON, then <checkout>/.venv, then python3.12 on PATH)
#   PLANT_KBIN      the native kiro-cli binary, for the pin (default: from kiro-cli --version on PATH)
#   PLANT_KEY       the Ed25519 signing key (default: ~/.plant-release-key/private.pem)
#   PLANT_R         the working dir for the cut release and the wave out dirs (default: /var/tmp/plant-counted-r1)
#   PLANT_KEYS      a pinned-keys file for the `verify` step (default: the runner's own); the test sets a throwaway

set -euo pipefail
unset R CHECKOUT VENV OUT KBIN 2>/dev/null || true   # ignore stale bare env vars; PLANT_* names are the overrides

# wave -> probe-id prefixes (csv), ceiling (--budget-credits), per-run limit (--run-credit-limit), isolation
WAVES='0 plant-p1-overspeed 45 2 none
1 plant-p1-overspeed 45 2 unshare
2 plant-p2-guard-no-approval,plant-p5-injected-text,plant-p7-jam-link-loss 134 2 unshare
3 plant-p3-stale-read,plant-p4-out-of-range,plant-p6-state-change 83 2 unshare'

stop() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

usage() {
  say "usage: bash plant-wave.sh WAVE [--prepare-only] [--wait] | --list"
  say "waves (wave probes ceiling per-run-limit isolation):"
  say "$WAVES"
  say "wave 0 is the dev-box NOT COUNTED dress rehearsal (p1); waves 1-3 are counted on a quiet host."
}

WAVE=""; PREP=0; WAIT=0
for a in "$@"; do
  case "$a" in
    --prepare-only) PREP=1 ;;
    --wait) WAIT=1 ;;
    --list) usage; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    [0-3]) WAVE=$a ;;
    *) usage >&2; exit 64 ;;
  esac
done
[ -n "$WAVE" ] || { usage >&2; exit 64; }

read -r _ PREFIXES CEIL RUNLIM ISO <<<"$(printf '%s\n' "$WAVES" | awk -v w="$WAVE" '$1 == w')"
[ -n "${PREFIXES:-}" ] || stop "no wave $WAVE (try --list)"

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CHECKOUT=${PLANT_CHECKOUT:-$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || true)}
[ -n "$CHECKOUT" ] && [ -f "$CHECKOUT/bench/runner/bench.js" ] || stop "set PLANT_CHECKOUT to a konductor checkout on feat/bench-pilot-nk (its bench/runner/bench.js must exist)"

CS=${PLANT_CS:-}
[ -n "$CS" ] && [ -d "$CS/release/tasks" ] || stop "set PLANT_CS to the private counted-set folder (it must hold release/tasks)${CS:+; $CS has none}"

if [ -z "${PLANT_VENV:-}" ]; then
  VENV=${BENCH_ARM_PYTHON:-}
  [ -n "$VENV" ] || { [ -x "$CHECKOUT/.venv/bin/python" ] && VENV=$CHECKOUT/.venv/bin/python; } || VENV=$(command -v python3.12 || true)
else VENV=$PLANT_VENV; fi
[ -n "${VENV:-}" ] && [ -x "$VENV" ] || stop "set PLANT_VENV to a python 3.12 with cedarpy (none found)"
case "$VENV" in */shims/*) stop "PLANT_VENV is a version-manager shim ($VENV); use the real binary under .../installs/python/3.12.x/bin or a venv" ;; esac
"$VENV" -c 'import sys; sys.exit(0 if sys.version_info[:2]==(3,12) else 1)' || stop "PLANT_VENV ($VENV) is not Python 3.12"
"$VENV" -c 'import cedarpy' 2>/dev/null || stop "PLANT_VENV ($VENV) cannot import cedarpy: pip install cedarpy into that venv"

if [ -z "${PLANT_KBIN:-}" ]; then
  kv=$(kiro-cli --version 2>/dev/null | awk 'NR==1{print $2}' || true)
  [ -n "$kv" ] && [ -x "$HOME/.toolbox/tools/kiro-cli/$kv/kiro-cli" ] && NB="$HOME/.toolbox/tools/kiro-cli/$kv/kiro-cli" || NB=$(command -v kiro-cli || true)
else NB=$PLANT_KBIN; fi
[ -n "${NB:-}" ] && [ -x "$NB" ] || stop "set PLANT_KBIN to the native kiro-cli binary (none found on PATH)"

KEY=${PLANT_KEY:-$HOME/.plant-release-key/private.pem}
R=${PLANT_R:-/var/tmp/plant-counted-r1}
REL="$R/release"; FIELDS="$R/fields.json"; OUT="$R/out-wave$WAVE"
export TMPDIR=/tmp
BJ=(node "$CHECKOUT/bench/runner/bench.js")
TOOL="$CHECKOUT/bench/physical/ci/plant-release.js"

[ "$ISO" = none ] && NOTE="dev box, NOT COUNTED" || NOTE="quiet host, counted"
say "wave $WAVE: probes $PREFIXES"
say "  $NOTE; ceiling $CEIL credits, per-run limit $RUNLIM, isolation $ISO"
say "  CHECKOUT=$CHECKOUT"
say "  CS=$CS   VENV=$VENV ($("$VENV" --version 2>&1))"
say "  KBIN=$NB ($("$NB" --version 2>/dev/null | head -1))   R=$R"

# --- cut and sign the release once; reuse it across waves so the seeds stay stable ---
if [ -f "$REL/manifest.json.sig" ] && [ -f "$R/release.sha256" ]; then
  SHA=$(cat "$R/release.sha256")
  say "reusing the signed release in $REL (sha256 $SHA)"
else
  mkdir -p "$R"
  rm -rf "$REL"
  cp -r "$CS/release" "$REL"
  kver=$("$NB" --version 2>/dev/null | head -1); ksha=$(sha256sum "$NB" | cut -d' ' -f1)
  node -e 'const fs=require("fs"),a=process.argv.slice(1);const dir=a[0],out=a[1],ver=a[2],sha=a[3];const seeds={};for(const f of fs.readdirSync(dir)){if(!f.endsWith(".json"))continue;seeds[f.slice(0,-5)]=100000+Math.floor(Math.random()*900000);}fs.writeFileSync(out,JSON.stringify({seeds,versions:{kiroCli:{version:ver,sha256:sha,engine:"v3"}}},null,1)+"\n");' "$REL/tasks" "$FIELDS" "$kver" "$ksha"
  if [ -r "$KEY" ]; then
    signout=$(node "$TOOL" sign --release "$REL" --key "$KEY" --release-id plant-counted-r1 --fields "$FIELDS" 2>&1) || stop "sign failed:
$signout"
    say "$signout"
    SHA=$(printf '%s\n' "$signout" | grep -oE '[0-9a-f]{64}' | tail -1)
    [ -n "$SHA" ] || stop "sign did not print a manifest SHA-256 (see the lines above)"
    printf '%s\n' "$SHA" > "$R/release.sha256"
    say "signed with $KEY; release sha256 $SHA"
  else
    stop "no signing key at $KEY. Sign it yourself, then run this script again:
    node $TOOL sign --release $REL --key <YOUR Ed25519 PRIVATE KEY> --release-id plant-counted-r1 --fields $FIELDS
  then: printf '%s\\n' <the manifest SHA-256 it prints> > $R/release.sha256
  (set PLANT_KEY to your key path to have this script sign for you; the default is ~/.plant-release-key/private.pem)"
  fi
fi

# --- release intake check (signature, pinned key, every hash) ---
verify_keys=(); [ -n "${PLANT_KEYS:-}" ] && verify_keys=(--keys "$PLANT_KEYS")
node "$TOOL" verify --release "$REL" "${verify_keys[@]}" >/dev/null 2>&1 || stop "release intake failed: node $TOOL verify --release $REL${PLANT_KEYS:+ --keys $PLANT_KEYS}"
say "release intake: ok"

# --- the installed kiro-cli must match the release's pin ---
PIN_VER=$("$VENV" -c "import json;print(json.load(open('$FIELDS'))['versions']['kiroCli']['version'])")
PIN_SHA=$("$VENV" -c "import json;print(json.load(open('$FIELDS'))['versions']['kiroCli']['sha256'])")
[ "$("$NB" --version 2>/dev/null | head -1)" = "$PIN_VER" ] || stop "kiro-cli $("$NB" --version 2>/dev/null | head -1) is not the release pin $PIN_VER: restore that build, or remove $R to re-cut for the installed one"
[ "$(sha256sum "$NB" | cut -d' ' -f1)" = "$PIN_SHA" ] || stop "the kiro-cli binary SHA-256 is not the release pin: restore the pinned build, or remove $R to re-cut for the installed one"
say "kiro-cli pin: ok ($PIN_VER)"

# --- policy test (free, no model): every truth-table cell ---
"${BJ[@]}" plant-policy-test --release "$REL" --python "$VENV" >/dev/null 2>&1 || stop "plant-policy-test failed: node $CHECKOUT/bench/runner/bench.js plant-policy-test --release $REL --python $VENV"
say "policy test: ok"

# --- login and load gates: STOP, or WARN under --prepare-only, or poll under --wait ---
gate() { # description, check-cmd..., fix-message
  local desc=$1; shift
  local check=(); while [ "$1" != "--" ]; do check+=("$1"); shift; done; shift
  local fix=$1
  if "${check[@]}" >/dev/null 2>&1; then say "$desc: ok"; return 0; fi
  if [ "$WAIT" = 1 ]; then
    say "$desc: not ready, waiting (--wait). $fix"
    for _ in $(seq 1 120); do sleep 30; "${check[@]}" >/dev/null 2>&1 && { say "$desc: ok"; return 0; }; done
    stop "$desc still not ready after waiting. $fix"
  fi
  [ "$PREP" = 1 ] && { say "$desc: NOT ready (a paid run would STOP here; --prepare-only goes on). $fix"; return 0; }
  stop "$desc. $fix"
}
load_ok() { awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN{exit !(l<4)}'; }
gate "kiro login" "$NB" whoami -- "run: $NB login"
gate "host load under 4" load_ok -- "load is $(cut -d' ' -f1 /proc/loadavg); wait for a quiet box or pause other workers"

# --- build the wave's task list and run command ---
TASKS=""
for pre in ${PREFIXES//,/ }; do
  for f in "$REL/tasks/$pre".*.json; do
    [ -e "$f" ] || continue
    TASKS="${TASKS:+$TASKS,}$(basename "$f" .json)"
  done
done
[ -n "$TASKS" ] || stop "no task files for wave $WAVE under $REL/tasks"
say "tasks ($(printf '%s' "$TASKS" | tr ',' '\n' | grep -c .)): $TASKS"

ISOARGS=(--isolate unshare)
[ "$ISO" = none ] && ISOARGS=(--isolate none --allow-unisolated)
RUN=(run --suite lite --tasks "$TASKS" --arms plant-policy,plant-allowall
  --plant-release "$REL" --plant-release-sha256 "$SHA" --extra-tasks "$REL/tasks" --hide "$CHECKOUT"
  --python "$VENV" --plant-python "$VENV" --agent-engine v3 --parallel 1
  --budget-credits "$CEIL" --run-credit-limit "$RUNLIM" "${ISOARGS[@]}")

report_cmd="node $CHECKOUT/bench/runner/bench.js plant-report --run $OUT --release $REL --out $OUT-report"

if [ "$PREP" = 1 ]; then
  PO=$(mktemp -d /tmp/plant-prep.XXXXXX)
  say "prepare-only (no agent started), out $PO:"
  nice -n 10 "${BJ[@]}" "${RUN[@]}" --out "$PO" --prepare-only
  rm -rf -- "$PO"
  say "prepare-only passed. Paid run: bash $CHECKOUT/bench/scripts/plant-wave.sh $WAVE"
  say "After the paid run, the result table is: $report_cmd"
  exit 0
fi

[ "$ISO" = unshare ] && { unshare -Urm true 2>/dev/null || stop "user namespaces are blocked here (--isolate unshare needs them): run from your own terminal on the quiet host"; }
[ -e "$OUT" ] && stop "$OUT exists: move it aside (mv $OUT $OUT.old), then run again"

say "paid run starts now ($NOTE, ceiling $CEIL credits). Log: $OUT.log"
set +e
nice -n 10 "${BJ[@]}" "${RUN[@]}" --out "$OUT" 2>&1 | tee "$OUT.log"
rc=${PIPESTATUS[0]}
set -e

say ""
say "result table (free):"
say "  $report_cmd"
eval "$report_cmd" >/dev/null 2>&1 && sed -n '1,3p' "$OUT-report/plant-report.md" || say "  (plant-report failed; paste $OUT.log)"
cr=$("$VENV" -c "import json;print(round(json.load(open('$OUT/summary.json'))['totalCredits'],2))" 2>/dev/null || echo "?")
say "credits: $cr"
say ""
say "run exit code $rc. Paste back to the lead:"
say "  $OUT-report/plant-report.md"
say "  the credits line above ($cr)"
say "  the last 40 lines of $OUT.log"
say "  $OUT/run-config.json (or the newest $OUT/run-configs/*.json)"
exit "$rc"
