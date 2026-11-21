#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# run-2x2-kiro.sh: the run kit for the Kiro-only rerun of the konductor 2x2, on a NEW frozen build (see bench/docs/repeat.md,
# 2026-11-19). A variant of run-2x2.sh (same helpers, same safety refusals) with these differences: one set "rerun"
# with 17 HELD-OUT tasks x 3 replicates, Kiro vanilla against konductor only; one uniform soft time limit (TIMEOUT_SEC, 1800
# s); soft caps; PY312_BIN first on PATH; no Claude Code step. Two faults of run-2x2.sh are fixed here:
# (1) `spent` read no stdin in judge mode, so `find | node` could die of SIGPIPE under pipefail and trip the ERR trap;
# (2) `report` stopped at `calibrate export`, which ignores --extra-tasks and cannot find sdlc tasks: it now only warns,
#     and the build label is written before it.
# Run it from your own terminal, never from an agent shell, and from a copy outside R.
#   free:  split-check | missing | check | freeze | prepare | judge-plan | gate | report
#   paid:  stage3 kiro | judge
# Needs: S (the study directory) or KIT_DIR; R (a dedicated konductor worktree); AWSP (the NAME of your least-privilege
# Bedrock profile, never a key). Optional: SHARED (a dir that holds bin/ and cache/ of an earlier study), KBIN, CBIN,
# LISTING_JS, LOCK, PY312_BIN, KONDUCTOR_REF, BUILD_LABEL, REFRESH_CMD, ALLOW_MAIN_MOVED=1, RESUME_ERRORS=1.
# Effort is --effort high; scores are the median of three judges.
# SPEND APPROVED by the owner on 2026-11-19, as soft caps: 390 credits and $20 of judging (ceiling 396 credits and $129).
# Startup rule (owner, 2026-11-18): each arm starts the default agent of its tool (Kiro kiro_default) or konductor, with no
# MCP server (konductor's own only), nothing from the real ~/.kiro, and no steering, rules or skills in a vanilla HOME.
# bench writes startup.json per run; `gate` checks it.
set -euo pipefail
KIT_SRC=${KIT_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)}   # the dir of this script; a caller that sources the helpers sets it first
R=${R:-}                                    # a dedicated konductor worktree; `freeze` checks out the frozen bench commit in it
S=${S:-${KIT_DIR:?set S (the study directory) or KIT_DIR}}
SHARED=${SHARED:-$S}   # where the pinned binaries (bin/) and the build cache live; set it to the first study's dir to reuse them
AWSP=${AWSP:-}
REGION=us-east-1
KBIN=${KBIN:-$SHARED/bin/kiro-cli-3.5.0/kiro-cli}
KBIN_SHA=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
CBIN=${CBIN:-$SHARED/bin/claude-code/2.1.327.1766/claude}
CBIN_SHA=343c744baa14bfd38286a7cb90871051f04379956da6c5b803a9e66019a76ac9
CC_VERSION=2.1.327.1766
EFFORT=high
SEED=20261118
PANEL=gpt-5.6-luna,deepseek-3.2,glm-5
LOCK=${LOCK:-/var/tmp/konductor-heavy.lock}
BJ=$R/bench/runner/bench.js
X=$R/bench/rootcause,$R/bench/sdlc   # extra task dirs: rootcause tasks and the sdlc suite
# SR-32 split, recorded before any run: a task is DEV when sha256("konductor-2x2 SR-32 split v1:" + id), first 8 hex
# digits as a number, is divisible by 3; otherwise HELD-OUT. `check` recomputes it and refuses any edit of these lists.
SPLIT_SALT="konductor-2x2 SR-32 split v1:"
DEV=("sdlc-prod-readiness,sdlc-problem-framing" "rc-dynamodb-design,rc-req-to-design")
HELD=("hard-seat-holds,rc-agents-md,req-vague-request" "hard-export-formats,rc-threat-model"
  "hard-batch-flaky,design-hold-service" "hard-catalog-limits,orch-input-validation" "orch-search-hardening,review-inventory-security"
  "sdlc-spike-dedupe,sdlc-arch-decision")
# HELD-OUT tasks of class sop: Kiro loads SOPs for them, Claude Code cannot while SOPs are user-only. They stay HELD-OUT
# (the hash split is unchanged) but run into their own dirs and join the verdict only when freeze found SOP parity.
HELD_SOP=("plan-multipart-feature,sop-test-coverage-review")
# Added 2026-11-18 (a4d4df02), split by the same rule; existing assignments unchanged. Fewer replicates keep the
# approved caps: the DEV one runs once, last in stage 1; the two HELD-OUT ones run twice, in the HELD-OUT dirs.
DEV_NEW=("sdlc-design-review-gaps") DEV_NEW_REPS=1
HELD_NEW=("sdlc-code-review,sdlc-review-audit") HELD_NEW_REPS=2
LISTING_JS=${LISTING_JS:-$KIT_SRC/listing-check.js}
# Kiro-only rerun (owner approval needed before any paid step): 390 credits and $20 of judging. Left of the approved total
# after the first study: 520 - 123.84 = 396.16 credits and $151 - $21.16 = $129.84. No Claude Code spend.
# SOFT caps (owner, 2026-11-19): 390 credits and $20 of judging are the plan. The run warns at 90% of them and goes on; it
# stops only at the ceiling, the rest of the approved total (396 credits; $129 of the $151 for judging).
CAP3_CR=390 CAP3_JUDGE=20 CEIL3_CR=396 CEIL3_JUDGE=129
TIMEOUT_SEC=1800          # soft limit for BOTH arms and every task (pre-declared before the first run); the report re-scores at 600 and 1200 s
PY312_BIN=${PY312_BIN:-$S/pybin}         # a dir whose python3 and python are Python 3.12 (see bench/docs/repeat.md)
export PATH=$PY312_BIN:$PATH
CAP1_CR=80 CAP1_CC=13 CAP1_JUDGE=7       # stage 1, DEV set x 2 reps (load probe, tuning): 80 credits, $20
CAP2_CR=440 CAP2_CC=90 CAP2_JUDGE=40     # stage 2, HELD-OUT set x 3 reps (the verdict): 440 credits, $130
RUN_CAP_USD=3
CRED_MIN_MINUTES=60
export TMPDIR=$S/tmp
umask 077
mkdir -p "$TMPDIR"

# shellcheck source=lib.sh
source "$KIT_SRC/lib.sh"   # the helpers both kits share: pins, freeze, host, logins, spend sums

# ---- pins, freeze, host

load_frozen() {
  [ -f "$S/freeze.env" ] || die "run 'freeze' first"
  # shellcheck disable=SC1091
  . "$S/freeze.env"
  [ "$(git -C "$R" rev-parse HEAD)" = "$BENCH_SHA" ] || die "worktree HEAD is not the frozen bench commit $BENCH_SHA"
  [ -z "$(git -C "$R" status --porcelain)" ] || die "worktree $R has changes"
  git -C "$R" fetch -q origin main
  local now d c
  now=$(git -C "$R" rev-parse origin/main)
  # A local KONDUCTOR_REF (an integration commit, never pushed) is its own base: main moving does not matter then.
  if [ "${KONDUCTOR_REF:-origin/main}" = origin/main ] && [ "$now" != "$COMMIT" ] && [ "${ALLOW_MAIN_MOVED:-}" != 1 ]; then
    die "origin/main moved from $COMMIT to $now during the study; nothing was run. Pause merges, or set ALLOW_MAIN_MOVED=1 to go on (the study stays on $COMMIT)"
  fi
  for d in "$S"/rerun/kiro; do
    [ -f "$d/run-config.json" ] || continue
    for c in $(grep -hoE '"commitSha": *"[0-9a-f]{40}"' "$d/run-config.json" "$d"/run-configs/*.json 2>/dev/null | grep -oE '[0-9a-f]{40}' | sort -u); do
      [ "$c" = "$COMMIT" ] || die "$d holds runs of konductor commit $c, not the frozen $COMMIT"
    done
  done
  COMMON=(--suite rootcause --seed "$SEED" --parallel 1 --repo-root "$R" --cache "$SHARED/cache" --cargo-target "$SHARED/cargo-target"
    --extra-tasks "$R/bench/sdlc" --hide "$R" --isolate unshare --effort "$EFFORT" --timeout-sec "$TIMEOUT_SEC")
  KIRO=(--arms "vanilla,konductor=$COMMIT" --model claude-sonnet-5.5 --agent-engine v3 --kiro-bin "$KBIN")
  CC=(--arms "cc-vanilla,cc-konductor=$COMMIT" --model us.anthropic.claude-sonnet-5-5 --claude-bin "$CBIN"
    --aws-profile "$AWSP" --aws-region "$REGION" --run-budget-usd "$RUN_CAP_USD")
}
use_set() { # 1|dev or 2|held: stage 1 is the DEV set, stage 2 the HELD-OUT set; each has its own dirs
  case "$1" in 3 | rerun) SET=rerun ;; *) die "this copy has one set: 3 (rerun)" ;; esac
  KD=$S/$SET/kiro CD=$S/$SET/none
}

# ---- spend
spent() { # spent DIR credits|usd|judge
  find "$1" -mindepth 4 -maxdepth 4 -name result.json -not -path '*/incomplete/*' 2>/dev/null | RUN_CAP_USD=$RUN_CAP_USD node -e '
    const fs = require("fs"), path = require("path"), [dir, kind] = process.argv.slice(1), f = Number.isFinite;
    let n = 0;
    if (kind === "judge") {
      for (const x of ["judgments.json", "judgments-quality.json"]) { try { const j = JSON.parse(fs.readFileSync(path.join(dir, x), "utf8")); if (f(j.spentUsd)) n += j.spentUsd; } catch {} }
      fs.readFileSync(0); console.log(n.toFixed(4)); process.exit(0);   // drain stdin so `find` never dies of SIGPIPE
    }
    const files = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
    for (const file of files) {
      const r = JSON.parse(fs.readFileSync(file, "utf8"));
      if (kind === "credits") n += f(r.creditsCharged) ? r.creditsCharged : f(r.credits) ? r.credits : 0;
      else n += f(r.costUsdCharged) ? r.costUsdCharged : f(r.costUsd) ? r.costUsd : r.costCensored ? Number(process.env.RUN_CAP_USD) : 0;
    }
    console.log(n.toFixed(4));' "$1" "$2"
}
stage_dirs() { # stage_dirs 1|2 kiro|cc: the dirs a stage's cap is counted over
  echo "$S/rerun/$2"
}

# ---- runs
# A rerun of any stage is safe: once a harness dir has a run-config, every batch passes --resume, so finished cells are
# kept and only cells with no result.json run again. RESUME_ERRORS=1 also reruns errored cells (read their stderr first).
soft_warn() { # KIND SPENT SOFT_CAP: warn (never stop) from 90% of the soft cap on; one line per call, also kept in $S/soft-cap-warnings.log
  awk -v s="$2" -v c="$3" 'BEGIN { exit !(s >= 0.9 * c) }' || return 0
  printf '%s WARNING: %s spent %s is past 90%% of the soft cap %s (the run goes on; it stops at the ceiling)\n' "$(date '+%F %T')" "$1" "$2" "$3" | tee -a "$S/soft-cap-warnings.log" >&2
}
kiro_batch() { # TASKS OFFSET CEILING
  local l; soft_warn credits "$(spent_in credits $(stage_dirs "$STAGE" kiro))" "$CAP3_CR"
  l=$(left "$3" "$(spent_in credits $(stage_dirs "$STAGE" kiro))")
  enough "$l" 5 || die "Kiro ceiling of $3 credits reached ($l left); the soft cap was $CAP3_CR"
  kiro_login
  say "kiro: $1, replicate $(($2 + 1)), budget $l credits"
  # shellcheck disable=SC2046
  nice -n 10 node "$BJ" run "${COMMON[@]}" "${KIRO[@]}" --out "$KD" --tasks "$1" --replicate-offset "$2" --replicates 1 --budget-credits "$l" $(resume_of "$KD")
}
ALL17=("hard-seat-holds,rc-agents-md,req-vague-request" "hard-export-formats,rc-threat-model" "hard-batch-flaky,design-hold-service"
  "hard-catalog-limits,orch-input-validation" "orch-search-hardening,review-inventory-security" "sdlc-spike-dedupe,sdlc-arch-decision"
  "plan-multipart-feature,sop-test-coverage-review" "sdlc-code-review,sdlc-review-audit")   # the 17 HELD-OUT tasks, 8 batches
stage() { # 3 kiro: 17 HELD-OUT tasks x 3 replicates, Kiro vanilla and konductor. Replicate by replicate, so a stop leaves whole replicates.
  [ "$2" = kiro ] || die "this copy runs Kiro only"
  STAGE=$1; use_set "$1"
  local rep t
  for ((rep = 0; rep < 3; rep++)); do for t in "${ALL17[@]}"; do kiro_batch "$t" "$rep" "$CEIL3_CR"; done; done
  say "rerun kiro done: $(spent "$KD" credits) credits spent"
}

# ---- judging and reports (the median of three judges is bench's scoring since 223bcaa9; never pass --allow-small-panel)
judge_dir() { # DIR BASELINE CAP PLAN(0|1)
  local l plan=()
  [ "$4" = 1 ] && plan=(--plan)
  local J=(--extra-tasks "$X" --judge-backend opencode --judges "$PANEL" --aws-export-profile "$AWSP" --aws-region "$REGION"
    --opencode-bin "$(command -v opencode)" --concurrency 2 --isolate unshare --hide "$R")
  soft_warn judge-usd "$(spent_in judge $(stage_dirs "$STAGE" kiro))" "$CAP3_JUDGE"
  l=$(left "$3" "$(spent_in judge $(stage_dirs "$STAGE" kiro))")
  enough "$l" 0.5 || die "judging ceiling of \$$3 reached"
  node "$BJ" judge --run "$1" "${J[@]}" --mode rubric,pairwise,graded --baseline "$2" --budget-usd "$l" "${plan[@]}"
  l=$(left "$3" "$(spent_in judge $(stage_dirs "$STAGE" kiro))")
  node "$BJ" judge --run "$1" "${J[@]}" --criteria-pack quality --budget-usd "$l" "${plan[@]}"
}
judge_all() { # 3 PLAN
  STAGE=$1
  [ "$2" = 1 ] || fresh_creds
  use_set "$1"
  judge_dir "$KD" vanilla "$CEIL3_JUDGE" "$2"
}
report() { # 3: the Kiro-only report; the paired per-task interval and the cost and time table are in report-rerun-kiro/report.md
  use_set "$1"
  node "$BJ" report --run "$KD" --baseline vanilla --extra-tasks "$X" --criteria-pack quality --out "$S/report-rerun-kiro"
  node "$BJ" report --run "$KD" --baseline vanilla --extra-tasks "$X" --criteria-pack quality --scoring "$R/bench/profiles/scoring-fractional.json" --out "$S/report-rerun-kiro-fractional"
  label_reports
  # Why did the long runs run long, and the same result if the limit had been 600 or 1200 s (read only)
  python3 "$KIT_SRC/timeline.py" --run "$KD" --min-sec 600 --out "$S/report-rerun-kiro/timelines" || say "WARNING: timeline step failed"
  BENCH_ROOT="$R/bench" node "$KIT_SRC/rescore-by-limit.js" --run "$KD" --baseline vanilla --variant konductor --limits 600,1200,1800 --extra-tasks "$X" --out "$S/report-rerun-kiro/rescore-by-limit.md" >/dev/null || say "WARNING: rescore step failed"
  # `calibrate export` takes --extra-tasks since D-47 was fixed; a bench at R older than that fix still stops on an sdlc
  # task, so a failed export stays a warning, not a stop.
  node "$BJ" calibrate export --run "$KD" --n 25 --seed 1 --extra-tasks "$X" || say "WARNING: calibration sample not exported (a bench at R older than the D-47 fix cannot find sdlc tasks); a person cannot label a sample from this run yet"
  say "table: $S/report-rerun-kiro/report.md"
}

gate() { # STAGE (3). free: the stage gate numbers from the saved results
  local k c; k=$(stage_dirs "$1" kiro) c=
  # shellcheck disable=SC2086
  say "spent: Kiro $(spent_in credits $k) credits, Claude Code \$$(spent_in usd $c), judging \$$(spent_in judge $k $c)"
  local sets=rerun
  git -C "$R" ls-tree --name-only "$COMMIT" skills/ | sed 's#^skills/##' >"$TMPDIR/konductor-skills.txt"
  node -e '
    const fs = require("fs"), path = require("path"), [S, list, SETS, allowUnrecorded] = process.argv.slice(1);
    const kskills = new Set(fs.readFileSync(list, "utf8").split("\n").filter(Boolean));
    const isDir = (p) => fs.statSync(p).isDirectory();
    let stop = false;
    for (const SET of SETS.split(" ")) for (const h of ["kiro"]) {
      const root = path.join(S, SET, h); if (!fs.existsSync(root)) continue;
      for (const arm of fs.readdirSync(root).filter((a) => isDir(path.join(root, a)) && !["judge", "incomplete", "run-configs"].includes(a))) {
        const rs = [];
        for (const t of fs.readdirSync(path.join(root, arm)).filter((x) => isDir(path.join(root, arm, x)))) for (const rep of fs.readdirSync(path.join(root, arm, t)).filter((x) => /^\d+$/.test(x))) {
          const f = path.join(root, arm, t, rep, "result.json");
          if (!fs.existsSync(f)) continue;
          const r = JSON.parse(fs.readFileSync(f, "utf8"));
          try { r.__startup = JSON.parse(fs.readFileSync(path.join(root, arm, t, rep, "startup.json"), "utf8")); } catch { r.__startup = null; }
          rs.push(r);
        }
        if (!rs.length) continue;
        const has = (r, k) => r[k] === true || (Array.isArray(r.flags) && r.flags.includes(k));
        const n = rs.length, c = (p) => rs.filter(p).length;
        const mism = c((r) => has(r, "modelMismatch")), tamper = c((r) => ["credsUnscrubbed", "stdioTampered", "usageDbTampered"].some((k) => has(r, k)));
        const infra = c((r) => Boolean(r.infraError)), tout = c((r) => r.status === "timeout");
        const leak = /vanilla/.test(arm) ? c((r) => (r.skillsLoaded || []).some((s) => kskills.has(String(s.name || s)))) : 0;
        const efforts = [...new Set(rs.map((r) => r.effort))].join(",");
        // Claude Code konductor cells: the skill listing must be recorded and leave no konductor skill name-only
        // Every Claude Code cell: the listing must hold built-ins and the skills of the arm only (otherDescribed and
        // otherNameOnly 0; a skill found above the run cwd is a confound). Konductor cells: no konductor skill name-only.
        const lst = h === "cc" ? rs.map((r) => r.claudeCode?.skillListing ?? null) : [];
        const unrec = lst.filter((x) => !x).length, cutRuns = lst.filter((x) => x && x.nameOnly > 0).length;
        const foreignRuns = lst.filter((x) => x && (x.otherDescribed ?? 0) + (x.otherNameOnly ?? 0) > 0).length;
        const listingBad = cutRuns > 0 || foreignRuns > 0 || (unrec > 0 && allowUnrecorded !== "1");
        // Startup (owner rule): the default agent of the tool, or konductor; no MCP server except the konductor install on Kiro;
        // nothing from the real ~/.kiro or ~/.claude; vanilla arms get no steering, rules or skills from their HOME.
        const van = /vanilla/.test(arm);
        const wantAgent = van ? (h === "kiro" ? "kiro_default" : "default") : "konductor";
        const startBad = rs.filter((r) => {
          const st = r.__startup;
          if (!st) return true;
          if (!st.homeIsolated || (st.realHomeLinks || []).length) return true;
          if (st.agent !== wantAgent) return true;
          const mcp = st.mcpServers || [];
          if (van || h === "cc" ? mcp.length : mcp.some((m) => !String(m.source).startsWith("~/.kiro/agents/"))) return true;
          if (van && (st.steering || []).some((p) => p.startsWith("~/") && p !== "~/.claude/rules/empty.md")) return true;
          return false;
        }).length;
        const bad = mism || tamper || leak || infra / n > 0.1 || tout / n > 0.3 || efforts !== "high" || listingBad || startBad > 0;
        stop ||= bad;
        console.log(`[2x2] ${SET}/${h}/${arm}: ${n} runs, effort ${efforts}, model mismatch ${mism}, tamper ${tamper}, konductor skill in vanilla ${leak}, infra ${infra}, timeouts ${tout}, startup not as required ${startBad}${lst.length ? `, listing unrecorded ${unrec}, name-only runs ${cutRuns}, runs with foreign skills ${foreignRuns}` : ""} ${bad ? "STOP" : "ok"}`);
      }
    }
    if (stop) { console.log("[2x2] gate: STOP, do not start the next stage"); process.exit(1); }
    console.log("[2x2] gate: ok for these checks; also read NO DATA runs, judge seats and pairwise order flips (25% limit) in the reports");' "$S" "$TMPDIR/konductor-skills.txt" "$sets" "${LISTING_UNRECORDED_OK:-0}"
}

missing() { # free: planned rerun cells with no result.json
  local b t rep arm
  for b in "${ALL17[@]}"; do for t in ${b//,/ }; do for arm in vanilla konductor; do for ((rep = 1; rep <= 3; rep++)); do
    [ -f "$S/rerun/kiro/$arm/$t/$rep/result.json" ] || echo "rerun kiro $arm $t rep $rep"
  done; done; done; done
}

(return 0 2>/dev/null) && return 0   # sourced (overnight scripts, the PR 312 probe): constants and helpers only
cmd=${1:-}
case "$cmd" in check | freeze | prepare | stage3 | judge-plan | judge | gate | report) need_r ;; esac
case "$cmd" in
  split-check) split_check ;;
  check) need_awsp; pins; split_check; quiet; kiro_login; "$KBIN" chat --list-models --format json | grep -q '"model_id":"claude-sonnet-5.5"' || die "Kiro does not list claude-sonnet-5.5"
         [ "$(opencode --version)" = 1.19.5 ] || die "opencode is not 1.19.5"
         python3 --version 2>&1 | grep -q '^Python 3\.12\.' || die "python3 is not 3.12 on PATH (PY312_BIN=$PY312_BIN)"
         python --version 2>&1 | grep -q '^Python 3\.12\.' || die "python is not 3.12 on PATH (PY312_BIN=$PY312_BIN)"
         bedrock; families; preconditions; say "check passed" ;;
  freeze) freeze ;;
  prepare) load_frozen; split_check; quiet; take_lock prepare
           all=$(printf '%s,' "${ALL17[@]}" | sed 's/,$//')
           node "$BJ" run "${COMMON[@]}" "${KIRO[@]}" --out "$S/prep/kiro" --tasks "$all" --replicates 3 --prepare-only ;;
  stage3) : "${2:?say kiro}"; load_frozen; pins; split_check; quiet; take_lock "$cmd $2"; stage 3 "$2" ;;
  judge-plan) need_awsp; load_frozen; judge_all 3 1 ;;
  judge) need_awsp; load_frozen; pack_same; families; preconditions; take_lock judge; judge_all 3 0 ;;
  gate) load_frozen; gate 3 ;;
  missing) missing ;;
  report) load_frozen; report 3 ;;
  *) echo "usage: run-2x2-kiro.sh split-check|missing|check|freeze|prepare|stage3 kiro|judge-plan|judge|gate|report" >&2; exit 2 ;;
esac
