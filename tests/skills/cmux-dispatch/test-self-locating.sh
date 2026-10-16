#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-self-locating.sh — Regression test: cmux-dispatch.sh resolves its own
# real directory (BASH_SOURCE[0], symlink-safe) before doing anything else,
# so once given its correct absolute path (as cmux-dispatch/SKILL.md's
# resolution order now produces) it works from ANY caller cwd -- including
# through a symlink -- and warns, rather than silently misbehaving, if its
# sibling cmux-completion-hook.sh is missing from a broken install.
#
# Usage: bash test-self-locating.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

set -u

# Lives at tests/skills/cmux-dispatch/ -- three levels up is the package
# root, where skills/cmux-dispatch/ holds the script under test.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
DISPATCH_SCRIPT="${PKG_ROOT}/skills/cmux-dispatch/cmux-dispatch.sh"

PASS=0
FAIL=0

log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

[[ -f "$DISPATCH_SCRIPT" ]] || { echo "ERROR: cannot find cmux-dispatch.sh at $DISPATCH_SCRIPT" >&2; exit 1; }

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

UNRELATED_CWD="$WORKDIR/unrelated-cwd"
mkdir -p "$UNRELATED_CWD"

# --- Assertion 1: invoked by absolute path from an unrelated cwd, with the
# real cmux-completion-hook.sh present next to it -- no WARNING, and the
# script's own "--agent required" error proves it ran (not a path failure).
OUTPUT="$(cd "$UNRELATED_CWD" && bash "$DISPATCH_SCRIPT" --task "do it" 2>&1)"
RC=$?
if [[ "$RC" -eq 1 && "$OUTPUT" == *"ERROR: --agent required"* && "$OUTPUT" != *"WARNING: cmux-completion-hook.sh not found"* ]]; then
  log_pass "Real install (completion hook present): runs cleanly from an unrelated cwd, no false warning"
else
  log_fail "Real install: expected --agent error with no WARNING, got (rc=$RC): $OUTPUT"
fi

# --- Assertion 2: same, invoked through a symlink living in a third,
# unrelated directory -- exercises the BASH_SOURCE symlink-resolution loop.
SYMLINK_DIR="$WORKDIR/symlink-holder"
mkdir -p "$SYMLINK_DIR"
ln -s "$DISPATCH_SCRIPT" "$SYMLINK_DIR/cmux-dispatch.sh"
OUTPUT="$(cd "$UNRELATED_CWD" && bash "$SYMLINK_DIR/cmux-dispatch.sh" --task "do it" 2>&1)"
RC=$?
if [[ "$RC" -eq 1 && "$OUTPUT" == *"ERROR: --agent required"* && "$OUTPUT" != *"WARNING: cmux-completion-hook.sh not found"* ]]; then
  log_pass "Invoked through a symlink: still resolves its real sibling directory, no false warning"
else
  log_fail "Via symlink: expected --agent error with no WARNING, got (rc=$RC): $OUTPUT"
fi

# --- Assertion 3: a broken install missing cmux-completion-hook.sh next to
# the script -- the sanity check must warn rather than fail silently.
BROKEN_INSTALL="$WORKDIR/broken-install"
mkdir -p "$BROKEN_INSTALL"
cp "$DISPATCH_SCRIPT" "$BROKEN_INSTALL/cmux-dispatch.sh"
# Deliberately omit cmux-completion-hook.sh from this copy.
OUTPUT="$(cd "$UNRELATED_CWD" && bash "$BROKEN_INSTALL/cmux-dispatch.sh" --task "do it" 2>&1)"
RC=$?
if [[ "$OUTPUT" == *"WARNING: cmux-completion-hook.sh not found next to"* ]]; then
  log_pass "Broken install (completion hook missing): warns instead of failing silently"
else
  log_fail "Broken install: expected a WARNING about the missing completion hook, got (rc=$RC): $OUTPUT"
fi

echo
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
