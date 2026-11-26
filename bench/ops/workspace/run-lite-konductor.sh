#!/usr/bin/env bash
# LITE konductor-vs-plain run (reports/lock-table-and-lite-proposal-2026-11-21.md, Part 2). Owner terminal only: paid.
#
#   bash run-lite-konductor.sh                  start the paid run in the background; log reports/lite-run-2026-11-21/run.log
#   bash run-lite-konductor.sh --foreground     the same, in this terminal
#   bash run-lite-konductor.sh --prepare-only   free: gate, task list, both arms built and trial-installed; no agent runs
#
# What a paid run does:
#   1. waits up to 60 min for no pilot-wave.sh, no other bench.js run and load under 4 (one LITE run at a time: flock)
#   2. first start: moves the pilot pin to the newest feat/bench-pilot-nk head, keeps only tasks whose current version
#      has a non-Claude recheck (lite-helper.js gate) and freezes bench commit, konductor commit and task list in
#      plan.json. A later start resumes on the frozen plan and the same bench commit.
#   3. runs every batch x 2 arms (vanilla, konductor=KONDUCTOR_SHA), replicate 1 (stage A), then replicates 2 and 3
#      (stage B, only when stage A has 10% or less broken per arm). One bench.js run per batch and replicate, into
#      runs/r<rep>/<batch>; an unfinished one is resumed (--resume), a finished one is skipped.
#   4. ceilings in REAL credits: per batch (lite-helper.js, 1.5x its expected spend), stage A 450, total 1,300. A run
#      never starts unless the batch's budget leaves 25 credits under the stage or total ceiling (the largest run expected
#      is about 22, and --run-credit-limit cannot stop a one-shot run: D-67). At a ceiling it stops cleanly.
#   5. a run the service throttled is rerun once, after a minute, by the runner itself (D-138).
#   6. writes tables/ and prints their paths.
# Rerun the same command to resume. Nothing is deleted.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

WS=$KONDUCTOR_WS
PILOT=$WS/worktrees/pilot
R=${R:-$PILOT}
ROOT=$WS/reports/lite-run-2026-11-21
H=$WS/scripts/lite-helper.js
COST=$WS/reports/lock-table-and-lite-proposal-2026-11-21-data/lite.json
KONDUCTOR_SHA=${KONDUCTOR_SHA:-f5d184596378ae72ae531d80647548512c14cacf}   # origin/main on 2026-11-21 (#239)
KBIN=${KBIN:-/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli}
KBIN_PIN=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
CACHE=/var/tmp/lite-konductor-cache
TOTAL=1300; STAGE_A=450; MARGIN=25
TASKS=t1-bug-event-listeners,t1-impl-job-retry,t1-nfr-report-queries,t1-ref-esm-migrate,t2-arch-dr-split-checkout,\
t2-dr-data-erasure,t2-dr-notify-fanout,t2-sec-dr-sso-login,t3-dev-module-boundary,t3-tpm-migration-cutover,\
t3-db-tenant-isolation,t4-arch-tenant-abac,t4-iam-privesc-groups,t5-qa-checkout-strategy,t5-qa-suite-audit,\
t5-qa-sync-strategy,t6-req-clinic-reminders,t6-req-field-inspections,t6-idea-churn-signal,t7-program-brief,\
t7-risk-owners,t7-pm-launch-cut,t8-tpm-rollout-regions,t8-dec-deploy-strategy,t8-nfr-slo-burn,\
t9-review-checkout-ui,t10-tpm-ring-rollout,t11-wide-settings-refactor,\
t12-handoff-export-dates,t12-sdlc-contact-import,t12-parallel-backlog,t12-delegated-worker-fix,\
t1-neg-config-alias,t8-neg-alert-threshold

. "$(dirname "$0")/../lib.sh"   # say, stop and fail (B-005)
MODE=${1:-}
case "$MODE" in ''|--foreground|--prepare-only) ;; *) echo "usage: bash $0 [--foreground|--prepare-only]"; exit 64 ;; esac
mkdir -p "$ROOT"

if [ -z "$MODE" ]; then
  setsid nohup bash "$0" --foreground >> "$ROOT/run.log" 2>&1 < /dev/null &
  echo "LITE run started in the background (pid $!). Watch: tail -f $ROOT/run.log"
  exit 0
fi
PREP=0; [ "$MODE" = --prepare-only ] && PREP=1
export TMPDIR=/tmp

# ---------- tools
PY312=${PY312:-$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)}
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
  flock -n 9 || stop "another LITE run holds /var/tmp/konductor-lite.lock"
  unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them)"
  wait_quiet
fi

# ---------- pin and plan
git -C "$R" fetch -q origin feat/bench-pilot-nk main || stop "fetch failed"
git -C "$R" cat-file -e "$KONDUCTOR_SHA^{commit}" 2>/dev/null || stop "konductor commit $KONDUCTOR_SHA is not in $R"
PLAN=$ROOT/plan.json
if [ "$PREP" = 1 ]; then
  say "prepare-only: the pin is not moved. $R is at $(git -C "$R" rev-parse --short HEAD); newest head $(git -C "$R" rev-parse --short origin/feat/bench-pilot-nk)"
  [ -s "$PLAN" ] && say "a frozen plan exists ($PLAN): a paid run resumes it"
  PLAN=$ROOT/prepare/plan-preview.json
  mkdir -p "$ROOT/prepare"
  BENCH_SHA=$(git -C "$R" rev-parse HEAD)
elif [ -s "$PLAN" ]; then
  BENCH_SHA=$(node -p 'require(process.argv[1]).benchSha' "$PLAN")
  KONDUCTOR_SHA=$(node -p 'require(process.argv[1]).konductorSha' "$PLAN")
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
q() { node -p "const p=require('$PLAN'); $1"; }
BATCHES=$(q 'Object.keys(p.batches).join(" ")')
say "bench ${BENCH_SHA:0:8}, konductor arm konductor=${KONDUCTOR_SHA:0:8}, model claude-sonnet-5.5, effort high, engine v3"
say "tasks that run ($(q 'p.run.length')): $(q 'p.run.map(t=>t.id).join(",")')"
say "skipped ($(q 'p.skipped.length')):"; q 'p.skipped.map(s=>"  "+s.id+": "+s.why+"; needs "+s.needs).join("\n")||"  none"'
say "expected real credits: $(q 'p.expectedPerReplicate') per replicate, $(q 'p.expectedThreeReplicates') for 3; caps: stage A $STAGE_A, total $TOTAL"
ARMS="vanilla,konductor=$KONDUCTOR_SHA"
base_args() { # base_args BATCH
  printf '%s\n' run --suite pilot --tasks "$(q "p.batches['$1'].tasks.join(',')")" --arms "$ARMS" --parallel 1 \
    --extra-tasks "$R/bench/scenarios/$1" --repo-root "$R" --hide "$R" --isolate unshare --seed 20261121 \
    --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" --python "$PY312" --cache "$CACHE"
}

if [ "$PREP" = 1 ]; then
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

# ---------- paid units
mkdir -p "$ROOT/runs" "$ROOT/tables" "$ROOT/incomplete"
spent() { node "$H" spent "$R" "$1" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).credits'; }
dirs_of() { ls -d "$ROOT"/runs/r"$1"/t* 2>/dev/null | grep -v '[.]\(done\|log\)$'; }
STOPPED=""
for rep in 1 2 3; do
  [ -z "$STOPPED" ] || break
  if [ "$rep" = 2 ]; then
    # shellcheck disable=SC2046
    node "$H" stage "$R" $(dirs_of 1) | tee "$ROOT/tables/stage-a-check.txt"
    [ "${PIPESTATUS[0]}" = 0 ] || { STOPPED="stage A is not clean (see tables/stage-a-check.txt); stage B not started"; break; }
  fi
  CAP=$([ "$rep" = 1 ] && echo "$STAGE_A" || echo "$TOTAL")
  for b in $BATCHES; do
    U=$ROOT/runs/r$rep/$b
    [ -e "$U.done" ] && { say "r$rep $b: done, skipped"; continue; }
    all=$(spent "$ROOT/runs"); here=$(spent "$U")
    budget=$(awk -v c="$(q "p.batches['$b'].ceiling")" -v h="$here" -v a="$all" -v cap="$CAP" -v m="$MARGIN" \
      'BEGIN { x = h + cap - a - m; if (x > c) x = c; printf "%d", x }')
    if awk -v x="$budget" -v h="$here" 'BEGIN { exit !(x <= h + 1) }'; then
      STOPPED="ceiling reached before r$rep $b: $all real credits spent, cap $CAP (margin $MARGIN)"; break
    fi
    wait_quiet
    "$KBIN" whoami >/dev/null 2>&1 || { STOPPED="Kiro login expired before r$rep $b: run '$KBIN login', then this script again"; break; }
    mapfile -t A < <(base_args "$b")
    A+=(--replicates 1 --replicate-offset $((rep - 1)) --budget-credits "$budget" --run-credit-limit "$(q "p.batches['$b'].runLimit")" --out "$U")
    if [ -f "$U/run-config.json" ]; then A+=(--resume)
    elif [ -e "$U" ]; then mv -- "$U" "$ROOT/incomplete/r$rep-$b.$(date +%s)"; fi
    LOCK=(); [ "$b" = t9 ] && LOCK=(flock -x /var/tmp/konductor-heavy.lock)
    say "r$rep $b: start, batch budget $budget (spent here $here, all $all of cap $CAP)"
    mkdir -p "$ROOT/runs/r$rep"
    "${LOCK[@]}" nice -n 10 node "$R/bench/runner/bench.js" "${A[@]}" >> "$U.log" 2>&1; rc=$?
    node "$R/bench/runner/bench.js" scenarios pilot-table "$U" > "$ROOT/tables/r$rep-$b.md" 2>> "$U.log"
    say "r$rep $b: exit $rc, spent here $(spent "$U"), all $(spent "$ROOT/runs"); table tables/r$rep-$b.md"
    [ "$rc" = 0 ] && touch "$U.done"
    [ "$rc" = 6 ] && { STOPPED="r$rep $b stopped on login failures (exit 6): run '$KBIN login', then this script again"; break; }
  done
done

# ---------- tables
# shellcheck disable=SC2046
ALL=$(ls -d "$ROOT"/runs/r*/t* 2>/dev/null | grep -v '[.]\(done\|log\)$')
# shellcheck disable=SC2086
node "$H" summary "$R" "$ROOT/tables/code-gap.md" $ALL
# shellcheck disable=SC2086
node "$R/bench/runner/bench.js" scenarios pilot-table $ALL > "$ROOT/tables/all-runs.md" 2>/dev/null
say "${STOPPED:-all units finished}"
say "real credits spent: $(spent "$ROOT/runs") of $TOTAL"
say "tables:"
say "  $ROOT/tables/code-gap.md   (code part, konductor minus vanilla per task)"
say "  $ROOT/tables/all-runs.md   (every run, pilot-table view)"
say "  $ROOT/tables/r<rep>-<batch>.md (one per batch and replicate)"
say "next (judges, USD 3 cap): bash $WS/scripts/run-lite-judge.sh --plan"
