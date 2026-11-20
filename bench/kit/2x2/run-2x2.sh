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

say() { printf '[2x2] %s\n' "$*"; }
die() { printf '[2x2] STOP: %s\n' "$*" >&2; exit 2; }
need_awsp() { [ -n "$AWSP" ] || die "set AWSP to your least-privilege Bedrock profile"; }
need_r() { # R is the konductor worktree the kit builds from and checks out; the kit must not live inside it (freeze replaces its files)
  { [ -d "$R/.git" ] || [ -f "$R/.git" ]; } || die "set R to a dedicated konductor git worktree (not your own checkout)"
  case "$KIT_SRC/" in "$(cd "$R" && pwd -P)"/*) die "run the kit from a copy outside $R: freeze checks out another commit there and would replace this script" ;; esac
}

# ---- pins, freeze, host
pins() {
  [ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "$KBIN_SHA" ] || die "kiro-cli copy at $KBIN does not match its pinned sha256"
  [ "$(sha256sum "$CBIN" | cut -d' ' -f1)" = "$CBIN_SHA" ] || die "claude copy at $CBIN does not match its pinned sha256"
  "$KBIN" --version | grep -qx 'kiro-cli 3.5.0' || die "kiro-cli copy is not 3.5.0"
  "$CBIN" --version | grep -q '^2\.1\.327 ' || die "claude copy is not 2.1.327"
  "$CBIN" --help | grep -q -- '--effort' || die "claude copy has no --effort flag"
  say "pins ok: kiro-cli 3.5.0, claude $CC_VERSION with --effort (bench validated on $(validated))"
}
validated() { node -e 'console.log(require(process.argv[1]).VALIDATED_VERSION)' "$R/bench/runner/lib/harness/claude-code.js"; }
ack_cc() { # owner rule (2026-11-18): no stage starts without ACK_CC_VERSION=1, set after the smoke run passes
  [ "${ACK_CC_VERSION:-}" = 1 ] || die "run 'smoke' first (Claude Code $CC_VERSION; bench validated on $(validated)), then set ACK_CC_VERSION=1"
}

freeze() {
  [ -z "$(git -C "$R" status --porcelain)" ] || die "worktree $R has changes"
  git -C "$R" fetch -q origin main feat/bench-pilot-nk
  local commit bench
  commit=$(git -C "$R" rev-parse "${KONDUCTOR_REF:-origin/main}^{commit}") || die "KONDUCTOR_REF ${KONDUCTOR_REF:-origin/main} is not a commit in $R"
  bench=$(git -C "$R" rev-parse origin/feat/bench-pilot-nk)
  if [ -f "$S/freeze.env" ]; then
    # shellcheck disable=SC1091
    . "$S/freeze.env"
    if [ "$COMMIT" = "$commit" ] && [ "$BENCH_SHA" = "$bench" ]; then say "already frozen: COMMIT=$COMMIT BENCH_SHA=$BENCH_SHA"; return; fi
    die "this study is frozen at COMMIT=$COMMIT BENCH_SHA=$BENCH_SHA; origin now gives $commit / $bench. Finish on the frozen values, or start a new study with another S"
  fi
  # The pinned commit's Claude Code skill listing (budget 30,000 chars for Sonnet 5.5) must leave no konductor skill
  # name-only. The estimate is conservative (it ran about 850 chars over the measured listing), so a refusal here can be
  # checked with the free `claude -p '/context'` recipe in bench/docs/repeat.md before anything else changes.
  mkdir -p "$S"
  node "$LISTING_JS" "$R" "$commit" --json >"$S/listing.json" || { node "$LISTING_JS" "$R" "$commit" || true; die "konductor commit $commit leaves skills name-only in the Claude Code listing; land the trim PR first, then freeze"; }
  node "$LISTING_JS" "$R" "$commit"
  local parity=0; grep -q '"sopsListed":true' "$S/listing.json" && parity=1
  git -C "$R" checkout -q --detach "$bench"
  printf 'COMMIT=%s\nBENCH_SHA=%s\nFROZEN_AT=%s\nSOP_PARITY=%s\nPACK_REV=%s\nKONDUCTOR_REF=%s\nBUILD_LABEL=%q\n' "$commit" "$bench" "$(date -u +%FT%TZ)" "$parity" "$(pack_rev)" "${KONDUCTOR_REF:-origin/main}" "${BUILD_LABEL:-}" >"$S/freeze.env"
  [ "$parity" = 1 ] || say "SOPs are user-only on Claude Code at this commit: the sop-class tasks are reported apart, as not comparable"
  say "frozen: konductor COMMIT=$commit (${KONDUCTOR_REF:-origin/main}${BUILD_LABEL:+, $BUILD_LABEL}), bench BENCH_SHA=$bench, in $S/freeze.env"
}

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

ours() { tr '\0' '\n' 2>/dev/null <"/proc/$1/environ" | grep -q "^TMPDIR=$S/"; }
quiet() {
  local p busy=""
  for p in $(pgrep -f 'bench/runner/bench[.]js|node --test|pytest|unittest|cargo (build|test)|kiro-cli chat --no-interactive|claude -p|opencode run' || true); do
    [ "$p" = "$$" ] && continue
    ours "$p" && continue
    [ -r "/proc/$p/cmdline" ] || continue   # the process ended meanwhile
    busy="$busy $( (tr '\0' ' ' <"/proc/$p/cmdline") 2>/dev/null | cut -c1-80 || true);"
  done
  [ -z "$busy" ] || die "other heavy jobs run on this host:$busy"
  awk -v n="$(nproc)" '{ exit !($1 < n / 2) }' /proc/loadavg || die "load $(cut -d' ' -f1 /proc/loadavg) is half of $(nproc) cores or more"
  [ "$(awk '/MemAvailable/ { print int($2 / 1048576) }' /proc/meminfo)" -ge 8 ] || die "less than 8 GB of memory free"
  [ "$(df -Pk /var/tmp | awk 'NR == 2 { print int($4 / 1048576) }')" -ge 15 ] || die "less than 15 GB free under /var/tmp"
  unshare -Urm true 2>/dev/null || die "user namespaces are blocked in this shell; run from your own terminal, never with --isolate none"
  [ "$(findmnt -R -n -o TARGET /tmp | wc -l)" -le 1 ] || die "writable submounts under /tmp: $(findmnt -R -n -o TARGET /tmp | tail -n +2 | tr '\n' ' ')"
  case "$TMPDIR" in *[Bb][Ee][Nn][Cc][Hh]*) die "TMPDIR $TMPDIR contains the word bench" ;; "$R"/*) die "TMPDIR is inside the checkout" ;; esac
  # Claude Code loads every .claude/skills above a run cwd as project skills; bench refuses a TMPDIR under HOME, and the kit keeps it under /var/tmp.
  case "$TMPDIR" in /var/tmp/*) ;; *) die "TMPDIR $TMPDIR must be under /var/tmp, so no .claude/skills of the owner sits above a run" ;; esac
  mkdir -p "$TMPDIR"
  say "host quiet: load $(cut -d' ' -f1 /proc/loadavg) on $(nproc) cores, sandbox works, TMPDIR $TMPDIR"
}

take_lock() { # shared: the kit's Kiro and Claude Code stages may run side by side; everyone else takes it exclusive
  (umask 000; : >>"$LOCK"; : >>"$LOCK.who")
  exec 9>>"$LOCK"
  flock -s -n 9 || die "host busy: a heavy job holds $LOCK ($(tail -n 2 "$LOCK.who" | tr '\n' ' '))"
  printf '%s pid %s konductor-2x2 %s\n' "$(date -u +%FT%TZ)" "$$" "$*" >>"$LOCK.who"
}

# ---- logins, Bedrock, judges, preconditions
cred_minutes() {
  aws configure export-credentials --profile "$AWSP" --format process 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const e = JSON.parse(s).Expiration; console.log(e ? Math.floor((Date.parse(e) - Date.now()) / 60000) : 9999); } catch { console.log(-1); }
    });'
}
fresh_creds() {
  local m; m=$(cred_minutes)
  if [ "$m" -lt "$CRED_MIN_MINUTES" ]; then
    if [ -n "${REFRESH_CMD:-}" ]; then bash -c "$REFRESH_CMD"; else say "AWS credentials of $AWSP last $m more minutes. Refresh them now, then press Enter"; read -r _; fi
    m=$(cred_minutes)
    [ "$m" -ge "$CRED_MIN_MINUTES" ] || die "AWS credentials of $AWSP still last only $m minutes"
  fi
  say "AWS credentials last $m more minutes"
}
kiro_login() { "$KBIN" whoami >/dev/null 2>&1 || die "Kiro login expired: run $KBIN login, then rerun the same command"; }

bedrock() {
  need_awsp
  aws sts get-caller-identity --profile "$AWSP" --query Arn --output text >/dev/null || die "profile $AWSP has no working credentials"
  local p arns m ids="deepseek.v3.2 zai.glm-5"
  for p in us.anthropic.claude-sonnet-5-5 global.openai.gpt-5.6-luna; do
    arns=$(aws bedrock get-inference-profile --profile "$AWSP" --region "$REGION" --inference-profile-identifier "$p" --query 'models[].modelArn' --output text) || die "inference profile $p not found or not allowed"
    say "$p routes to: $arns"
    ids="$ids $(printf '%s\n' "$arns" | tr '\t' '\n' | sed 's#.*foundation-model/##' | sort -u | tr '\n' ' ')"
  done
  for m in $(printf '%s\n' $ids | sort -u); do
    say "$m: $(aws bedrock get-foundation-model-availability --profile "$AWSP" --region "$REGION" --model-id "$m" \
      --query '[agreementAvailability.status,authorizationStatus,entitlementAvailability,regionAvailability]' --output text 2>&1 | head -1)"
  done
  say "read the lines above: each model must show AVAILABLE and AUTHORIZED; anything else stops the study"
}

pack_rev() { node -e 'const p = require(process.argv[1]).loadPack("quality"); console.log(`${p.revision}/${p.criteria.length}`)' "$R/bench/judge/pack/load.js"; }
pack_same() { # every stage is judged with the quality pack frozen at freeze (2026-11-18: 116 checks in 13 phases)
  [ "$(pack_rev)" = "${PACK_REV:?freeze again: this freeze.env predates the pack pin}" ] || die "quality pack is $(pack_rev), not the frozen $PACK_REV"
}
families() {
  node -e '
    const { judgeSeats } = require(process.argv[1]);
    for (const subject of ["claude-sonnet-5.5", "us.anthropic.claude-sonnet-5-5"]) {
      const r = judgeSeats({ subjectModel: subject, judges: process.argv[2].split(",") });
      const seated = r.seats.filter((s) => s.seated).map((s) => `${s.model}=${s.family}`);
      if (!r.judged || seated.length !== 3) { console.error(`${subject}: ${r.why || "only " + seated.join(", ")}`); process.exit(1); }
      console.log(`[2x2] judges for ${subject} (family ${r.subject.family}): ${seated.join(", ")}`);
    }' "$R/bench/judge/family.js" "$PANEL" || die "the judge panel does not seat three non-Claude families"
}

preconditions() {
  local eff
  eff=$(node -e 'const { DESCRIPTORS } = require(process.argv[1]); const d = Object.values(DESCRIPTORS).find((x) => x.armPrefix === "cc-"); console.log(d.supports.effort === true && !("effort" in d.flags.refused))' "$R/bench/runner/lib/harness/descriptors.js")
  [ "$eff" = true ] || die "precondition 1 not met: bench does not pass --effort to Claude Code (needs 6c522264)"
  node -e 'const s = require(process.argv[1]); process.exit(s.MIN_JUDGES === 3 && s.panelScore([0.9, 0.3, 0.4]) === 0.4 && s.panelScore([0.6, 1]) === null ? 0 : 1)' \
    "$R/bench/judge/score.js" 2>/dev/null || die "precondition 2 not met: a run's score is not the median of three judges (needs 223bcaa9)"
  [ -f "$R/bench/runner/lib/startup.js" ] || die "precondition 3 not met: bench does not write startup.json per run (needs 26eb86e4)"
  say "preconditions met: Claude Code --effort passed (default high), median of three judges with NO DATA under three"
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
spent_in() { # spent_in KIND DIR...: the sum over several dirs
  local kind=$1 d t=0; shift
  for d in "$@"; do t=$(awk -v a="$t" -v b="$(spent "$d" "$kind")" 'BEGIN { print a + b }'); done
  echo "$t"
}
stage_dirs() { # stage_dirs 1|2 kiro|cc: the dirs a stage's cap is counted over
  if [ "$1" = 1 ]; then echo "$S/dev/$2"; else echo "$S/held/$2 $S/held-sop/$2"; fi
}
left() { awk -v c="$1" -v s="$2" 'BEGIN { printf "%.2f", c - s }'; }
enough() { awk -v l="$1" -v m="$2" 'BEGIN { exit !(l >= m) }'; }

# ---- runs
# A rerun of any stage is safe: once a harness dir has a run-config, every batch passes --resume, so finished cells are
# kept and only cells with no result.json run again. RESUME_ERRORS=1 also reruns errored cells (read their stderr first).
resume_of() { [ -f "$1/run-config.json" ] && printf -- '--resume%s' "${RESUME_ERRORS:+ --resume-errors}"; return 0; }
kiro_batch() { # TASKS OFFSET CAP
  local l; l=$(left "$3" "$(spent_in credits $(stage_dirs "$STAGE" kiro))")
  enough "$l" 5 || die "Kiro cap of $3 credits reached ($l left)"
  kiro_login
  say "kiro: $1, replicate $(($2 + 1)), budget $l credits"
  # shellcheck disable=SC2046
  nice -n 10 node "$BJ" run "${COMMON[@]}" "${KIRO[@]}" --out "$KD" --tasks "$1" --replicate-offset "$2" --replicates 1 --budget-credits "$l" $(resume_of "$KD")
}
cc_batch() { # TASKS OFFSET CAP
  local l; l=$(left "$3" "$(spent_in usd $(stage_dirs "$STAGE" cc))")
  enough "$l" 1 || die "Claude Code cap of \$$3 reached (\$$l left)"
  fresh_creds
  say "claude code: $1, replicate $(($2 + 1)), budget \$$l"
  # shellcheck disable=SC2046
  nice -n 10 node "$BJ" run "${COMMON[@]}" "${CC[@]}" --out "$CD" --tasks "$1" --replicate-offset "$2" --replicates 1 --budget-usd "$l" $(resume_of "$CD")
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

label_reports() { # every report dir carries the build label and the konductor commit (the freeze record holds them too)
  local d
  for d in "$S"/report-*; do [ -d "$d" ] && printf '%s\nkonductor commit %s (ref %s)\n' "${BUILD_LABEL:-konductor $COMMIT}" "$COMMIT" "${KONDUCTOR_REF:-origin/main}" >"$d/BUILD.txt"; done
  say "build: ${BUILD_LABEL:-konductor $COMMIT}, commit $COMMIT"
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

split_check() { # free: recompute the SR-32 split from the task ids and refuse if the lists were edited
  node -e '
    const c = require("crypto"), [salt, dev, held] = process.argv.slice(1);
    const want = (id) => (parseInt(c.createHash("sha256").update(salt + id).digest("hex").slice(0, 8), 16) % 3 === 0 ? "DEV" : "HELD-OUT");
    const bad = [...dev.split(/[ ,]+/).filter(Boolean).map((id) => [id, "DEV"]), ...held.split(/[ ,]+/).filter(Boolean).map((id) => [id, "HELD-OUT"])].filter(([id, set]) => want(id) !== set);
    const all = (dev + "," + held).split(/[ ,]+/).filter(Boolean);
    if (bad.length || new Set(all).size !== all.length) { console.error("split edited: " + bad.map(([id, s]) => `${id} listed ${s}`).join(", ")); process.exit(1); }
    console.log(`[2x2] split ok: ${dev.split(/[ ,]+/).filter(Boolean).length} DEV, ${held.split(/[ ,]+/).filter(Boolean).length} HELD-OUT, by the recorded hash rule`);' \
    "$SPLIT_SALT" "${DEV[*]} ${DEV_NEW[*]}" "${HELD[*]} ${HELD_SOP[*]} ${HELD_NEW[*]}" || die "the DEV / HELD-OUT lists do not match the SR-32 hash rule"
}

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
