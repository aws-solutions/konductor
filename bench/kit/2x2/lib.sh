#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# The helpers both 2x2 kits share (DEBT D-46). Sourced by run-2x2.sh and run-2x2-kiro.sh after their study constants
# (R, S, KBIN, PANEL, the caps and the task lists); each kit keeps its own sets, stage, judging, report and gate.
# shellcheck disable=SC2154  # the constants are set by the kit that sources this file
say() { printf '[2x2] %s\n' "$*"; }
die() { printf '[2x2] STOP: %s\n' "$*" >&2; exit 2; }
need_awsp() { [ -n "$AWSP" ] || die "set AWSP to your least-privilege Bedrock profile"; }
need_r() { # R is the konductor worktree the kit builds from and checks out; the kit must not live inside it (freeze replaces its files)
  { [ -d "$R/.git" ] || [ -f "$R/.git" ]; } || die "set R to a dedicated konductor git worktree (not your own checkout)"
  case "$KIT_SRC/" in "$(cd "$R" && pwd -P)"/*) die "run the kit from a copy outside $R: freeze checks out another commit there and would replace this script" ;; esac
}

# study_env FILE NAME...: read the study constants from FILE (plain NAME=value lines) and refuse when one is unset or empty
study_env() {
  local f=$1 v; shift
  [ -f "$f" ] || die "no study file $f"
  # shellcheck disable=SC1090
  . "$f"
  for v in "$@"; do [ -n "${!v:-}" ] || die "$v is not set in $f"; done
}

# ---- pins, freeze, host
pins() {
  [ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "$KBIN_SHA" ] || die "kiro-cli copy at $KBIN does not match its pinned sha256"
  [ "$(sha256sum "$CBIN" | cut -d' ' -f1)" = "$CBIN_SHA" ] || die "claude copy at $CBIN does not match its pinned sha256"
  "$KBIN" --version | grep -qxF "kiro-cli $KIRO_VERSION" || die "kiro-cli copy is not $KIRO_VERSION"
  [[ "$("$CBIN" --version)" == "${CC_VERSION%.*} "* ]] || die "claude copy is not ${CC_VERSION%.*}"
  "$CBIN" --help | grep -q -- '--effort' || die "claude copy has no --effort flag"
  say "pins ok: kiro-cli $KIRO_VERSION, claude $CC_VERSION with --effort (bench validated on $(validated))"
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
spent_in() { # spent_in KIND DIR...: the sum over several dirs
  local kind=$1 d t=0; shift
  for d in "$@"; do t=$(awk -v a="$t" -v b="$(spent "$d" "$kind")" 'BEGIN { print a + b }'); done
  echo "$t"
}
left() { awk -v c="$1" -v s="$2" 'BEGIN { printf "%.2f", c - s }'; }
enough() { awk -v l="$1" -v m="$2" 'BEGIN { exit !(l >= m) }'; }

# ---- runs
resume_of() { [ -f "$1/run-config.json" ] && printf -- '--resume%s' "${RESUME_ERRORS:+ --resume-errors}"; return 0; }
cc_batch() { # TASKS OFFSET CAP
  local l; l=$(left "$3" "$(spent_in usd $(stage_dirs "$STAGE" cc))")
  enough "$l" 1 || die "Claude Code cap of \$$3 reached (\$$l left)"
  fresh_creds
  say "claude code: $1, replicate $(($2 + 1)), budget \$$l"
  # shellcheck disable=SC2046
  nice -n 10 node "$BJ" run "${COMMON[@]}" "${CC[@]}" --out "$CD" --tasks "$1" --replicate-offset "$2" --replicates 1 --budget-usd "$l" $(resume_of "$CD")
}

# ---- judging and reports (the median of three judges is bench's scoring since 223bcaa9; never pass --allow-small-panel)
label_reports() { # every report dir carries the build label and the konductor commit (the freeze record holds them too)
  local d
  for d in "$S"/report-*; do [ -d "$d" ] && printf '%s\nkonductor commit %s (ref %s)\n' "${BUILD_LABEL:-konductor $COMMIT}" "$COMMIT" "${KONDUCTOR_REF:-origin/main}" >"$d/BUILD.txt"; done
  say "build: ${BUILD_LABEL:-konductor $COMMIT}, commit $COMMIT"
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
