#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-cwd-injection.sh — Regression test for the OS command injection
# (CWE-78) fixed in cmux-dispatch.sh's CMD_PREFIX construction.
#
# Background: `--cwd` is an externally-settable CLI argument. Prior to the
# fix, it was interpolated into a single-quoted shell string with no
# escaping (`CMD_PREFIX="cd '$CWD' && "`). A --cwd value containing a single
# quote could break out of the quote context and inject arbitrary shell
# commands into the string that later gets typed into a live cmux pane and
# executed by a real shell (`cmux send ... -- "$PANE_CMD"`).
#
# This test does not require a real cmux binary or kiro-cli/claude install.
# It stubs both out, runs cmux-dispatch.sh end-to-end, captures the exact
# PANE_CMD string the script would have sent to the pane, and then executes
# that string in a real bash subshell — exactly what happens once cmux types
# it into the target pane — to prove a malicious --cwd can no longer cause
# an unintended command to run.
#
# Usage: bash test-cwd-injection.sh
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

# --- Sandbox setup -----------------------------------------------------
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"

CAPTURE_FILE="$WORKDIR/captured_pane_cmd.txt"

# Mock `cmux`: implements just enough of the subcommand surface that
# cmux-dispatch.sh exercises in --split mode (the default), and records the
# exact PANE_CMD argument passed to `cmux send ... -- "$PANE_CMD"`.
# The capture file path is baked in directly (unquoted heredoc) so the mock
# does not depend on any env var surviving into its own process.
cat > "$MOCK_BIN/cmux" <<MOCKEOF
#!/usr/bin/env bash
case "\$1" in
  new-split)
    echo "surface:1"
    ;;
  rpc)
    exit 0
    ;;
  read-screen)
    # Non-empty output so wait_for_shell returns immediately instead of
    # polling for up to 10 seconds.
    echo "ready"
    ;;
  send)
    # \${!#} expands to the last positional parameter -- the PANE_CMD string.
    printf '%s' "\${!#}" > "${CAPTURE_FILE}"
    ;;
  send-key)
    exit 0
    ;;
  *)
    echo "MOCK cmux: unhandled subcommand: \$1" >&2
    exit 1
    ;;
esac
MOCKEOF
chmod +x "$MOCK_BIN/cmux"

# Mock `kiro-cli`: records the working directory it was invoked from, then
# exits cleanly. This lets us confirm --cwd still takes effect for benign
# values after the fix, without needing a real kiro-cli install.
CWD_RECORD_FILE="$WORKDIR/kiro_cwd.txt"
cat > "$MOCK_BIN/kiro-cli" <<MOCKEOF
#!/usr/bin/env bash
pwd > "${CWD_RECORD_FILE}"
exit 0
MOCKEOF
chmod +x "$MOCK_BIN/kiro-cli"

export PATH="$MOCK_BIN:$PATH"
export CMUX_BIN="$MOCK_BIN/cmux"
unset CLAUDECODE  # force the kiro-cli branch (no local agent file lookup needed)

run_dispatch() {
  local cwd_arg="$1"
  rm -f "$CAPTURE_FILE"
  bash "$DISPATCH_SCRIPT" \
    --agent test-agent \
    --task "test task" \
    --cwd "$cwd_arg" \
    --split right \
    >"$WORKDIR/dispatch.out" 2>"$WORKDIR/dispatch.err"
}

# --- Test 1: malicious --cwd must not execute injected commands --------
MARKER="$WORKDIR/pwned-marker"
rm -f "$MARKER"
MALICIOUS_CWD="/tmp/foo'; touch ${MARKER}; echo '"

run_dispatch "$MALICIOUS_CWD"

if [[ ! -f "$CAPTURE_FILE" ]]; then
  log_fail "no PANE_CMD was captured from the mock cmux (dispatch script did not reach 'cmux send')"
  cat "$WORKDIR/dispatch.err" >&2
else
  PANE_CMD="$(cat "$CAPTURE_FILE")"

  # This is the moment of truth: execute the captured PANE_CMD exactly as a
  # real cmux pane would, by typing it into a live shell.
  bash -c "$PANE_CMD" >"$WORKDIR/pane_run.out" 2>"$WORKDIR/pane_run.err" || true

  if [[ -f "$MARKER" ]]; then
    log_fail "CWE-78 regression: injected command executed and created $MARKER"
  else
    log_pass "malicious --cwd did not execute the injected 'touch' command"
  fi
fi

# --- Test 2: benign --cwd still changes directory correctly ------------
BENIGN_DIR="$WORKDIR/some target"   # embedded space, exercises %q escaping
mkdir -p "$BENIGN_DIR"
rm -f "$CWD_RECORD_FILE"

run_dispatch "$BENIGN_DIR"

if [[ ! -f "$CAPTURE_FILE" ]]; then
  log_fail "no PANE_CMD was captured from the mock cmux for the benign-cwd case"
  cat "$WORKDIR/dispatch.err" >&2
else
  PANE_CMD="$(cat "$CAPTURE_FILE")"
  bash -c "$PANE_CMD" >"$WORKDIR/pane_run2.out" 2>"$WORKDIR/pane_run2.err" || true

  if [[ -f "$CWD_RECORD_FILE" ]]; then
    RECORDED_CWD="$(cat "$CWD_RECORD_FILE")"
    # Resolve BENIGN_DIR the same way `pwd` would (in case /tmp is a symlink,
    # e.g. macOS /tmp -> /private/tmp).
    RESOLVED_BENIGN_DIR="$(cd "$BENIGN_DIR" && pwd)"
    if [[ "$RECORDED_CWD" == "$RESOLVED_BENIGN_DIR" ]]; then
      log_pass "benign --cwd (containing a space) still changes directory correctly"
    else
      log_fail "benign --cwd did not resolve to the expected directory (expected '$RESOLVED_BENIGN_DIR', got '$RECORDED_CWD')"
    fi
  else
    log_fail "kiro-cli mock never ran for the benign-cwd case (cd likely failed) — see pane_run2.err"
    cat "$WORKDIR/pane_run2.err" >&2
  fi
fi

# --- Summary -------------------------------------------------------------
echo
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
