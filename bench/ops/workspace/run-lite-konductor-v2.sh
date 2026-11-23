#!/usr/bin/env bash
# LITE konductor-vs-plain run, v2: no per-batch budget skips. Owner terminal only: paid.
# Same run folder, plan, pin, arms and resume rules as run-lite-konductor.sh; only the budget and fill rules differ.
#
#   bash run-lite-konductor-v2.sh                  start the paid run in the background; log reports/lite-run-2026-11-21/run.log
#   bash run-lite-konductor-v2.sh --foreground     the same, in this terminal
#   bash run-lite-konductor-v2.sh --prepare-only   free: gate, task list, both arms built and trial-installed, and the
#                                                  batches the fill step would reopen; no agent runs, nothing moved
#
# What changed from v1:
#   1. no per-batch ceiling (v1 used 1.5x expected from lite-helper.js). A batch's budget (new spend of that one
#      bench command) is what is left under the caps minus the 25 margin: replicate 1 under stage A (450, counted on r1 spend) and the total (1,300); later
#      replicates under the total only. The total cap and the stage A / clean checks are the only stops.
#   2. a batch is marked done only when none of its runs is budget_skipped. If one is and the caps still leave room,
#      the same batch is resumed once more with the new budget. If it still has one, the run stops cleanly; rerun to resume.
#   3. at start, a fill step reopens finished batches that hold budget_skipped runs: it moves their .done marker to
#      incomplete/ (a rename; nothing is deleted), so --resume runs only the missing cells (bench orchestrate.js resumePlan).
#   4. every batch table gets a visible "budget_skipped" row per skipped run (bench pilot-table.js drops them).
# Run order inside a batch is bench's seeded shuffle (orchestrate.js planRuns); with no per-batch ceiling a skip can
# only happen at the stage A or total cap.
# Rerun the same command to resume. Nothing is deleted.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

WS=$KONDUCTOR_WS
PILOT=$WS/worktrees/pilot
R=${R:-$PILOT}
ROOT=${ROOT:-$WS/reports/lite-run-2026-11-21}
H=${H:-$WS/scripts/lite-helper.js}
F=${F:-$WS/scripts/lite-fill.js}
COST=$WS/reports/lock-table-and-lite-proposal-2026-11-21-data/lite.json
KONDUCTOR_SHA=${KONDUCTOR_SHA:-f5d184596378ae72ae531d80647548512c14cacf}   # origin/main on 2026-11-21 (#239)
KBIN=${KBIN:-/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli}
KBIN_PIN=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
CACHE=${CACHE:-/var/tmp/lite-konductor-cache}
TOTAL=1300; STAGE_A=450; MARGIN=25
TASKS=t1-bug-event-listeners,t1-impl-job-retry,t1-nfr-report-queries,t1-ref-esm-migrate,t2-arch-dr-split-checkout,\
t2-dr-data-erasure,t2-dr-notify-fanout,t2-sec-dr-sso-login,t3-dev-module-boundary,t3-tpm-migration-cutover,\
t3-db-tenant-isolation,t4-arch-tenant-abac,t4-iam-privesc-groups,t5-qa-checkout-strategy,t5-qa-suite-audit,\
t5-qa-sync-strategy,t6-req-clinic-reminders,t6-req-field-inspections,t6-idea-churn-signal,t7-program-brief,\
t7-risk-owners,t7-pm-launch-cut,t8-tpm-rollout-regions,t8-dec-deploy-strategy,t8-nfr-slo-burn,\
t9-review-checkout-ui,t10-tpm-ring-rollout,t11-wide-settings-refactor,\
t12-handoff-export-dates,t12-sdlc-contact-import,t12-parallel-backlog,t12-delegated-worker-fix,\
t1-neg-config-alias,t8-neg-alert-threshold
PLAN=$ROOT/plan.json
STOPPED=""
PY312=${PY312:-}
ARMS="vanilla,konductor=$KONDUCTOR_SHA"

say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }
q() { node -p "const p=require('$PLAN'); $1"; }

# ---------- money and fill (the v2 parts; the test sources these with LITE_LIB=1)
spent() { node "$H" spent "$R" "$1" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).credits'; }
skipped_in() { node "$F" skipped "$1"; }
bench() { "${LOCK[@]}" nice -n 10 node "$R/bench/runner/bench.js" "$@"; }
table_of() { # table_of U OUT
  node "$R/bench/runner/bench.js" scenarios pilot-table "$1" > "$2" 2>> "$1.log"
  node "$F" table "$2" "$1" >> "$1.log" 2>&1
}
# budget_for REP U: the batch's --budget-credits, what the caps still leave minus the margin. bench counts
# --budget-credits over this command's own spend only (credit-ledger.js openLedger: session), so spend already in U
# is not added back: a resumed batch could otherwise pass the cap by what it spent before.
budget_for() {
  local rep=$1 U=$2 here all r1=0 capa=999999
  here=$(spent "$U"); all=$(spent "$ROOT/runs")
  [ "$rep" = 1 ] && { r1=$(spent "$ROOT/runs/r1"); capa=$STAGE_A; }
  awk -v h="$here" -v a="$all" -v r="$r1" -v t="$TOTAL" -v s="$capa" -v m="$MARGIN" \
    'BEGIN { x = t - a - m; y = s - r - m; if (y < x) x = y; printf "%d %s %s %s", x, h, a, r }'
}
# run_batch REP B: one batch, plus one fill pass when it left budget_skipped runs. Sets STOPPED to stop the run.
run_batch() {
  local rep=$1 b=$2 U=$ROOT/runs/r$1/$2 pass budget here all r1 rc=0 n
  for pass in 1 2; do
    read -r budget here all r1 < <(budget_for "$rep" "$U")
    if awk -v x="$budget" 'BEGIN { exit !(x <= 1) }'; then
      STOPPED="ceiling reached before r$rep $b: $all real credits spent (r1 $r1), caps stage A $STAGE_A, total $TOTAL, margin $MARGIN"
      return
    fi
    wait_quiet
    "$KBIN" whoami >/dev/null 2>&1 || { STOPPED="Kiro login expired before r$rep $b: run '$KBIN login', then this script again"; return; }
    mapfile -t A < <(base_args "$b")
    A+=(--replicates 1 --replicate-offset $((rep - 1)) --budget-credits "$budget" --run-credit-limit "$(q "p.batches['$b'].runLimit")" --out "$U")
    if [ -f "$U/run-config.json" ]; then A+=(--resume)
    elif [ -e "$U" ]; then mv -- "$U" "$ROOT/incomplete/r$rep-$b.$(date +%s)"; fi
    LOCK=(); [ "$b" = t9 ] && LOCK=(flock -x /var/tmp/konductor-heavy.lock)
    say "r$rep $b: start (pass $pass), batch budget $budget (spent here $here, all $all, r1 $r1)"
    mkdir -p "$ROOT/runs/r$rep"
    bench "${A[@]}" >> "$U.log" 2>&1; rc=$?
    table_of "$U" "$ROOT/tables/r$rep-$b.md"
    n=$(skipped_in "$U")
    say "r$rep $b: exit $rc, spent here $(spent "$U"), all $(spent "$ROOT/runs"), budget_skipped $n; table tables/r$rep-$b.md"
    [ "$rc" = 6 ] && { STOPPED="r$rep $b stopped on login failures (exit 6): run '$KBIN login', then this script again"; return; }
    [ "$n" = 0 ] && break
  done
  if [ "$n" != 0 ]; then
    STOPPED="r$rep $b still has $n budget_skipped run(s) after a fill pass: caps reached; rerun to resume"; return
  fi
  [ "$rc" = 0 ] && touch "$U.done"
  return 0
}
[ "${LITE_LIB:-0}" = 1 ] && return 0 2>/dev/null

MODE=${1:-}
case "$MODE" in ''|--foreground|--prepare-only) ;; *) echo "usage: bash $0 [--foreground|--prepare-only]"; exit 64 ;; esac
mkdir -p "$ROOT"

if [ -z "$MODE" ]; then
  setsid nohup bash "$0" --foreground >> "$ROOT/run.log" 2>&1 < /dev/null &
  echo "LITE run v2 started in the background (pid $!). Watch: tail -f $ROOT/run.log"
  exit 0
fi
PREP=0; [ "$MODE" = --prepare-only ] && PREP=1
export TMPDIR=/tmp
say "run-lite-konductor-v2.sh $MODE"

# ---------- tools
[ -n "$PY312" ] || PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
[ -x "$PY312" ] || stop "no Python 3.12: set PY312"
[ -x "$KBIN" ] || stop "no kiro-cli at $KBIN"
[ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "$KBIN_PIN" ] || stop "$KBIN is not the pinned kiro-cli 3.5.0"
if "$KBIN" whoami >/dev/null 2>&1; then say "kiro login: ok"
elif [ "$PREP" = 1 ]; then say "kiro login: NOT signed in (a paid run would stop: $KBIN login)"
else stop "Kiro login expired or missing: run '$KBIN login', then this script again"; fi

# ---------- wait for a quiet host (paid only)
busy() {
  pgrep -f 'pilot-wave[.]sh' >/dev/null && { echo "a pilot-wave.sh is running"; return 0; }
  pgrep -f 'bench/runner/bench[.]js run' >/dev/null && { echo "another bench.js run is running"; return 0; }
  awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN { exit !(l >= 4) }' && { echo "load $(cut -d' ' -f1 /proc/loadavg) is 4 or more"; return 0; }
  return 1
}
wait_quiet() {
  local waited=0 why
  while why=$(busy); do
    [ "$waited" -lt 3600 ] || stop "$why for 60 minutes; rerun this command later (it resumes)"
    say "waiting: $why (waited ${waited}s)"; sleep 60; waited=$((waited + 60))
  done
}
if [ "$PREP" = 0 ]; then
  exec 9> /var/tmp/konductor-lite.lock
  flock -n 9 || stop "another LITE run holds /var/tmp/konductor-lite.lock (v1 still running? stop it first)"
  unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them)"
  wait_quiet
fi

# ---------- pin and plan
git -C "$R" fetch -q origin feat/bench-pilot-nk main || stop "fetch failed"
git -C "$R" cat-file -e "$KONDUCTOR_SHA^{commit}" 2>/dev/null || stop "konductor commit $KONDUCTOR_SHA is not in $R"
if [ "$PREP" = 1 ]; then
  say "prepare-only: the pin is not moved. $R is at $(git -C "$R" rev-parse --short HEAD); newest head $(git -C "$R" rev-parse --short origin/feat/bench-pilot-nk)"
  [ -s "$PLAN" ] && say "a frozen plan exists ($PLAN): a paid run resumes it"
  PLAN=$ROOT/prepare/plan-preview.json
  mkdir -p "$ROOT/prepare"
  BENCH_SHA=$(git -C "$R" rev-parse HEAD)
elif [ -s "$PLAN" ]; then
  BENCH_SHA=$(node -p 'require(process.argv[1]).benchSha' "$PLAN")
  KONDUCTOR_SHA=$(node -p 'require(process.argv[1]).konductorSha' "$PLAN")
  ARMS="vanilla,konductor=$KONDUCTOR_SHA"
  say "resuming the frozen plan: bench ${BENCH_SHA:0:8}, konductor ${KONDUCTOR_SHA:0:8}"
else
  BENCH_SHA=$(git -C "$R" rev-parse origin/feat/bench-pilot-nk)
fi
if [ "$PREP" = 0 ] && [ "$(git -C "$R" rev-parse HEAD)" != "$BENCH_SHA" ]; then
  [ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes; it must be clean to move the pin"
  git -C "$R" checkout -q --detach "$BENCH_SHA" || stop "checkout of $BENCH_SHA failed"
  say "pin moved to ${BENCH_SHA:0:8}"
fi
[ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes: use a clean worktree"
if [ "$PREP" = 1 ] || [ ! -s "$ROOT/plan.json" ]; then
  node "$H" gate "$R" "$COST" "$TASKS" > "$PLAN.gate" || stop "gate failed"
  node -e '
    const [g, b, k, out] = process.argv.slice(1);
    const gate = JSON.parse(require("fs").readFileSync(g, "utf8"));
    require("fs").writeFileSync(out, JSON.stringify({ created: new Date().toISOString(), benchSha: b, konductorSha: k, ...gate }, null, 2) + "\n");
  ' "$PLAN.gate" "$BENCH_SHA" "$KONDUCTOR_SHA" "$PLAN" && rm -f -- "$PLAN.gate"
  say "plan written: $PLAN"
fi
BATCHES=$(q 'Object.keys(p.batches).join(" ")')
say "bench ${BENCH_SHA:0:8}, konductor arm konductor=${KONDUCTOR_SHA:0:8}, model claude-sonnet-5.5, effort high, engine v3"
say "tasks that run ($(q 'p.run.length')): $(q 'p.run.map(t=>t.id).join(",")')"
say "skipped ($(q 'p.skipped.length')):"; q 'p.skipped.map(s=>"  "+s.id+": "+s.why+"; needs "+s.needs).join("\n")||"  none"'
say "expected real credits: $(q 'p.expectedPerReplicate') per replicate, $(q 'p.expectedThreeReplicates') for 3; caps: stage A $STAGE_A (r1 spend), total $TOTAL; no per-batch ceiling"
base_args() { # base_args BATCH
  printf '%s\n' run --suite pilot --tasks "$(q "p.batches['$1'].tasks.join(',')")" --arms "$ARMS" --parallel 1 \
    --extra-tasks "$R/bench/scenarios/$1" --repo-root "$R" --hide "$R" --isolate unshare --seed 20261121 \
    --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" --python "$PY312" --cache "$CACHE"
}

if [ "$PREP" = 1 ]; then
  say "fill step (dry, nothing moved):"; node "$F" reopen "$ROOT" --dry
  ALL_DIRS=$(for b in $BATCHES; do printf '%s,' "$R/bench/scenarios/$b"; done)
  PO=$(mktemp -d "$ROOT/prepare/out.XXXXXX")
  say "prepare-only (no agent started):"
  nice -n 10 node "$R/bench/runner/bench.js" run --suite pilot --tasks "$(q 'p.run.map(t=>t.id).join(",")')" --arms "$ARMS" \
    --replicates 1 --parallel 1 --extra-tasks "${ALL_DIRS%,}" --repo-root "$R" --hide "$R" --isolate unshare --seed 20261121 \
    --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" --python "$PY312" --cache "$CACHE" \
    --budget-credits "$TOTAL" --run-credit-limit 38 --out "$PO" --prepare-only; rc=$?
  rmdir -- "$PO" 2>/dev/null
  [ "$rc" = 0 ] && say "prepare-only passed. Paid run: bash $0" || say "prepare-only FAILED (exit $rc)"
  exit "$rc"
fi

# ---------- fill: reopen finished batches that left budget_skipped runs
mkdir -p "$ROOT/runs" "$ROOT/tables" "$ROOT/incomplete"
say "fill step:"; node "$F" reopen "$ROOT" || stop "fill step failed"

# ---------- paid units
dirs_of() { ls -d "$ROOT"/runs/r"$1"/t* 2>/dev/null | grep -v '[.]\(done\|log\)$'; }
for rep in 1 2 3; do
  [ -z "$STOPPED" ] || break
  if [ "$rep" = 2 ]; then
    # shellcheck disable=SC2046
    node "$H" stage "$R" $(dirs_of 1) | tee "$ROOT/tables/stage-a-check.txt"
    [ "${PIPESTATUS[0]}" = 0 ] || { STOPPED="stage A is not clean (see tables/stage-a-check.txt); stage B not started"; break; }
  fi
  for b in $BATCHES; do
    [ -e "$ROOT/runs/r$rep/$b.done" ] && { say "r$rep $b: done, skipped"; continue; }
    run_batch "$rep" "$b"
    [ -z "$STOPPED" ] || break
  done
done

# ---------- tables
# shellcheck disable=SC2046
ALL=$(ls -d "$ROOT"/runs/r*/t* 2>/dev/null | grep -v '[.]\(done\|log\)$')
# shellcheck disable=SC2086
node "$H" summary "$R" "$ROOT/tables/code-gap.md" $ALL
# shellcheck disable=SC2086
node "$R/bench/runner/bench.js" scenarios pilot-table $ALL > "$ROOT/tables/all-runs.md" 2>/dev/null
# shellcheck disable=SC2086
node "$F" table "$ROOT/tables/all-runs.md" $ALL
say "${STOPPED:-all units finished}"
say "real credits spent: $(spent "$ROOT/runs") of $TOTAL (r1 $(spent "$ROOT/runs/r1") of stage A $STAGE_A)"
say "tables:"
say "  $ROOT/tables/code-gap.md   (code part, konductor minus vanilla per task)"
say "  $ROOT/tables/all-runs.md   (every run, pilot-table view, budget_skipped rows shown)"
say "  $ROOT/tables/r<rep>-<batch>.md (one per batch and replicate)"
say "next (judges, USD 3 cap): bash $WS/scripts/run-lite-judge.sh --plan"
