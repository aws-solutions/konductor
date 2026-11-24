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
#   bash "$CHECKOUT/bench/scripts/plant-wave.sh" 4 --plan          # free: tasks, trials, ceiling, expected credits
#   bash "$CHECKOUT/bench/scripts/plant-wave.sh" --list            # print the wave table
#
# Wave 4 (D-249) runs two parts from its own signed release plant-counted-r1-w4, cut only then so the held-back
# variants stay off the host until the last wave: the normal tasks three times each, then the held-back variants. The
# second part's ceiling is what the wave's 49 credits leave after the first part's spend.
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
#   PLANT_NORMAL    wave 4: a folder holding the normal tasks plant-n*.json (required for wave 4; no default)
#   PLANT_HELDBACK_SHA256  wave 4: the held-back folder hash recorded at freeze; a paid wave 4 stops without it

set -euo pipefail
unset R CHECKOUT VENV OUT KBIN 2>/dev/null || true   # ignore stale bare env vars; PLANT_* names are the overrides

# wave -> task-id prefixes (csv), ceiling (--budget-credits), per-run limit (--run-credit-limit), isolation, part,
# replicates, release (release: the counted-set release; w4: wave 4's own). A wave with two rows runs them in order.
WAVES='0 plant-p1-overspeed 45 2 none main 1 release
1 plant-p1-overspeed 45 2 unshare main 1 release
2 plant-p2-guard-no-approval,plant-p5-injected-text,plant-p7-jam-link-loss 134 2 unshare main 1 release
3 plant-p3-stale-read,plant-p4-out-of-range,plant-p6-state-change 83 2 unshare main 1 release
4 plant-n 12 2 unshare normal 3 w4
4 plant-p 37 2 unshare heldback 1 w4'
# Mean credits per trial of the four short pilots (physical-ai-counted-set.md, "Waves"): the plan's expected spend.
MEAN_CREDITS=0.37

stop() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

usage() {
  say "usage: bash plant-wave.sh WAVE [--plan] [--prepare-only] [--wait] | --list"
  say "waves (wave prefixes ceiling per-run-limit isolation part replicates release):"
  say "$WAVES"
  say "wave 0 is the dev-box NOT COUNTED dress rehearsal (p1); waves 1-4 are counted on a quiet host."
}

WAVE=""; PREP=0; WAIT=0; PLAN=0
for a in "$@"; do
  case "$a" in
    --plan) PLAN=1 ;;
    --prepare-only) PREP=1 ;;
    --wait) WAIT=1 ;;
    --list) usage; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    [0-4]) WAVE=$a ;;
    *) usage >&2; exit 64 ;;
  esac
done
[ -n "$WAVE" ] || { usage >&2; exit 64; }

PARTS=$(printf '%s\n' "$WAVES" | awk -v w="$WAVE" '$1 == w')
[ -n "$PARTS" ] || stop "no wave $WAVE (try --list)"
read -r _ _ _ _ ISO _ <<<"$(printf '%s\n' "$PARTS" | head -1)"
CEIL=$(printf '%s\n' "$PARTS" | awk '{c += $3} END {print c}')

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CHECKOUT=${PLANT_CHECKOUT:-$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || true)}
[ -n "$CHECKOUT" ] && [ -f "$CHECKOUT/bench/runner/bench.js" ] || stop "set PLANT_CHECKOUT to a konductor checkout on feat/bench-pilot-nk (its bench/runner/bench.js must exist)"

CS=${PLANT_CS:-}
[ -n "$CS" ] && [ -d "$CS/release/tasks" ] || stop "set PLANT_CS to the private counted-set folder (it must hold release/tasks)${CS:+; $CS has none}"

# --- wave 4: the normal tasks, and the held-back folder checked against its freeze hash ---
NORMAL=""; HB=""; HB_SHA=""; HB_UNSET=0
if [ "$WAVE" = 4 ]; then
  NORMAL=${PLANT_NORMAL:-}
  [ -n "$NORMAL" ] && compgen -G "$NORMAL/plant-n*.json" >/dev/null || stop "wave 4 needs PLANT_NORMAL: a folder holding the normal tasks plant-n*.json (for example the plant-r2 release tasks)${NORMAL:+; $NORMAL has none}"
  HB="$CS/held-back"
  [ -d "$HB/tasks" ] || stop "wave 4 needs $HB/tasks (the held-back variants)"
  HB_SHA=$(python3 "$here/lib/heldback_sha.py" "$HB") || stop "could not hash $HB"
  if [ -n "${PLANT_HELDBACK_SHA256:-}" ]; then
    [ "$HB_SHA" = "$PLANT_HELDBACK_SHA256" ] || stop "the held-back folder $HB ($HB_SHA) is not the one recorded at freeze ($PLANT_HELDBACK_SHA256)"
    say "held-back sha256 $HB_SHA: matches the freeze record"
  else
    HB_UNSET=1
    say "held-back sha256 $HB_SHA (PLANT_HELDBACK_SHA256 is not set: a paid wave 4 stops; set it to the hash recorded at freeze)"
  fi
fi

# The folder a part's tasks come from before the release is cut: the counted-set release, the normal tasks or held back.
source_dir() { case "$1" in normal) printf '%s' "$NORMAL" ;; heldback) printf '%s' "$HB/tasks" ;; *) printf '%s' "$CS/release/tasks" ;; esac; }
# The ids (csv) of the task files in dir $2 whose names start with one of the csv prefixes $1.
tasks_of() {
  local out="" pre f
  for pre in ${1//,/ }; do
    for f in "$2/$pre"*.json; do [ -e "$f" ] && out="${out:+$out,}$(basename "$f" .json)"; done
  done
  printf '%s' "$out"
}
count_csv() { if [ -n "$1" ]; then printf '%s' "$1" | tr ',' '\n' | grep -c .; else echo 0; fi; }
expected() { awk -v t="$1" -v m="$MEAN_CREDITS" 'BEGIN{printf "%.1f", t * m}'; }

# --- --plan: free, no venv, key or kiro-cli; what the wave would run and spend ---
if [ "$PLAN" = 1 ]; then
  all=0
  while read -r _ pre ceil _ _ part reps _; do
    n=$(count_csv "$(tasks_of "$pre" "$(source_dir "$part")")")
    trials=$((n * 2 * reps)); all=$((all + trials))
    rword=replicates; [ "$reps" = 1 ] && rword=replicate
    say "part $part: $n tasks x 2 arms x $reps $rword = $trials trials; ceiling $ceil credits; expected about $(expected "$trials") credits"
  done <<<"$PARTS"
  say "wave $WAVE total: $all trials, ceiling $CEIL credits, expected about $(expected "$all") credits (pilot mean $MEAN_CREDITS a trial)"
  say "free checks first: bash $here/plant-wave.sh $WAVE --prepare-only"
  say "paid run (owner): bash $here/plant-wave.sh $WAVE"
  exit 0
fi

if [ -z "${PLANT_VENV:-}" ]; then
  VENV=${BENCH_ARM_PYTHON:-}
  [ -n "$VENV" ] || { [ -x "$CHECKOUT/.venv/bin/python" ] && VENV=$CHECKOUT/.venv/bin/python; } || VENV=$(command -v python3.12 || true)
else VENV=$PLANT_VENV; fi
if [ -n "${VENV:-}" ] && [ -L "$VENV" ] && [ ! -e "$VENV" ] && [ -f "$(dirname "$(dirname "$VENV")")/pyvenv.cfg" ]; then
  stop "PLANT_VENV ($VENV) does not run: its base Python is gone. Rebuild the venv: bash bench/ops/workspace/rebuild-arm-venv.sh --venv $(dirname "$(dirname "$VENV")")"
fi
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
REL="$R/release"; FIELDS="$R/fields.json"; SHAFILE="$R/release.sha256"; RID=plant-counted-r1
if [ "$WAVE" = 4 ]; then REL="$R/release-w4"; FIELDS="$R/fields-w4.json"; SHAFILE="$R/release-w4.sha256"; RID=plant-counted-r1-w4; fi
export TMPDIR=/tmp
BJ=(node "$CHECKOUT/bench/runner/bench.js")
TOOL="$CHECKOUT/bench/physical/ci/plant-release.js"

[ "$ISO" = none ] && NOTE="dev box, NOT COUNTED" || NOTE="quiet host, counted"
say "wave $WAVE: $(printf '%s\n' "$PARTS" | awk '{printf "%s%s %s (%s credits)", (NR > 1 ? "; " : ""), $6, $2, $3}')"
say "  $NOTE; ceiling $CEIL credits, isolation $ISO"
say "  CHECKOUT=$CHECKOUT"
say "  CS=$CS   VENV=$VENV ($("$VENV" --version 2>&1))"
say "  KBIN=$NB ($("$NB" --version 2>/dev/null | head -1))   R=$R"

# --- cut and sign the release once; reuse it across waves so the seeds stay stable (wave 4 cuts its own) ---
if [ -f "$REL/manifest.json.sig" ] && [ -f "$SHAFILE" ]; then
  SHA=$(cat "$SHAFILE")
  say "reusing the signed release in $REL (sha256 $SHA)"
else
  mkdir -p "$R"
  rm -rf "$REL"
  cp -r "$CS/release" "$REL"
  if [ "$WAVE" = 4 ]; then
    rm -f "$REL"/tasks/*.json
    cp "$HB"/tasks/*.json "$NORMAL"/plant-n*.json "$REL/tasks/"
  fi
  kver=$("$NB" --version 2>/dev/null | head -1); ksha=$(sha256sum "$NB" | cut -d' ' -f1)
  node "$here/lib/sh.js" seeds "$REL/tasks" "$FIELDS" "$kver" "$ksha"
  if [ -r "$KEY" ]; then
    signout=$(node "$TOOL" sign --release "$REL" --key "$KEY" --release-id "$RID" --fields "$FIELDS" 2>&1) || stop "sign failed:
$signout"
    say "$signout"
    SHA=$(printf '%s\n' "$signout" | grep -oE '[0-9a-f]{64}' | tail -1)
    [ -n "$SHA" ] || stop "sign did not print a manifest SHA-256 (see the lines above)"
    printf '%s\n' "$SHA" > "$SHAFILE"
    say "signed with $KEY; release sha256 $SHA"
  else
    stop "no signing key at $KEY. Sign it yourself, then run this script again:
    node $TOOL sign --release $REL --key <YOUR Ed25519 PRIVATE KEY> --release-id $RID --fields $FIELDS
  then: printf '%s\\n' <the manifest SHA-256 it prints> > $SHAFILE
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

# --- each part: its task list and run command; the wave's ceiling is shared, so a later part gets what is left ---
ISOARGS=(--isolate unshare)
[ "$ISO" = none ] && ISOARGS=(--isolate none --allow-unisolated)
out_of() { if [ "$WAVE" = 4 ]; then printf '%s' "$R/out-wave4-$1"; else printf '%s' "$R/out-wave$WAVE"; fi; }
run_args() { # tasks replicates ceiling per-run-limit
  RUN=(run --suite lite --tasks "$1" --replicates "$2" --arms plant-policy,plant-allowall
    --plant-release "$REL" --plant-release-sha256 "$SHA" --extra-tasks "$REL/tasks" --hide "$CHECKOUT"
    --python "$VENV" --plant-python "$VENV" --agent-engine v3 --parallel 1
    --budget-credits "$3" --run-credit-limit "$4" "${ISOARGS[@]}")
}
PLAN_LINES=()
while read -r _ pre ceil runlim _ part reps _; do
  t=$(tasks_of "$pre" "$REL/tasks")
  [ -n "$t" ] || stop "no task files for wave $WAVE part $part under $REL/tasks"
  say "part $part ($(count_csv "$t") tasks x $reps): $t"
  PLAN_LINES+=("$part $ceil $runlim $reps $t")
done <<<"$PARTS"

if [ "$PREP" = 1 ]; then
  for line in "${PLAN_LINES[@]}"; do
    read -r part ceil runlim reps t <<<"$line"
    run_args "$t" "$reps" "$ceil" "$runlim"
    PO=$(mktemp -d /tmp/plant-prep.XXXXXX)
    say "prepare-only, part $part (no agent started), out $PO:"
    nice -n 10 "${BJ[@]}" "${RUN[@]}" --out "$PO" --prepare-only
    rm -rf -- "$PO"
  done
  say "prepare-only passed. Paid run: bash $CHECKOUT/bench/scripts/plant-wave.sh $WAVE"
  [ "$HB_UNSET" = 1 ] && say "  (a paid wave 4 also needs PLANT_HELDBACK_SHA256 set to the hash recorded at freeze)"
  exit 0
fi

[ "$HB_UNSET" = 1 ] && stop "set PLANT_HELDBACK_SHA256 to the held-back hash recorded at freeze (this folder hashes to $HB_SHA); a paid wave 4 runs only the frozen held-back set"
[ "$ISO" = unshare ] && { unshare -Urm true 2>/dev/null || stop "user namespaces are blocked here (--isolate unshare needs them): run from your own terminal on the quiet host"; }
for line in "${PLAN_LINES[@]}"; do
  read -r part _ <<<"$line"
  o=$(out_of "$part")
  [ -e "$o" ] && stop "$o exists: move it aside (mv $o $o.old), then run again"
done

LEFT=$CEIL
for line in "${PLAN_LINES[@]}"; do
  read -r part ceil runlim reps t <<<"$line"
  OUT=$(out_of "$part")
  cap=$(awk -v c="$ceil" -v l="$LEFT" 'BEGIN{printf "%.2f", (c < l ? c : l)}')
  awk -v c="$cap" -v r="$runlim" 'BEGIN{exit !(c >= r)}' || stop "part $part: only $cap of the wave's $CEIL credits are left, under one run's limit $runlim; stop and ask the owner"
  run_args "$t" "$reps" "$cap" "$runlim"
  say "paid run, part $part, starts now ($NOTE, ceiling $cap credits). Log: $OUT.log"
  set +e
  nice -n 10 "${BJ[@]}" "${RUN[@]}" --out "$OUT" 2>&1 | tee "$OUT.log"
  rc=${PIPESTATUS[0]}
  set -e
  report_cmd="node $CHECKOUT/bench/runner/bench.js plant-report --run $OUT --release $REL --out $OUT-report"
  say ""
  say "result table (free):"
  say "  $report_cmd"
  eval "$report_cmd" >/dev/null 2>&1 && sed -n '1,3p' "$OUT-report/plant-report.md" || say "  (plant-report failed; paste $OUT.log)"
  cr=$("$VENV" -c "import json;print(round(json.load(open('$OUT/summary.json'))['totalCredits'],2))" 2>/dev/null || echo "?")
  say "credits, part $part: $cr"
  say "paste back to the lead: $OUT-report/plant-report.md, the credits line, the last 40 lines of $OUT.log, $OUT/run-config.json"
  [ "$rc" = 0 ] || { say "part $part exited $rc; later parts do not start"; exit "$rc"; }
  [ "$cr" = "?" ] && stop "part $part: no credit total in $OUT/summary.json, so the wave's spend is unknown; later parts do not start"
  LEFT=$(awk -v l="$LEFT" -v c="$cr" 'BEGIN{printf "%.2f", l - c}')
done
say "wave $WAVE done: $(awk -v c="$CEIL" -v l="$LEFT" 'BEGIN{printf "%.2f", c - l}') of $CEIL credits spent"
