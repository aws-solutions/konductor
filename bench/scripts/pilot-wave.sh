#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# pilot-wave.sh: run one wave of the scenario pilot (plan section 8a) from the owner's own terminal.
#
#   bash "$R/bench/scripts/pilot-wave.sh" 1                 # wave 1 (T4), paid
#   bash "$R/bench/scripts/pilot-wave.sh" 1 --prepare-only  # free: every check, then bench run --prepare-only
#   bash "$R/bench/scripts/pilot-wave.sh" --list            # print the wave table
#   bash "$R/bench/scripts/pilot-wave.sh" 2 --only-skipped-from /tmp/pilot-w2 --ceiling 55 --out /tmp/pilot-w2b
#                                                            # rerun only the tasks a wave's ceiling skipped
# Options: --tasks ID,ID (a subset of the ready tasks), --only-skipped-from DIR (the tasks DIR's run marked
#   budget_skipped), --ceiling N and --run-limit N (override the wave's), --out DIR, --no-wait (stop at once when
#   load is 4 or more instead of waiting up to 60 minutes for it to drop).
#
# Environment (each has a default the script looks for; set it to override):
#   R      a clean worktree of feat/bench-pilot-nk (default: the repo this script sits in)
#   KBIN   the pinned kiro-cli 3.5.0 (default: /var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli, then kiro-cli on PATH)
#   PY312  a real Python 3.12 binary, not a version-manager shim
#          (default: the newest ~/.local/share/mise/installs/python/3.12*/bin/python3.12, then python3.12 on PATH)
#   OUT    the wave's output dir (default: /tmp/pilot-wN)
#   KBIN_SHA256  the pin to check KBIN against (default: the pinned 3.5.0 copy); tests set it for a stub
# The paid run uses vanilla Kiro CLI, claude-sonnet-5.5, effort high, 1 replicate, one run at a time.
# A run the service throttled (ClientThrottleError and the like, DEBT D-138) is rerun once into OUT-retry, within
# what is left of the wave's ceiling; its table is OUT-retry-table.md.
# Waves 9 to 12 (the batches added on 2026-11-20):
#   9  t9   browser tasks: the whole wave holds /var/tmp/konductor-heavy.lock, and each Playwright run takes about
#           690 MB, so its per-run limit is low (10) and runs stay one at a time.
#   10 t10  long multi-phase tasks: the highest per-run limit (25).
#   11 t11  t11-fresh-session-memory opens a fresh second session, which only the Kiro CLI and Claude Code arms
#           support; this script's arm is vanilla Kiro CLI, so it runs.
#   12 t12  t12-mux-parallel-merge needs tmux and t12-cmux-parallel-merge needs cmux; a task whose tool is not on
#           PATH is left out with a message (cmux is not on the bench host: DEBT D-126).

set -euo pipefail

PIN_DEFAULT=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
# wave -> batch, soft cap, ceiling (--budget-credits), per-run limit (--run-credit-limit; it flags a run, it does
# not stop one, so each ceiling keeps 25% margin: DEBT D-67). Waves 9 to 12 are sized from waves 1 to 7, which spent
# about 2 to 9 credits per task (wave 3: 14 runs, 55 credits): ready tasks x about 6, plus margin.
WAVES='1 t4 100 125 20
2 t5 60 75 15
3 t6 145 180 45
4 t3 145 180 15
5 t1 65 80 15
6 t2 90 110 15
7 t7 55 70 10
8 t8 65 80 15
9 t9 60 75 10
10 t10 60 75 25
11 t11 60 75 15
12 t12 90 115 20'

stop() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

usage() {
  say "usage: bash pilot-wave.sh WAVE [--prepare-only] [--tasks ID,ID] [--only-skipped-from DIR] [--ceiling N] [--run-limit N] [--out DIR] [--no-wait] | --list"
  say "waves (wave batch softcap ceiling per-run-limit):"
  say "$WAVES"
}

ARGS_NO_PREP=$(printf ' %q' "$@" | sed 's/ --prepare-only//')
WAVE=""; PREP=0; WAIT=1; ONLY=""; SKIPFROM=""; CEIL_OPT=""; RUNLIM_OPT=""; OUT_OPT=""
need() { [ "$#" -ge 2 ] && [ -n "$2" ] || { say "$1 needs a value" >&2; usage >&2; exit 64; }; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prepare-only) PREP=1 ;;
    --no-wait) WAIT=0 ;;
    --tasks) need "$@"; ONLY=$2; shift ;;
    --only-skipped-from) need "$@"; SKIPFROM=$2; shift ;;
    --ceiling) need "$@"; CEIL_OPT=$2; shift ;;
    --run-limit) need "$@"; RUNLIM_OPT=$2; shift ;;
    --out) need "$@"; OUT_OPT=$2; shift ;;
    --list) usage; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    [1-9]|1[0-2]) WAVE=$1 ;;
    *) usage >&2; exit 64 ;;
  esac
  shift
done
[ -n "$WAVE" ] || { usage >&2; exit 64; }
[ -z "$ONLY" ] || [ -z "$SKIPFROM" ] || { say "use --tasks or --only-skipped-from, not both" >&2; exit 64; }
for n in "$CEIL_OPT" "$RUNLIM_OPT"; do case "$n" in ''|*[!0-9]*) [ -z "$n" ] || { say "--ceiling and --run-limit take a whole number of credits" >&2; exit 64; } ;; esac; done

read -r _ B SOFT CEIL RUNLIM <<<"$(printf '%s\n' "$WAVES" | awk -v w="$WAVE" '$1 == w')"
[ -n "${B:-}" ] || stop "no wave $WAVE"
[ -z "$CEIL_OPT" ] || CEIL=$CEIL_OPT
[ -z "$RUNLIM_OPT" ] || RUNLIM=$RUNLIM_OPT
[ -z "$OUT_OPT" ] || OUT=$OUT_OPT

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
R=${R:-$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || true)}
[ -n "$R" ] && [ -f "$R/bench/runner/bench.js" ] || stop "R is not a konductor checkout with bench/: set R to a clean worktree of feat/bench-pilot-nk"

if [ -z "${KBIN:-}" ]; then
  if [ -x /var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli ]; then KBIN=/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli
  else KBIN=$(command -v kiro-cli || true); fi
fi
[ -n "${KBIN:-}" ] && [ -x "$KBIN" ] || stop "no kiro-cli found: set KBIN to the pinned kiro-cli 3.5.0"

if [ -z "${PY312:-}" ]; then
  PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12*/bin/python3.12 2>/dev/null | sort -V | tail -1 || true)
  [ -n "$PY312" ] || PY312=$(command -v python3.12 || true)
fi
[ -n "${PY312:-}" ] && [ -x "$PY312" ] || stop "no Python 3.12 found: set PY312 to a real python3.12 binary"
case "$PY312" in */shims/*) stop "PY312 is a version-manager shim ($PY312); the sandbox cannot follow it. Use the real binary, for example $HOME/.local/share/mise/installs/python/3.12.x/bin/python3.12" ;; esac
"$PY312" -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)' || stop "PY312 ($PY312) is not Python 3.12"

OUT=${OUT:-/tmp/pilot-w$WAVE}
export TMPDIR=/tmp
BJ=(node "$R/bench/runner/bench.js")

say "wave $WAVE: batch $B, soft cap $SOFT credits, ceiling $CEIL, per-run limit $RUNLIM"
say "R=$R"
say "KBIN=$KBIN"
say "PY312=$PY312 ($("$PY312" --version 2>&1))"

[ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes: use a clean worktree (git -C <clone> worktree add --detach <dir> origin/feat/bench-pilot-nk)"
say "bench commit $(git -C "$R" rev-parse HEAD)"

[ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "${KBIN_SHA256:-$PIN_DEFAULT}" ] || stop "$KBIN is not the pinned kiro-cli copy (sha256 differs): set KBIN to the pinned 3.5.0 binary"
"$KBIN" --version 2>/dev/null | grep -qx 'kiro-cli 3.5.0' || stop "$KBIN is not kiro-cli 3.5.0 ($("$KBIN" --version 2>&1 | head -1))"
say "kiro-cli: pinned 3.5.0, ok"

if "$KBIN" whoami >/dev/null 2>&1; then say "kiro login: ok"
elif [ "$PREP" = 1 ]; then say "kiro login: NOT signed in (would stop a paid run; run: $KBIN login)"
else stop "Kiro login expired or missing: run '$KBIN login', then run this script again"; fi

load=$(cut -d' ' -f1 /proc/loadavg)
if ! awk -v l="$load" 'BEGIN { exit !(l < 4) }'; then
  say "load $load is 4 or more. Top processes by CPU:"
  ps -eo pid,user,pcpu,etime,args --sort=-pcpu | head -6 | cut -c1-140
  if [ "$PREP" = 1 ]; then say "(a paid run would wait here; --prepare-only goes on)"
  elif [ "$WAIT" = 0 ]; then stop "load $load is 4 or more: ask the lead to pause its workers, or wait for a quiet host, then run again"
  else
    waited=0
    while ! awk -v l="$load" 'BEGIN { exit !(l < 4) }'; do
      [ "$waited" -lt 3600 ] || stop "load stayed at 4 or more for 60 minutes (now $load): ask the lead to pause its workers, then run again"
      say "waiting for load under 4 (now $load, waited ${waited}s; Ctrl-C to give up)"
      sleep 60; waited=$((waited + 60)); load=$(cut -d' ' -f1 /proc/loadavg)
    done
  fi
fi
awk -v l="$load" 'BEGIN { exit !(l < 4) }' && say "load $load: ok"

if [ "$PREP" = 0 ] && [ -e "$OUT" ]; then stop "$OUT exists: move it aside (mv $OUT $OUT.old), then run again"; fi

TASKS=$("${BJ[@]}" scenarios ready --batch "$B" --ids) || stop "'bench.js scenarios ready --batch $B' failed (see above)"
[ -n "$TASKS" ] || stop "no ready task in $B: see '${BJ[*]} scenarios ready --batch $B'"
if [ -n "$SKIPFROM" ]; then
  [ -d "$SKIPFROM" ] || stop "$SKIPFROM is not a wave output dir"
  ONLY=$(node -e '
    const fs = require("fs"), path = require("path");
    const root = process.argv[1], ids = new Set();
    for (const arm of fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")))
      for (const task of fs.readdirSync(path.join(root, arm.name), { withFileTypes: true }).filter((d) => d.isDirectory()))
        for (const rep of fs.readdirSync(path.join(root, arm.name, task.name))) {
          const f = path.join(root, arm.name, task.name, rep, "result.json");
          try { if (JSON.parse(fs.readFileSync(f, "utf8")).status === "budget_skipped") ids.add(task.name); } catch {}
        }
    process.stdout.write([...ids].sort().join(","));' "$SKIPFROM")
  [ -n "$ONLY" ] || stop "no budget_skipped task in $SKIPFROM: nothing to rerun"
  say "skipped in $SKIPFROM: $ONLY"
fi
if [ -n "$ONLY" ]; then
  keep=""; IFS=, read -r -a want <<<"$ONLY"
  for t in "${want[@]}"; do
    case ",$TASKS," in *",$t,"*) keep=${keep:+$keep,}$t ;; *) say "not ready, left out: $t" ;; esac
  done
  [ -n "$keep" ] || stop "none of the chosen tasks is ready in $B"
  TASKS=$keep
fi
# A task whose orchestrator tool is not on this host would only fail: leave it out and say why.
for pair in t12-mux-parallel-merge:tmux t12-cmux-parallel-merge:cmux; do
  t=${pair%%:*}; tool=${pair##*:}
  case ",$TASKS," in *",$t,"*)
    if ! command -v "$tool" >/dev/null 2>&1; then
      TASKS=$(printf '%s' ",$TASKS," | sed "s/,$t,/,/; s/^,//; s/,$//")
      say "skipped $t: $tool is not on PATH on this host (DEBT D-126); install $tool to run it"
    fi ;;
  esac
done
[ -n "$TASKS" ] || stop "no runnable task left in $B"
say "ready tasks ($(printf '%s' "$TASKS" | tr ',' '\n' | grep -c .)): $TASKS"

# Browser waves hold the heavy lock for the whole run, so no other Playwright job shares the host's memory.
LOCK=()
[ "$B" != t9 ] || LOCK=(flock -x /var/tmp/konductor-heavy.lock)

RUN=(run --suite pilot --tasks "$TASKS" --arms vanilla --replicates 1 --parallel 1
  --extra-tasks "$R/bench/scenarios/$B" --repo-root "$R" --hide "$R" --isolate unshare --seed 20261119
  --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" --python "$PY312"
  --budget-credits "$CEIL" --run-credit-limit "$RUNLIM")

if [ "$PREP" = 1 ]; then
  PO=$(mktemp -d -t pilot-prep.XXXXXX)
  # set -e ends the script when prepare-only fails, so the trap removes the dir on that path too.
  trap 'rm -rf -- "$PO"' EXIT
  say "prepare-only (no agent started), out $PO:"
  nice -n 10 "${BJ[@]}" "${RUN[@]}" --out "$PO" --prepare-only
  [ "${#LOCK[@]}" = 0 ] || say "(the paid run holds ${LOCK[*]})"
  say "prepare-only passed. Paid run: bash $R/bench/scripts/pilot-wave.sh$ARGS_NO_PREP"
  exit 0
fi

unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them): run from your own terminal"

say "paid run starts now (ceiling $CEIL credits). Log: $OUT.log"
[ "${#LOCK[@]}" = 0 ] || say "holding ${LOCK[*]} for the whole wave"
set +e
"${LOCK[@]}" nice -n 10 "${BJ[@]}" "${RUN[@]}" --out "$OUT" 2>&1 | tee "$OUT.log"
rc=${PIPESTATUS[0]}
set -e
"${BJ[@]}" scenarios pilot-table "$OUT" | tee "$OUT-table.md" || say "WARNING: pilot-table failed; paste $OUT.log"

# Retry once: the runs the service throttled, within what is left of the ceiling (DEBT D-138).
retry=$(node "$R/bench/scenarios/wave-retry.js" "$OUT" --ceiling "$CEIL" || true)
rtasks=$(printf '%s' "$retry" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tasks.join(","))}catch{}})')
rleft=$(printf '%s' "$retry" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).left))}catch{process.stdout.write("0")}})')
if [ -n "$rtasks" ]; then
  if [ "$rleft" -ge "$RUNLIM" ] && [ ! -e "$OUT-retry" ]; then
    say "throttled by the service: $rtasks. Retrying once into $OUT-retry (ceiling $rleft credits)"
    RETRY_RUN=("${RUN[@]}")
    for i in "${!RETRY_RUN[@]}"; do
      case "${RETRY_RUN[$i]}" in --tasks) RETRY_RUN[i+1]=$rtasks ;; --budget-credits) RETRY_RUN[i+1]=$rleft ;; esac
    done
    set +e
    "${LOCK[@]}" nice -n 10 "${BJ[@]}" "${RETRY_RUN[@]}" --out "$OUT-retry" 2>&1 | tee "$OUT-retry.log"
    set -e
    "${BJ[@]}" scenarios pilot-table "$OUT-retry" | tee "$OUT-retry-table.md" || say "WARNING: pilot-table failed on $OUT-retry"
  else
    say "throttled by the service: $rtasks. Not retried ($rleft credits left of the ceiling, or $OUT-retry exists): rerun with --tasks $rtasks --out $OUT-retry"
  fi
fi
say ""
say "run exit code $rc. Paste back to the lead:"
say "  $OUT-table.md"
[ ! -e "$OUT-retry-table.md" ] || say "  $OUT-retry-table.md"
say "  the last 40 lines of $OUT.log"
say "  $OUT/run-config.json (or the newest $OUT/run-configs/*.json)"
say "Table again: ${BJ[*]} scenarios pilot-table $OUT"
exit "$rc"
