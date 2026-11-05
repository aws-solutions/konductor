#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-permission-mode.sh: how cmux-dispatch.sh launches a Claude Code child
# for each KONDUCTOR_DISPATCH_PERMISSION_MODE value, that an unknown value is
# refused before any surface opens, that a task starting with '-' still
# reaches claude as the prompt, that the child sees KONDUCTOR_DONE_FILE, and
# that the Kiro CLI branch ignores the mode.
#
# Usage: bash test-permission-mode.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
DISPATCH="${PKG_ROOT}/skills/cmux-dispatch/cmux-dispatch.sh"

PASS=0
FAIL=0
log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"
PANE_CMD_FILE="$WORKDIR/pane-cmd.txt"
SURFACE_OPENED="$WORKDIR/surface-opened"
# The claude and kiro-cli mocks write one argument per line, then the
# KONDUCTOR_DONE_FILE they saw.
ARGS_RECORD="$WORKDIR/args.txt"
DONE_RECORD="$WORKDIR/done-file.txt"

cat > "$MOCK_BIN/cmux" <<MOCKEOF
#!/usr/bin/env bash
case "\$1" in
  new-split) touch "${SURFACE_OPENED}"; echo "surface:1" ;;
  read-screen) echo "ready" ;;
  send) printf '%s' "\${!#}" > "${PANE_CMD_FILE}" ;;
  *) exit 0 ;;
esac
MOCKEOF

for bin in claude kiro-cli; do
  cat > "$MOCK_BIN/$bin" <<MOCKEOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "${ARGS_RECORD}"
printf '%s' "\${KONDUCTOR_DONE_FILE:-__UNSET__}" > "${DONE_RECORD}"
exit 0
MOCKEOF
done
chmod +x "$MOCK_BIN"/*

export PATH="$MOCK_BIN:$PATH"
export CMUX_BIN="$MOCK_BIN/cmux"
export KONDUCTOR_CMUX_REGISTRY_DIR="$WORKDIR/registry"
export HOME="$WORKDIR/home"
mkdir -p "$HOME/.claude/agents"
touch "$HOME/.claude/agents/k-developer.md"

# dispatch <task>: runs the dispatch, then the pane command it sent, as a
# cmux surface would. Leaves stderr in $WORKDIR/err and the exit code in $RC.
RC=0
dispatch() {
  local task="$1"
  rm -rf "$KONDUCTOR_CMUX_REGISTRY_DIR" "$ARGS_RECORD" "$DONE_RECORD" "$PANE_CMD_FILE" "$SURFACE_OPENED"
  bash "$DISPATCH" --agent k-developer --task "$task" >"$WORKDIR/out" 2>"$WORKDIR/err"
  RC=$?
  if [[ -f "$PANE_CMD_FILE" ]]; then
    (cd "$WORKDIR" && bash -c "$(cat "$PANE_CMD_FILE")") >/dev/null 2>&1
  fi
}

recorded_args() { [[ -f "$ARGS_RECORD" ]] && paste -sd' ' "$ARGS_RECORD"; }

expect_args() {
  local label="$1" want="$2" got
  got="$(recorded_args)"
  if [[ "$RC" -eq 0 && "$got" == "$want" ]]; then
    log_pass "$label: runs '$want'"
  else
    log_fail "$label: expected '$want' (exit 0), got '${got:-<not launched>}' (exit $RC)"
    sed 's/^/    /' "$WORKDIR/err"
  fi
}

export CLAUDECODE=1
unset KONDUCTOR_DISPATCH_PERMISSION_MODE

dispatch "do it"
expect_args "unset mode (interactive)" "--agent k-developer do it"

export KONDUCTOR_DISPATCH_PERMISSION_MODE=interactive
dispatch "do it"
expect_args "interactive" "--agent k-developer do it"

export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
dispatch "do it"
expect_args "headless" "--agent k-developer -p --permission-mode acceptEdits --permission-prompts none do it"

export KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass
dispatch "do it"
expect_args "bypass" "--agent k-developer --dangerously-skip-permissions -p do it"
if grep -q "WARNING: KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass" "$WORKDIR/err"; then
  log_pass "bypass: prints a warning"
else
  log_fail "bypass: no warning on stderr"
fi

export KONDUCTOR_DISPATCH_PERMISSION_MODE=yolo
dispatch "do it"
if [[ "$RC" -ne 0 && ! -e "$SURFACE_OPENED" ]] && grep -q "must be interactive, headless or bypass" "$WORKDIR/err"; then
  log_pass "unknown mode: refused before a surface opens"
else
  log_fail "unknown mode: expected a non-zero exit and no surface (exit $RC)"
  sed 's/^/    /' "$WORKDIR/err"
fi

export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
dispatch "--help me"
if [[ "$(tail -n 1 "$ARGS_RECORD" 2>/dev/null)" == " --help me" ]]; then
  log_pass "task starting with '-': passed as the prompt"
else
  log_fail "task starting with '-': last argument was '$(tail -n 1 "$ARGS_RECORD" 2>/dev/null)'"
fi

dispatch "do it"
if [[ "$(cat "$DONE_RECORD" 2>/dev/null)" == "$KONDUCTOR_CMUX_REGISTRY_DIR/surface_1.done" ]]; then
  log_pass "the child sees KONDUCTOR_DONE_FILE"
else
  log_fail "KONDUCTOR_DONE_FILE in the child was '$(cat "$DONE_RECORD" 2>/dev/null)'"
fi
if grep -q '"summary": "claude exit"' "$KONDUCTOR_CMUX_REGISTRY_DIR/surface_1.done" 2>/dev/null; then
  log_pass "the pane writes .done with summary 'claude exit' after claude exits"
else
  log_fail "no .done with summary 'claude exit' after claude exited"
fi

# Kiro CLI ignores the mode, even an invalid one.
unset CLAUDECODE
export KONDUCTOR_DISPATCH_PERMISSION_MODE=yolo
dispatch "do it"
expect_args "Kiro CLI with an invalid mode" "chat --agent k-developer --no-interactive --trust-all-tools do it"

unset KONDUCTOR_DISPATCH_PERMISSION_MODE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
