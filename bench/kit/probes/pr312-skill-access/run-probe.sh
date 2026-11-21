#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# run-probe.sh: PR312 functional probe. Kiro CLI 3.5.0, default agent konductor (orchestration: auto, the default), on a
# local konductor build that contains PR #312 (BUILD_REF). 12 short prompts, each needing ONE skill that was unreachable before PR #312, none naming
# it. One run per prompt, one arm. PAID (Kiro credits only): soft cap 40 credits (a warning), ceiling 60 (bench stops starting runs).
# Run it from your own terminal, never from an agent shell. Label of the result: "PR312 functional probe".
# Needs: S (the probe work dir), R (the konductor repo that holds BUILD_REF, with bench checked out), KIT_SRC or the repo layout
# (the 2x2 kit is read from ../../2x2), and the pinned kiro-cli of the 2x2 kit under SHARED or S (see bench/docs/repeat.md).
#   bash run-probe.sh --dry-run      prints the checks and the bench command, starts nothing
#   bash run-probe.sh                runs the probe, then prints the table
#   bash run-probe.sh --table        only prints the table of a finished probe (read only, free)
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export S=${S:?set S to the probe work dir}
export R=${R:?set R to the konductor repo that holds BUILD_REF}
export PY312_BIN=${PY312_BIN:-$S/pybin}
export KIT_SRC=${KIT_SRC:-$HERE/../../2x2}
BUILD_REF=${BUILD_REF:?set BUILD_REF to the konductor ref to test (it must contain PR #312, head fc452e64)}
SOFT_CR=40 CEIL_CR=60
MODE=${1:-run}
OUT=$S/kiro
# the kit's helpers (pins, quiet, take_lock, kiro_login, spent, soft_warn), not its command switch
# shellcheck disable=SC1090
source "$KIT_SRC/run-2x2-kiro.sh"   # the kit returns before its command switch when sourced
set -euo pipefail

if [ "$MODE" = --table ]; then python3 "$HERE/table.py" --run "$OUT"; exit 0; fi
COMMIT=$(git -C "$R" rev-parse "$BUILD_REF^{commit}") || die "build ref $BUILD_REF not found in $R"
TASKS=$(ls "$HERE"/tasks/pr312-probe-*.json | xargs -n1 basename | sed 's/\.json$//' | paste -sd, -)
[ "$(printf '%s\n' "$TASKS" | tr ',' '\n' | wc -l)" = 12 ] || die "expected 12 probe tasks in $HERE/tasks"
python3 --version 2>&1 | grep -q '^Python 3\.12\.' || die "python3 is not 3.12 on PATH (PY312_BIN=$PY312_BIN): make $S/pybin first, see bench/docs/repeat.md"
say "PR312 functional probe: konductor commit $COMMIT ($BUILD_REF), 12 prompts, soft cap $SOFT_CR credits, ceiling $CEIL_CR"
git -C "$R" merge-base --is-ancestor fc452e64 "$COMMIT" || die "the build does not contain the PR #312 head fc452e64"
CMD=(node "$BJ" run --suite rootcause --seed "$SEED" --parallel 1 --repo-root "$R" --cache "$SHARED/cache" --cargo-target "$SHARED/cargo-target"
  --extra-tasks "$R/bench/sdlc,$HERE/tasks" --hide "$R" --isolate unshare --effort "$EFFORT" --timeout-sec "$TIMEOUT_SEC"
  --arms "konductor=$COMMIT" --model claude-sonnet-5.5 --agent-engine v3 --kiro-bin "$KBIN"
  --out "$OUT" --tasks "$TASKS" --replicates 1 --budget-credits "$CEIL_CR")
if [ "$MODE" = --dry-run ]; then
  say "dry run: checks skipped (pins, quiet host, Kiro login, credentials); the command would be:"
  printf '%q ' "${CMD[@]}"; echo
  exit 0
fi
pins; quiet                                # the load gate: no other heavy job, load under half the cores, memory and disk free
kiro_login                                 # the Kiro login must be fresh
if [ -n "${AWSP:-}" ]; then fresh_creds; fi   # optional: also checks that the credentials of the profile $AWSP last 60 minutes (the run itself uses Kiro only)
[ ! -e "$OUT" ] || die "$OUT exists: move it aside, or run: bash $0 --table"
mkdir -p "$S"; printf 'PR312 functional probe\nkonductor commit %s (ref %s)\nstarted %s\n' "$COMMIT" "$BUILD_REF" "$(date -u +%FT%TZ)" >"$S/LABEL.txt"
take_lock "pr312 probe"
nice -n 10 "${CMD[@]}"
spent_now=$(spent "$OUT" credits)
say "spent $spent_now credits of the soft cap $SOFT_CR"
soft_warn credits "$spent_now" "$SOFT_CR"
python3 "$HERE/table.py" --run "$OUT" | tee "$S/probe-table.md"
say "table saved to $S/probe-table.md; label: PR312 functional probe, commit $COMMIT"
