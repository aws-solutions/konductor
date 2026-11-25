#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# prep.sh: free. Builds and trial-installs every arm of a rootcause run with --prepare-only (no model call, no spend), for
# Kiro and for Claude Code, so a refused arm or a missing tool shows before a paid stage. The kit's `prepare` does the same
# for a frozen study; this script is the stand-alone version for a konductor commit that is not frozen yet.
#   R=WORKTREE SHA=KONDUCTOR_COMMIT B=DIR bash prep.sh
# Needs: R (a konductor worktree with bench), SHA (the konductor commit to build), B (a work dir that holds bin/kiro-cli-3.5.0,
# bin/claude-code/<version>, and receives cache/, cargo-target/ and prep-*). Optional: T (comma list of task ids),
# CLAUDE_VERSION (default 2.1.327.1766), KIRO_VERSION (default 3.5.0).
set -euo pipefail
R=${R:?set R to a konductor worktree}
SHA=${SHA:?set SHA to the konductor commit to build}
B=${B:?set B to a work dir}
T=${T:-hard-seat-holds,hard-export-formats,hard-catalog-limits,orch-search-hardening,hard-batch-flaky,sop-test-coverage-review,review-inventory-security,design-hold-service,rc-dynamodb-design,rc-req-to-design,req-vague-request,plan-multipart-feature,rc-threat-model,rc-agents-md}
KIRO_VERSION=${KIRO_VERSION:-3.5.0}
CLAUDE_VERSION=${CLAUDE_VERSION:-2.1.327.1766}
cd "$R" || exit 2
export TMPDIR=$B/tmp; mkdir -p "$TMPDIR"
COMMON=(--suite rootcause --tasks "$T" --seed 20261118 --replicates 3 --parallel 1 --repo-root "$R" --cache "$B/cache" --cargo-target "$B/cargo-target" --isolate none --allow-unisolated --prepare-only)
# Both prepares run even when the first fails, so one pass shows every refused arm; the exit is 1 when either failed.
kiro_rc=0 cc_rc=0
echo "== kiro prepare $(date -Is)"
node bench/runner/bench.js run "${COMMON[@]}" --arms "vanilla,konductor=$SHA" --model claude-sonnet-5.5 --agent-engine v3 \
  --kiro-bin "$B/bin/kiro-cli-$KIRO_VERSION/kiro-cli" --out "$B/prep-kiro" || kiro_rc=$?
echo "kiro exit $kiro_rc"
echo "== cc prepare $(date -Is)"
node bench/runner/bench.js run "${COMMON[@]}" --arms "cc-vanilla,cc-konductor=$SHA" --model us.anthropic.claude-sonnet-5-5 \
  --claude-bin "$B/bin/claude-code/$CLAUDE_VERSION/claude" --budget-usd 1 --out "$B/prep-cc" || cc_rc=$?
echo "cc exit $cc_rc"
echo "== done $(date -Is)"
[ "$kiro_rc" = 0 ] && [ "$cc_rc" = 0 ] || exit 1
