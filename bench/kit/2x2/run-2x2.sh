#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# run-2x2.sh: the owner's run kit for the konductor 2x2 (Kiro CLI and Claude Code, each without and with konductor).
# Run it from your own terminal, never from an agent shell. One study lives in one S directory.
#   free:  split-check | missing | check | freeze | prepare | judge-plan 1|2 | gate 1|2 | report 1|2   (1 = DEV set, 2 = HELD-OUT set)
#   paid:  smoke | stage1 kiro|cc | judge 1|2 | stage2 kiro|cc
# Needs: S (the study directory) or KIT_DIR; R (a dedicated konductor worktree, never your own checkout, and the kit must
# run from a copy outside it); AWSP (the NAME of your least-privilege Bedrock profile, never a key). Optional: REFRESH_CMD
# (refreshes AWSP), ACK_CC_VERSION=1, ALLOW_MAIN_MOVED=1, RESUME_ERRORS=1, KBIN, CBIN, LISTING_JS, LOCK.
# Effort is --effort high in both harnesses; scores are the median of three judges.
# SPEND APPROVED by the owner on 2026-11-18: 520 credits and $151 in all, each stage capped on its own:
#   smoke $1 (about $0.5, Claude Code 2.1.327) runs first; stage 1 (DEV) 80 credits and $20; stage 2 (HELD-OUT) 440 credits and $130.
# The owner runs this kit in their own terminal after their PRs merge. No stage starts without ACK_CC_VERSION=1 (set after smoke).
# Landing order (owner): the trim PR, then PR #298, then `freeze`. freeze refuses a konductor commit whose Claude Code skill
# listing leaves any konductor skill name-only (listing-check.js beside this script). LISTING_UNRECORDED_OK=1 lets `gate`
# pass Claude konductor cells whose runs do not record the listing yet (until bench records it per run).
# Startup rule (owner, 2026-11-18): each arm starts the default agent of its tool (Kiro kiro_default, Claude Code the
# main session) or konductor, with no MCP server (konductor's own on Kiro only), nothing from the real ~/.kiro or
# ~/.claude, and no steering, rules or skills in a vanilla HOME. bench writes startup.json per run; `gate` checks it.
set -euo pipefail
KIT_SRC=${KIT_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)}   # the dir of this script; a caller that sources the helpers sets it first
R=${R:-}                                    # a dedicated konductor worktree; `freeze` checks out the frozen bench commit in it
S=${S:-${KIT_DIR:?set S (the study directory) or KIT_DIR}}
AWSP=${AWSP:-}
REGION=us-east-1
KBIN=${KBIN:-$S/bin/kiro-cli-3.5.0/kiro-cli}
KBIN_SHA=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
CBIN=${CBIN:-$S/bin/claude-code/2.1.327.1766/claude}
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
  for d in "$S"/dev/kiro "$S"/dev/cc "$S"/held/kiro "$S"/held/cc "$S"/held-sop/kiro "$S"/held-sop/cc; do
    [ -f "$d/run-config.json" ] || continue
    for c in $(grep -hoE '"commitSha": *"[0-9a-f]{40}"' "$d/run-config.json" "$d"/run-configs/*.json 2>/dev/null | grep -oE '[0-9a-f]{40}' | sort -u); do
      [ "$c" = "$COMMIT" ] || die "$d holds runs of konductor commit $c, not the frozen $COMMIT"
    done
  done
  COMMON=(--suite rootcause --seed "$SEED" --parallel 1 --repo-root "$R" --cache "$S/cache" --cargo-target "$S/cargo-target"
    --extra-tasks "$R/bench/sdlc" --hide "$R" --isolate unshare --effort "$EFFORT")
  KIRO=(--arms "vanilla,konductor=$COMMIT" --model claude-sonnet-5.5 --agent-engine v3 --kiro-bin "$KBIN")
  CC=(--arms "cc-vanilla,cc-konductor=$COMMIT" --model us.anthropic.claude-sonnet-5-5 --claude-bin "$CBIN"
    --aws-profile "$AWSP" --aws-region "$REGION" --run-budget-usd "$RUN_CAP_USD")
}
use_set() { # 1|dev or 2|held: stage 1 is the DEV set, stage 2 the HELD-OUT set; each has its own dirs
  case "$1" in 1 | dev) SET=dev ;; 2 | held) SET=held ;; sop | held-sop) SET=held-sop ;; *) die "say 1 (DEV) or 2 (HELD-OUT)" ;; esac
  KD=$S/$SET/kiro CD=$S/$SET/cc
}

# ---- spend
spent() { # spent DIR credits|usd|judge
  find "$1" -mindepth 4 -maxdepth 4 -name result.json -not -path '*/incomplete/*' 2>/dev/null | RUN_CAP_USD=$RUN_CAP_USD node -e '
    const fs = require("fs"), path = require("path"), [dir, kind] = process.argv.slice(1), f = Number.isFinite;
    let n = 0;
    if (kind === "judge") {
      for (const x of ["judgments.json", "judgments-quality.json"]) { try { const j = JSON.parse(fs.readFileSync(path.join(dir, x), "utf8")); if (f(j.spentUsd)) n += j.spentUsd; } catch {} }
      console.log(n.toFixed(4)); process.exit(0);
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
  if [ "$1" = 1 ]; then echo "$S/dev/$2"; else echo "$S/held/$2 $S/held-sop/$2"; fi
}

# ---- runs
# A rerun of any stage is safe: once a harness dir has a run-config, every batch passes --resume, so finished cells are
# kept and only cells with no result.json run again. RESUME_ERRORS=1 also reruns errored cells (read their stderr first).
kiro_batch() { # TASKS OFFSET CAP
  local l; l=$(left "$3" "$(spent_in credits $(stage_dirs "$STAGE" kiro))")
  enough "$l" 5 || die "Kiro cap of $3 credits reached ($l left)"
  kiro_login
  say "kiro: $1, replicate $(($2 + 1)), budget $l credits"
  # shellcheck disable=SC2046
  nice -n 10 node "$BJ" run "${COMMON[@]}" "${KIRO[@]}" --out "$KD" --tasks "$1" --replicate-offset "$2" --replicates 1 --budget-credits "$l" $(resume_of "$KD")
}
stage() { # 1|2 kiro|cc. Stage 1: DEV x 2 reps. Stage 2: HELD-OUT x 3 reps.
  local which=$2 rep t cap n sets
  STAGE=$1
  use_set "$1"
  if [ "$1" = 1 ]; then n=2; sets=("${DEV[@]}"); else n=3; sets=("${HELD[@]}"); fi
  # Short run (owner, 2026-11-19): HELD_SUBSET="a,b c,d e" (batches split by spaces) runs only these HELD-OUT tasks, HELD_REPS (default 2) times, into the
  # held dirs, with no SOP-class and no extra tasks. The result is a partial HELD-OUT set and is reported as such.
  local short=0
  if [ "$1" = 2 ] && [ -n "${HELD_SUBSET:-}" ]; then short=1; n=${HELD_REPS:-2}; read -ra sets <<<"$HELD_SUBSET"
    for t in ${HELD_SUBSET//,/ }; do [[ " ${HELD[*]//,/ } " == *" $t "* ]] || die "HELD_SUBSET task $t is not in the HELD-OUT list (the SOP-class and extra tasks are not allowed)"; done; fi
  if [ "$which" = kiro ]; then cap=$CAP1_CR; [ "$1" = 2 ] && cap=$CAP2_CR; else cap=$CAP1_CC; [ "$1" = 2 ] && cap=$CAP2_CC; fi
  for ((rep = 0; rep < n; rep++)); do for t in "${sets[@]}"; do "${which}_batch" "$t" "$rep" "$cap"; done; done
  local more=("${DEV_NEW[@]}") m=$DEV_NEW_REPS; [ "$1" = 2 ] && more=("${HELD_NEW[@]}") m=$HELD_NEW_REPS
  [ "$short" = 1 ] && more=() m=0
  for ((rep = 0; rep < m; rep++)); do for t in "${more[@]}"; do "${which}_batch" "$t" "$rep" "$cap"; done; done
  if [ "$1" = 2 ] && [ "$short" = 0 ]; then # the sop-class HELD-OUT tasks, into their own dirs; the stage cap covers both dir sets
    use_set sop
    for ((rep = 0; rep < n; rep++)); do for t in "${HELD_SOP[@]}"; do "${which}_batch" "$t" "$rep" "$cap"; done; done
  fi
  say "stage $1 ($SET) $which done: Kiro $(spent "$KD" credits) credits, Claude Code \$$(spent "$CD" usd) spent in this set"
}

# ---- judging and reports (the median of three judges is bench's scoring since 223bcaa9; never pass --allow-small-panel)
judge_dir() { # DIR BASELINE CAP PLAN(0|1)
  local l plan=()
  [ "$4" = 1 ] && plan=(--plan)
  local J=(--extra-tasks "$X" --judge-backend opencode --judges "$PANEL" --aws-export-profile "$AWSP" --aws-region "$REGION"
    --opencode-bin "$(command -v opencode)" --concurrency 2 --isolate unshare --hide "$R")
  l=$(left "$3" "$(spent_in judge $(stage_dirs "$STAGE" kiro) $(stage_dirs "$STAGE" cc))")
  enough "$l" 0.5 || die "judging cap of \$$3 reached"
  node "$BJ" judge --run "$1" "${J[@]}" --mode rubric,pairwise,graded --baseline "$2" --budget-usd "$l" "${plan[@]}"
  l=$(left "$3" "$(spent_in judge $(stage_dirs "$STAGE" kiro) $(stage_dirs "$STAGE" cc))")
  node "$BJ" judge --run "$1" "${J[@]}" --criteria-pack quality --budget-usd "$l" "${plan[@]}"
}
judge_all() { # STAGE PLAN
  local cap=$CAP1_JUDGE; [ "$1" = 2 ] && cap=$CAP2_JUDGE
  STAGE=$1
  [ "$2" = 1 ] || fresh_creds
  local sets=("$1"); [ "$1" = 2 ] && sets=(2 sop)
  for set in "${sets[@]}"; do
    use_set "$set"
    [ -d "$KD" ] && judge_dir "$KD" vanilla "$cap" "$2"
    [ -d "$CD" ] && judge_dir "$CD" cc-vanilla "$cap" "$2"
  done
  return 0
}
report() { # STAGE: 1 = DEV (never used for the verdict), 2 = HELD-OUT (the verdict). report-2x2 refuses mixed effort levels.
  use_set "$1"
  local cells=(--kiro-vanilla "$KD:vanilla" --kiro-konductor "$KD:konductor" --cc-vanilla "$CD:cc-vanilla" --cc-konductor "$CD:cc-konductor")
  # --criteria-pack quality: quality, cost and time per arm and per SDLC phase, plus the paired per-task view
  node "$BJ" report-2x2 "${cells[@]}" --extra-tasks "$X" --criteria-pack quality --out "$S/report-$SET"
  node "$BJ" report-2x2 "${cells[@]}" --extra-tasks "$X" --criteria-pack quality --scoring "$R/bench/profiles/scoring-fractional.json" --out "$S/report-$SET-fractional"
  node "$BJ" report --run "$KD" --baseline vanilla --extra-tasks "$X" --criteria-pack quality --out "$S/report-$SET-kiro"
  node "$BJ" report --run "$CD" --baseline cc-vanilla --extra-tasks "$X" --criteria-pack quality --out "$S/report-$SET-cc"
  [ "$SET" = held ] && for d in "$KD" "$CD"; do node "$BJ" calibrate export --run "$d" --n 25 --seed 1; done
  say "tables ($SET set$([ "$SET" = dev ] && echo ', not for the verdict')): $S/report-$SET/factorial-2x2.md"
  if [ "$1" = 2 ]; then
    local hk=$KD hc=$CD
    use_set sop
    if [ ! -d "$KD" ]; then say "verdict (PARTIAL HELD-OUT, short run): $S/report-held/factorial-2x2.md; no SOP-class or extra tasks were run"; return; fi
    node "$BJ" report-2x2 --kiro-vanilla "$KD:vanilla" --kiro-konductor "$KD:konductor" --cc-vanilla "$CD:cc-vanilla" --cc-konductor "$CD:cc-konductor" \
      --extra-tasks "$X" --criteria-pack quality --out "$S/report-held-sop"
    if [ "${SOP_PARITY:-0}" = 1 ]; then
      node "$BJ" report-2x2 --kiro-vanilla "$hk,$KD:vanilla" --kiro-konductor "$hk,$KD:konductor" --cc-vanilla "$hc,$CD:cc-vanilla" --cc-konductor "$hc,$CD:cc-konductor" \
        --extra-tasks "$X" --criteria-pack quality --out "$S/report-held-all"
      say "verdict: $S/report-held-all/factorial-2x2.md (15 HELD-OUT tasks; SOPs were invocable on Claude Code at freeze)"
    else
      say "verdict: $S/report-held/factorial-2x2.md (13 tasks). $S/report-held-sop: not comparable until SOPs are invocable on Claude"
    fi
  fi
}

gate() { # STAGE. free: the stage gate numbers from the saved results
  local k c; k=$(stage_dirs "$1" kiro) c=$(stage_dirs "$1" cc)
  # shellcheck disable=SC2086
  say "spent: Kiro $(spent_in credits $k) credits, Claude Code \$$(spent_in usd $c), judging \$$(spent_in judge $k $c)"
  local sets=dev; [ "$1" = 2 ] && sets="held held-sop"
  git -C "$R" ls-tree --name-only "$COMMIT" skills/ | sed 's#^skills/##' >"$TMPDIR/konductor-skills.txt"
  node -e '
    const fs = require("fs"), path = require("path"), [S, list, SETS, allowUnrecorded] = process.argv.slice(1);
    const kskills = new Set(fs.readFileSync(list, "utf8").split("\n").filter(Boolean));
    const isDir = (p) => fs.statSync(p).isDirectory();
    let stop = false;
    for (const SET of SETS.split(" ")) for (const h of ["kiro", "cc"]) {
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

missing() { # free: planned cells with no result.json, per set and harness
  local line set n tasks h arm t rep
  for line in "dev 2 ${DEV[*]}" "dev $DEV_NEW_REPS ${DEV_NEW[*]}" "held 3 ${HELD[*]}" "held $HELD_NEW_REPS ${HELD_NEW[*]}" "held-sop 3 ${HELD_SOP[*]}"; do
    read -r set n tasks <<<"$line"
    for h in kiro cc; do
      for arm in $([ $h = kiro ] && echo vanilla konductor || echo cc-vanilla cc-konductor); do
        for t in ${tasks//,/ }; do for ((rep = 1; rep <= n; rep++)); do
          [ -f "$S/$set/$h/$arm/$t/$rep/result.json" ] || echo "$set $h $arm $t rep $rep"
        done; done
      done
    done
  done
}

(return 0 2>/dev/null) && return 0   # sourced (overnight scripts, the PR 312 probe): constants and helpers only
cmd=${1:-}
case "$cmd" in check | freeze | prepare | smoke | stage1 | stage2 | judge-plan | judge | gate | report) need_r ;; esac
case "$cmd" in
  split-check) split_check ;;
  check) need_awsp; pins; split_check; quiet; kiro_login; "$KBIN" chat --list-models --format json | grep -q '"model_id":"claude-sonnet-5.5"' || die "Kiro does not list claude-sonnet-5.5"
         [ "$(opencode --version)" = 1.19.5 ] || die "opencode is not 1.19.5"; bedrock; families; preconditions; say "check passed" ;;
  freeze) freeze ;;
  prepare) load_frozen; split_check; quiet; take_lock prepare   # --prepare-only makes a real run's flag and arm checks since 25516bab
           use_set held; all=$(printf '%s,' "${DEV[@]}" "${DEV_NEW[@]}" "${HELD[@]}" "${HELD_SOP[@]}" "${HELD_NEW[@]}" | sed 's/,$//')
           node "$BJ" run "${COMMON[@]}" "${KIRO[@]}" --out "$S/prep/kiro" --tasks "$all" --replicates 3 --prepare-only
           node "$BJ" run "${COMMON[@]}" "${CC[@]}" --out "$S/prep/cc" --tasks "$all" --replicates 3 --budget-usd 1 --prepare-only ;;
  smoke) need_awsp; load_frozen; pins; quiet; take_lock smoke; fresh_creds
         [ ! -e "$S/smoke" ] || die "$S/smoke exists; move it aside first"
         bash "$R/bench/scripts/claude-code-smoke.sh" --profile "$AWSP" --claude-bin "$CBIN" --arm "cc-smoke=$COMMIT" --cache "$S/cache" \
           --cargo-target "$S/cargo-target" --isolate unshare --budget-usd 1 --out "$S/smoke" | tee "$TMPDIR/smoke.log"
         grep -q 'delegation worked under isolation: yes' "$TMPDIR/smoke.log" || die "smoke: delegation did not work under isolation"
         say "smoke passed; set ACK_CC_VERSION=1 for the stages" ;;
  stage1 | stage2) : "${2:?say kiro or cc}"; need_awsp; load_frozen; pins; ack_cc; split_check; preconditions; quiet; take_lock "$cmd $2"; stage "${cmd#stage}" "$2" ;;
  judge-plan) need_awsp; load_frozen; judge_all "${2:?1 or 2}" 1 ;;
  judge) need_awsp; load_frozen; pack_same; families; preconditions; take_lock judge; judge_all "${2:?1 or 2}" 0 ;;
  gate) load_frozen; gate "${2:?1 (DEV) or 2 (HELD-OUT)}" ;;
  missing) missing ;;
  report) load_frozen; report "${2:?1 or 2}"; label_reports ;;
  *) sed -n '3,11p' "$0"; exit 2 ;;
esac
