#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-dispatch-sh-cwd-independence.sh — Regression test: dispatch.sh, once
# given its correct absolute path (as mux-dispatch/SKILL.md's resolution
# order now produces), locates its sibling tmux-dispatch.sh / zellij-
# dispatch.sh and runs correctly from ANY caller cwd -- including through a
# symlink. This is the "once invoked by absolute path they work anywhere"
# half of the fix: a plugin install's cwd has no `skills/` directory under
# it, so the model must invoke dispatch.sh by an absolute path, and
# dispatch.sh must still find its siblings from there.
#
# Each assertion runs dispatch.sh from an unrelated tmp cwd and inspects
# stderr/exit code to tell "the real sibling script ran" (it emits its own,
# distinct ERROR message for a missing required flag) apart from "dispatch.sh
# failed to find its sibling" (a generic "No such file or directory").
#
# Usage: bash test-dispatch-sh-cwd-independence.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

set -u

# Lives at tests/skills/mux-dispatch/ -- three levels up is the package
# root, where skills/mux-dispatch/ holds the script under test.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
DISPATCH_SCRIPT="${PKG_ROOT}/skills/mux-dispatch/dispatch.sh"

PASS=0
FAIL=0

log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

[[ -f "$DISPATCH_SCRIPT" ]] || { echo "ERROR: cannot find dispatch.sh at $DISPATCH_SCRIPT" >&2; exit 1; }

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

UNRELATED_CWD="$WORKDIR/unrelated-cwd"
mkdir -p "$UNRELATED_CWD"

# --- Assertion 1: TMUX set, invoked by absolute path from an unrelated cwd,
# missing a required flag (--cwd) -- the ERROR text must come from the REAL
# tmux-dispatch.sh (proving dispatch.sh found and exec'd it), not a shell
# "No such file or directory" (proving self-location failed). ---
OUTPUT="$(cd "$UNRELATED_CWD" && TMUX=dummy ZELLIJ='' bash "$DISPATCH_SCRIPT" --agent k-developer --task "do it" 2>&1)"
RC=$?
if [[ "$RC" -eq 1 && "$OUTPUT" == *"ERROR: --cwd required"* ]]; then
  log_pass "TMUX set: dispatch.sh reaches the real tmux-dispatch.sh from an unrelated cwd"
else
  log_fail "TMUX set: expected tmux-dispatch.sh's own ERROR, got (rc=$RC): $OUTPUT"
fi

# --- Assertion 2: same as above, but dispatch.sh invoked through a symlink
# that lives in a third, unrelated directory -- exercises the BASH_SOURCE
# symlink-resolution loop, not just the plain-file case. ---
SYMLINK_DIR="$WORKDIR/symlink-holder"
mkdir -p "$SYMLINK_DIR"
ln -s "$DISPATCH_SCRIPT" "$SYMLINK_DIR/dispatch.sh"
OUTPUT="$(cd "$UNRELATED_CWD" && TMUX=dummy ZELLIJ='' bash "$SYMLINK_DIR/dispatch.sh" --agent k-developer --task "do it" 2>&1)"
RC=$?
if [[ "$RC" -eq 1 && "$OUTPUT" == *"ERROR: --cwd required"* ]]; then
  log_pass "TMUX set: dispatch.sh invoked through a symlink still reaches the real tmux-dispatch.sh"
else
  log_fail "TMUX set via symlink: expected tmux-dispatch.sh's own ERROR, got (rc=$RC): $OUTPUT"
fi

# --- Assertion 3: ZELLIJ set instead of TMUX -- routes to zellij-dispatch.sh,
# whose own required-flag error text differs from tmux-dispatch.sh's, so a
# match here additionally proves the correct backend was selected. ---
OUTPUT="$(cd "$UNRELATED_CWD" && TMUX='' ZELLIJ=dummy bash "$DISPATCH_SCRIPT" --agent k-developer --task "do it" 2>&1)"
RC=$?
if [[ "$RC" -eq 1 && "$OUTPUT" == *"--cwd required"* ]]; then
  log_pass "ZELLIJ set: dispatch.sh reaches the real zellij-dispatch.sh from an unrelated cwd"
else
  log_fail "ZELLIJ set: expected zellij-dispatch.sh's own ERROR, got (rc=$RC): $OUTPUT"
fi

# --- Assertion 4: neither TMUX nor ZELLIJ set -- dispatch.sh's own error,
# not a sibling script's, and not a "file not found". ---
OUTPUT="$(cd "$UNRELATED_CWD" && TMUX='' ZELLIJ='' bash "$DISPATCH_SCRIPT" --agent k-developer --task "do it" --cwd "$UNRELATED_CWD" 2>&1)"
RC=$?
if [[ "$RC" -eq 1 && "$OUTPUT" == *"No multiplexer detected"* ]]; then
  log_pass "Neither TMUX nor ZELLIJ set: dispatch.sh reports its own clear error"
else
  log_fail "Neither set: expected dispatch.sh's own 'No multiplexer detected' error, got (rc=$RC): $OUTPUT"
fi

echo
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
