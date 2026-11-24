#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# run-standard.sh: the STANDARD three-arm run (bench/docs/repeat.md section 7; plan P6 and P7). Owner terminal only: the
# paid stages need the sandbox (unshare), which an agent shell blocks, and they spend Kiro credits.
#
#   S=<study dir> R=<worktree> KBIN=<kiro-cli> bash run-standard.sh                  paid run in the background; log $S/run.log
#   S=<study dir> R=<worktree> KBIN=<kiro-cli> bash run-standard.sh --foreground     the same, in this terminal
#   S=<study dir> R=<worktree> KBIN=<kiro-cli> bash run-standard.sh --prepare-only   free: task gate, plan preview, the
#       konductor-noskills and konductor-list arms built and trial-installed, all four arms prepared by bench; no agent runs
#   Add --cargo-online to any of these when the crates are not in the offline cargo cache: every cap variant build and
#   bench run (and a resumed or background copy of the kit) then builds with network access.
#
# Tasks: bench `--level standard` over suites/pack.json (every DEV task), then the LITE gate rules (ready, no lock
# blocker, a passing non-Claude recheck at the current version); `helper.js plan` lists the rest as skipped.
# Arms: vanilla, konductor=<sha>, konductor-noskills=dir:<cap variant --preset noskills of the same sha> and
# konductor-list=dir:<cap variant --hook list of the same sha>: konductor plus the prompt hook that lists every skill name
# (the LITE hook study's list arm, bench/cap/nudge.js; planned cost 1.6 x plain, measured 1.43).
# Stage A is replicate 1 of every batch, stage B replicate 2, each capped at STAGE_CAP real credits (STAGE_CAP_DEFAULT, 1600). Before each
# batch: the credit ledger must have no entry of unknown cost, and what the stage cap leaves minus MARGIN must cover the
# batch's per-run limit (a one-shot run cannot be stopped mid-run, D-67), else the run stops cleanly. That rest is the
# batch's --budget-credits, so bench's own guard checks it before every run. Stage B starts only on a clean stage A
# (10% or less broken per arm, all four arms ran).
# S, the cache and the variant scratch must be outside HOME (default: under S). The first paid start freezes the plan
# (bench sha, konductor sha, noskills and list arms with their tree hashes, tasks) in $S/plan.json and this kit in $S/kit, and runs the
# frozen copy from then on. Rerun the same command to resume: finished batches are skipped, an unfinished one resumes
# (bench --resume). Nothing is deleted; an unfinished batch dir with no run-config.json is moved to $S/incomplete/.
#
# Needs: S (the study dir), R (a dedicated konductor worktree; the kit moves its pin, so run the kit from outside it),
# KBIN (the pinned kiro-cli 3.5.0). Optional: COST (pilot cost JSON, [{id, credits}]), REPORTS (a dir the tables are
# copied to), PY312, KONDUCTOR_SHA (default origin/main at the first start), BENCH_REF. Test overrides: HELPER,
# KBIN_PIN, NO_FETCH, HEAVY_LOCK, LITE_LOCK, OWN_LOCK, WAIT_MAX, WAIT_STEP, STAGE_CAP, STAGES (replicates, default 2), HOST_CHECK.
set -u

KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
S=${S:-}
R=${R:-}
ROOT=$S
REPORTS=${REPORTS:-}
CACHE=${CACHE:-$S/cache}
SCRATCH=${SCRATCH:-$S/variants}
HELPER=${HELPER:-$KIT/helper.js}
COST=${COST:-}
KBIN=${KBIN:-}
KBIN_PIN=${KBIN_PIN:-e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e}
PY312=${PY312:-}
KONDUCTOR_SHA=${KONDUCTOR_SHA:-}
BENCH_REF=${BENCH_REF:-origin/feat/bench-pilot-nk}
NO_FETCH=${NO_FETCH:-0}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
LITE_LOCK=${LITE_LOCK:-/var/tmp/konductor-lite.lock}
OWN_LOCK=${OWN_LOCK:-/var/tmp/konductor-standard.lock}
WAIT_MAX=${WAIT_MAX:-3600}; WAIT_STEP=${WAIT_STEP:-60}
STAGE_CAP_DEFAULT=1600 # real credits a stage (owner, 2026-11-24: the preview expects 1519 a stage)
STAGE_CAP=${STAGE_CAP:-$STAGE_CAP_DEFAULT}; MARGIN=25; STAGES=${STAGES:-2}
SEED=20261121
PLAN=$ROOT/plan.json
STOPPED=""
ARMS=""; NOSKILLS=""; LIST=""; BENCH_SHA=""; BATCHES=""
CARGO=() # (--cargo-online) when given: passed to every cap variant and bench run, and to the re-exec'd kit

say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }
q() { node -p "const p=require('$PLAN'); $1"; }

# under_home PATH: true when PATH (resolved through its nearest existing parent) is under HOME.
under_home() {
  local p=$1 real home
  home=$(realpath -m -- "$HOME"); real=$(realpath -m -- "$p")
  case "$real/" in "$home"/*) return 0 ;; esac
  return 1
}

# ---------- money (the test sources these with STANDARD_LIB=1)
# ledger DIR: "<credits> <unknown>" from every credit-ledger.jsonl under DIR (helper.js spent).
ledger() {
  local d=$1
  node "$HELPER" spent "$R" "$d" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(j.credits, j.unknown)'
}
# budget_for REP B: "<left> <spent in stage> <unknown>". left is what the stage cap leaves minus the margin; bench counts
# --budget-credits over this command's own spend only, so spend already in the stage is taken off here.
budget_for() {
  local rep=$1 b=$2 here unknown
  read -r here unknown < <(ledger "$ROOT/runs/r$rep")
  awk -v h="$here" -v c="$STAGE_CAP" -v m="$MARGIN" -v u="$unknown" 'BEGIN { printf "%d %s %s", c - h - m, h, u }'
}
# run_batch REP B: one batch of one stage. Sets STOPPED to stop the run.
run_batch() {
  local rep=$1 b=$2 U=$ROOT/runs/r$1/$2 left here unknown limit rc=0
  local -a A=() LOCK=()
  read -r left here unknown < <(budget_for "$rep" "$b")
  limit=$(q "p.batches['$b'].runLimit")
  if [ "$unknown" != 0 ]; then
    STOPPED="the credit ledger under $ROOT/runs/r$rep has $unknown entr(y/ies) of unknown cost before r$rep $b; check them before a rerun"
    return 0
  fi
  if awk -v x="$left" -v l="$limit" 'BEGIN { exit !(x < l) }'; then
    STOPPED="stage cap reached before r$rep $b: $here real credits spent in stage $rep, cap $STAGE_CAP, margin $MARGIN, run limit $limit"
    return 0
  fi
  wait_quiet || return 0
  "$KBIN" whoami >/dev/null 2>&1 || { STOPPED="Kiro login expired before r$rep $b: run '$KBIN login', then this script again"; return 0; }
  mapfile -t A < <(base_args "$b")
  A+=(--replicates 1 --replicate-offset $((rep - 1)) --budget-credits "$left" --run-credit-limit "$limit" --out "$U")
  if [ -f "$U/run-config.json" ]; then A+=(--resume)
  elif [ -e "$U" ]; then mv -- "$U" "$ROOT/incomplete/r$rep-$b.$(date +%s)"; fi
  [ "$b" = t9 ] && LOCK=(flock -x "$HEAVY_LOCK")
  say "r$rep $b: start, batch budget $left (stage $rep spent $here of $STAGE_CAP)"
  mkdir -p "$ROOT/runs/r$rep"
  "${LOCK[@]}" nice -n 10 node "$R/bench/runner/bench.js" "${A[@]}" >> "$U.log" 2>&1; rc=$?
  node "$R/bench/runner/bench.js" scenarios pilot-table "$U" > "$ROOT/tables/r$rep-$b.md" 2>> "$U.log"
  say "r$rep $b: exit $rc, stage $rep spent $(ledger "$ROOT/runs/r$rep" | cut -d' ' -f1); table tables/r$rep-$b.md"
  case "$rc" in
    0) touch "$U.done" ;;
    3) STOPPED="r$rep $b: bench credit guard stopped the batch (exit 3); stage cap reached" ;;
    6) STOPPED="r$rep $b stopped on login failures (exit 6): run '$KBIN login', then this script again" ;;
    *) STOPPED="r$rep $b: bench exit $rc (see $U.log); rerun to resume" ;;
  esac
  return 0
}

# ---------- a quiet host
# HOST_CHECK=0 (the stub test only) skips the process, load and user-namespace checks; the lock checks always run.
busy() {
  flock -n "$HEAVY_LOCK" true 2>/dev/null || { echo "the heavy lock $HEAVY_LOCK is held"; return 0; }
  flock -n "$LITE_LOCK" true 2>/dev/null || { echo "a LITE run holds $LITE_LOCK"; return 0; }
  [ "${HOST_CHECK:-1}" = 0 ] && return 1
  pgrep -f 'run-pilot|run-forced|pilot-wave[.]sh' >/dev/null && { echo "a pilot or forced-small script is running"; return 0; }
  pgrep -f 'bench/runner/bench[.]js run' >/dev/null && { echo "another bench.js run is running"; return 0; }
  awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN { exit !(l >= 4) }' && { echo "load $(cut -d' ' -f1 /proc/loadavg) is 4 or more"; return 0; }
  return 1
}
# wait_quiet: waits up to WAIT_MAX seconds; on time-out sets STOPPED and returns 1.
wait_quiet() {
  local waited=0 why=""
  while why=$(busy); do
    if [ "$waited" -ge "$WAIT_MAX" ]; then STOPPED="$why for ${waited}s; rerun this command later (it resumes)"; return 1; fi
    say "waiting: $why (waited ${waited}s)"; sleep "$WAIT_STEP"; waited=$((waited + WAIT_STEP))
  done
  return 0
}
base_args() { # base_args BATCH
  local b=$1
  printf '%s\n' run --suite pack --tasks "$(q "p.batches['$b'].tasks.join(',')")" --arms "$ARMS" --parallel 1 \
    --repo-root "$R" --hide "$R" --isolate unshare --seed "$SEED" \
    --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" --python "$PY312" --cache "$CACHE" "${CARGO[@]}"
}
# variant_arm SHA VERIFY FLAG VALUE: builds (or finds) one cap variant of konductor at SHA (FLAG VALUE: --preset noskills
# or --hook list); prints "<armSpec> <variantHash>".
variant_arm() {
  local sha=$1 verify=$2 flag=$3 value=$4 out rc=0
  local -a V=()
  [ "$verify" = 1 ] && V=(--verify)
  mkdir -p "$SCRATCH"
  out=$(nice -n 10 node "$R/bench/runner/bench.js" cap variant --scratch "$SCRATCH" --base "$sha" "$flag" "$value" \
    --agent-engine v3 --cache "$CACHE" --repo-root "$R" --json "${V[@]}" "${CARGO[@]}" 2> "$SCRATCH/variant-$value.log") || rc=$?
  # stderr: stdout is read as "<armSpec> <variantHash>"; the JSON's verify.problems has the reason.
  [ "$rc" = 0 ] || { say "cap variant $flag $value failed (exit $rc), see $SCRATCH/variant-$value.log" >&2; return 1; }
  printf '%s' "$out" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(j.armSpec, j.meta.variantHash)'
}
# check_arm NAME SPEC HASH: the variant must be a dir: arm of that name outside HOME.
check_arm() {
  local name=$1 spec=${2:-} vhash=${3:-}
  [ -n "$spec" ] && [ -n "$vhash" ] || stop "the $name arm did not build"
  case "$spec" in "$name=dir:/"*) ;; *) stop "$name arm $spec is not a dir: arm" ;; esac
  under_home "${spec#"$name"=dir:}" && stop "$name arm $spec is under HOME"
  say "$name arm: $spec (variantHash ${vhash:0:12})"
}
[ "${STANDARD_LIB:-0}" = 1 ] && return 0 2>/dev/null

main() {
  local mode="" prep=0 rep b spec vhash lspec lhash rc=0 po d a
  local -a dirs=()
  local usage="usage: S=DIR R=WORKTREE KBIN=FILE bash $0 [--foreground|--prepare-only] [--cargo-online]"
  for a in "$@"; do
    case "$a" in
      --foreground|--prepare-only) [ -z "$mode" ] || { echo "$usage"; exit 64; }; mode=$a ;;
      --cargo-online) CARGO=(--cargo-online) ;;
      *) echo "$usage"; exit 64 ;;
    esac
  done
  [ -n "$S" ] || stop "set S, the study dir (outside HOME, for example /var/tmp/konductor-standard-v1)"
  [ -n "$R" ] || stop "set R, a dedicated konductor worktree (the kit moves its pin)"
  for d in "$ROOT" "$CACHE" "$SCRATCH"; do under_home "$d" && stop "$d is under HOME ($HOME); work dirs go outside it, for example under /var/tmp"; done
  case "$KIT/" in "$(realpath -m -- "$R")"/*) stop "the kit runs from inside R ($R), whose pin it moves: run a copy outside R" ;; esac
  mkdir -p "$ROOT"
  if [ -z "$mode" ]; then
    setsid nohup bash "$KIT/run-standard.sh" --foreground "${CARGO[@]}" >> "$ROOT/run.log" 2>&1 < /dev/null &
    echo "STANDARD run started in the background (pid $!). Watch: tail -f $ROOT/run.log"
    exit 0
  fi
  [ "$mode" = --prepare-only ] && prep=1
  # A paid start freezes this kit in $S/kit and runs that copy, so a resumed run never mixes two kit versions.
  if [ "$prep" = 0 ] && [ "$KIT" != "$(realpath -m -- "$ROOT/kit")" ]; then
    if [ ! -e "$ROOT/kit" ]; then cp -a -- "$KIT" "$ROOT/kit" || stop "cannot freeze the kit in $ROOT/kit"
    elif ! diff -rq -- "$KIT" "$ROOT/kit" >/dev/null; then
      stop "$ROOT/kit is the frozen kit of this study and differs from $KIT: run $ROOT/kit/run-standard.sh, or move $ROOT/kit away to start over with this kit"
    fi
    exec bash "$ROOT/kit/run-standard.sh" "$mode" "${CARGO[@]}"
  fi
  export TMPDIR=/tmp
  say "run-standard.sh $mode (kit $KIT)"

  # ---------- tools
  [ -n "$PY312" ] || PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
  [ -x "$PY312" ] || stop "no Python 3.12: set PY312"
  [ -x "$KBIN" ] || stop "no kiro-cli at $KBIN"
  [ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "$KBIN_PIN" ] || stop "$KBIN is not the pinned kiro-cli 3.5.0"
  if "$KBIN" whoami >/dev/null 2>&1; then say "kiro login: ok"
  elif [ "$prep" = 1 ]; then say "kiro login: NOT signed in (a paid run would stop: $KBIN login)"
  else stop "Kiro login expired or missing: run '$KBIN login', then this script again"; fi

  # ---------- one STANDARD run at a time; never beside LITE, a pilot, forced-small or a heavy job
  exec 9> "$OWN_LOCK"
  flock -n 9 || stop "another STANDARD run or prepare holds $OWN_LOCK"
  wait_quiet || stop "$STOPPED"
  [ "$prep" = 1 ] || [ "${HOST_CHECK:-1}" = 0 ] || unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them)"

  # ---------- the bench worktree and the pins
  [ -e "$R/.git" ] || stop "no git worktree at $R: add one with git -C <your clone> worktree add --detach $R origin/feat/bench-pilot-nk"
  [ "$NO_FETCH" = 1 ] || git -C "$R" fetch -q origin feat/bench-pilot-nk main || stop "fetch failed"
  if [ -s "$PLAN" ] && [ "$prep" = 0 ]; then
    BENCH_SHA=$(q 'p.benchSha'); KONDUCTOR_SHA=$(q 'p.konductorSha')
    say "resuming the frozen plan: bench ${BENCH_SHA:0:8}, konductor ${KONDUCTOR_SHA:0:8}"
  else
    [ -s "$PLAN" ] && say "a frozen plan exists ($PLAN): a paid run resumes it; this preview does not change it"
    BENCH_SHA=$(git -C "$R" rev-parse "$BENCH_REF") || stop "no $BENCH_REF in $R"
    [ -n "$KONDUCTOR_SHA" ] || KONDUCTOR_SHA=$(git -C "$R" rev-parse origin/main) || stop "no origin/main in $R"
  fi
  git -C "$R" cat-file -e "$KONDUCTOR_SHA^{commit}" 2>/dev/null || stop "konductor commit $KONDUCTOR_SHA is not in $R"
  [ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes: use a clean worktree"
  if [ "$(git -C "$R" rev-parse HEAD)" != "$BENCH_SHA" ]; then
    git -C "$R" checkout -q --detach "$BENCH_SHA" || stop "checkout of $BENCH_SHA failed"
    say "pin moved to ${BENCH_SHA:0:8}"
  fi

  # ---------- the noskills and list-hook arms (F13 when --prepare-only: built and trial-installed)
  read -r spec vhash < <(variant_arm "$KONDUCTOR_SHA" "$prep" --preset noskills) || true
  check_arm konductor-noskills "${spec:-}" "${vhash:-}"
  read -r lspec lhash < <(variant_arm "$KONDUCTOR_SHA" "$prep" --hook list) || true
  check_arm konductor-list "${lspec:-}" "${lhash:-}"

  # ---------- the plan
  if [ "$prep" = 1 ]; then PLAN=$ROOT/prepare/plan-preview.json; mkdir -p "$ROOT/prepare"; fi
  if [ "$prep" = 1 ] || [ ! -s "$PLAN" ]; then
    node "$HELPER" plan "$R" "$COST" > "$PLAN.gate" || stop "task gate failed"
    node -e '
      const [g, b, k, s, h, ls, lh, out] = process.argv.slice(1);
      const gate = JSON.parse(require("fs").readFileSync(g, "utf8"));
      const plan = { created: new Date().toISOString(), benchSha: b, konductorSha: k, noskillsArm: s, noskillsHash: h, listArm: ls, listArmHash: lh, ...gate };
      require("fs").writeFileSync(out, JSON.stringify(plan, null, 2) + "\n");
    ' "$PLAN.gate" "$BENCH_SHA" "$KONDUCTOR_SHA" "$spec" "$vhash" "$lspec" "$lhash" "$PLAN" && rm -f -- "$PLAN.gate"
    say "plan written: $PLAN"
  fi
  [ "$(q 'p.noskillsHash')" = "$vhash" ] || stop "the noskills arm hash $vhash differs from the frozen plan's $(q 'p.noskillsHash')"
  [ "$(q 'p.listArmHash')" = "$lhash" ] || stop "the list arm hash $lhash differs from the frozen plan's $(q 'p.listArmHash')"
  NOSKILLS=$(q 'p.noskillsArm'); LIST=$(q 'p.listArm')
  ARMS="vanilla,konductor=$KONDUCTOR_SHA,$NOSKILLS,$LIST"
  BATCHES=$(q 'Object.keys(p.batches).join(" ")')
  say "bench ${BENCH_SHA:0:8}; arms $ARMS; model claude-sonnet-5.5, effort high, engine v3"
  say "STANDARD level: $(q 'p.levelIds.length') DEV tasks (list hash $(q 'p.listHash')); $(q 'p.run.length') run, $(q 'p.skipped.length') skipped:"
  q 'p.skipped.map(s=>"  "+s.id+": "+s.why+"; needs "+s.needs).join("\n")||"  none"'
  say "expected real credits per stage: $(q 'p.expectedPerStage'); cap $STAGE_CAP per stage, $STAGES stages, margin $MARGIN"

  if [ "$prep" = 1 ]; then
    po=$(mktemp -d "$ROOT/prepare/out.XXXXXX")
    say "prepare-only (no agent started):"
    nice -n 10 node "$R/bench/runner/bench.js" run --suite pack --tasks "$(q 'p.run.map(t=>t.id).join(",")')" --arms "$ARMS" \
      --replicates 1 --parallel 1 --repo-root "$R" --hide "$R" --isolate unshare --seed "$SEED" \
      --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" --python "$PY312" --cache "$CACHE" \
      --budget-credits "$STAGE_CAP" --run-credit-limit 68 --out "$po" --prepare-only "${CARGO[@]}" || rc=$?
    rmdir -- "$po" 2>/dev/null
    if [ "$rc" = 0 ]; then say "prepare-only passed. Paid run: the same command without --prepare-only"; else say "prepare-only FAILED (exit $rc)"; fi
    exit "$rc"
  fi

  # ---------- paid stages
  mkdir -p "$ROOT/runs" "$ROOT/tables" "$ROOT/incomplete"
  for rep in $(seq 1 "$STAGES"); do
    [ -z "$STOPPED" ] || break
    if [ "$rep" -gt 1 ]; then
      mapfile -t dirs < <(find "$ROOT/runs/r$((rep - 1))" -mindepth 1 -maxdepth 1 -type d | sort)
      node "$HELPER" stage "$R" "${dirs[@]}" | tee "$ROOT/tables/stage-$((rep - 1))-check.txt"
      [ "${PIPESTATUS[0]}" = 0 ] || { STOPPED="stage $((rep - 1)) is not clean (see tables/stage-$((rep - 1))-check.txt); stage $rep not started"; break; }
    fi
    for b in $BATCHES; do
      [ -e "$ROOT/runs/r$rep/$b.done" ] && { say "r$rep $b: done, skipped"; continue; }
      run_batch "$rep" "$b"
      [ -z "$STOPPED" ] || break
    done
  done

  # ---------- tables
  mapfile -t dirs < <(find "$ROOT"/runs/r* -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
  if [ "${#dirs[@]}" -gt 0 ]; then
    node "$HELPER" summary "$R" "$ROOT/tables/code-gap.md" "${dirs[@]}"
    node "$R/bench/runner/bench.js" scenarios pilot-table "${dirs[@]}" > "$ROOT/tables/all-runs.md" 2>/dev/null
  fi
  if [ -n "$REPORTS" ]; then mkdir -p "$REPORTS" && cp -a -- "$ROOT/tables/." "$REPORTS/" && cp -- "$PLAN" "$REPORTS/plan.json"; fi
  say "${STOPPED:-all units finished}"
  for rep in $(seq 1 "$STAGES"); do say "stage $rep: $(ledger "$ROOT/runs/r$rep" | cut -d' ' -f1) real credits of $STAGE_CAP"; done
  say "tables: $ROOT/tables${REPORTS:+, copied to $REPORTS} (code-gap.md: four arms per task; all-runs.md; r<rep>-<batch>.md)"
  say "next (Claude Code arms, same tasks): S=$ROOT R=$R bash $KIT/claude-standard.sh --plan, then --prepare-only, then paid; judges after both: bash $KIT/judge-standard.sh --plan"
  [ -z "$STOPPED" ]
}
main "$@"
