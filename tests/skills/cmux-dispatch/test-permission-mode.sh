#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-permission-mode.sh: how cmux-dispatch.sh launches a Claude Code child
# for each KONDUCTOR_DISPATCH_PERMISSION_MODE value, that an unknown value is
# refused before any surface opens, that a task starting with '-' or carrying
# shell metacharacters reaches claude as exactly one prompt argument and runs
# nothing, that the child gets --add-dir for the registry dir and sees
# KONDUCTOR_DONE_FILE, that a .done the child writes itself is kept, and that
# the Kiro CLI branch ignores the mode.
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
# KONDUCTOR_DONE_FILE they saw. With MOCK_CHILD_WRITES_DONE set they also
# write that .done file themselves, as a child may.
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
if [[ -n "\${MOCK_CHILD_WRITES_DONE:-}" && -n "\${KONDUCTOR_DONE_FILE:-}" ]]; then
  printf '{"summary": "child wrote this"}' > "\$KONDUCTOR_DONE_FILE"
fi
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
REG="$KONDUCTOR_CMUX_REGISTRY_DIR"
DONE_FILE="$REG/surface_1.done"

# dispatch <task>: runs the dispatch, then the pane command it sent, as a
# cmux surface would. Leaves stderr in $WORKDIR/err and the exit code in $RC.
RC=0
dispatch() {
  local task="$1"
  rm -rf "$REG" "$ARGS_RECORD" "$DONE_RECORD" "$PANE_CMD_FILE" "$SURFACE_OPENED"
  bash "$DISPATCH" --agent k-developer --task "$task" >"$WORKDIR/out" 2>"$WORKDIR/err"
  RC=$?
  if [[ -f "$PANE_CMD_FILE" ]]; then
    (cd "$WORKDIR" && bash -c "$(cat "$PANE_CMD_FILE")") >/dev/null 2>&1
  fi
}

# expect_args <label>: compares the recorded argv, one argument per line,
# with the expected lines on stdin.
expect_args() {
  local label="$1" want got
  want="$(cat)"
  got="$(cat "$ARGS_RECORD" 2>/dev/null)"
  if [[ "$RC" -eq 0 && "$got" == "$want" ]]; then
    log_pass "$label"
  else
    log_fail "$label: exit $RC, expected argv:"
    printf '%s\n' "$want" | sed 's/^/    | /'
    echo "    got:"
    printf '%s\n' "${got:-<not launched>}" | sed 's/^/    | /'
    sed 's/^/    /' "$WORKDIR/err"
  fi
}

# A leading '-', both quote kinds, a $(...) and a backtick substitution.
HOSTILE='-x "it'\''s" $(touch PWN1) `touch PWN2` end'
HOSTILE="${HOSTILE//PWN1/$WORKDIR/pwned1}"
HOSTILE="${HOSTILE//PWN2/$WORKDIR/pwned2}"

export CLAUDECODE=1
unset KONDUCTOR_DISPATCH_PERMISSION_MODE MOCK_CHILD_WRITES_DONE

dispatch "do it"
expect_args "unset mode runs interactive" <<ARGS
--add-dir
$REG
--agent
k-developer
do it
ARGS

export KONDUCTOR_DISPATCH_PERMISSION_MODE=interactive
dispatch "do it"
expect_args "interactive" <<ARGS
--add-dir
$REG
--agent
k-developer
do it
ARGS

export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
dispatch "do it"
expect_args "headless" <<ARGS
--add-dir
$REG
--agent
k-developer
-p
--permission-mode
acceptEdits
--permission-prompts
none
do it
ARGS

export KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass
dispatch "do it"
expect_args "bypass" <<ARGS
--add-dir
$REG
--agent
k-developer
--dangerously-skip-permissions
-p
do it
ARGS
if grep -q "WARNING: KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass" "$WORKDIR/err"; then
  log_pass "bypass: prints a warning"
else
  log_fail "bypass: no warning on stderr"
fi

# "invalid" is the value the plugin's env hook writes for a mistyped option.
for bad in yolo invalid Headless; do
  export KONDUCTOR_DISPATCH_PERMISSION_MODE="$bad"
  dispatch "do it"
  if [[ "$RC" -ne 0 && ! -e "$SURFACE_OPENED" ]] && grep -q "must be interactive, headless or bypass" "$WORKDIR/err"; then
    log_pass "mode '$bad': refused before a surface opens"
  else
    log_fail "mode '$bad': expected a non-zero exit and no surface (exit $RC)"
    sed 's/^/    /' "$WORKDIR/err"
  fi
done

export KONDUCTOR_DISPATCH_PERMISSION_MODE=invalid
dispatch "do it"
if grep -q "check the Claude Code plugin's dispatch_permission_mode option" "$WORKDIR/err"; then
  log_pass "mode 'invalid': points at the plugin option"
else
  log_fail "mode 'invalid': no hint about the plugin option"
fi

export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
dispatch "$HOSTILE"
expect_args "hostile task arrives as one prompt argument" <<ARGS
--add-dir
$REG
--agent
k-developer
-p
--permission-mode
acceptEdits
--permission-prompts
none
 $HOSTILE
ARGS
if [[ -e "$WORKDIR/pwned1" || -e "$WORKDIR/pwned2" ]]; then
  log_fail "hostile task: a substitution ran"
else
  log_pass "hostile task: nothing ran"
fi
rm -f "$WORKDIR/pwned1" "$WORKDIR/pwned2"

dispatch "do it"
if [[ "$(cat "$DONE_RECORD" 2>/dev/null)" == "$DONE_FILE" ]]; then
  log_pass "the child sees KONDUCTOR_DONE_FILE"
else
  log_fail "KONDUCTOR_DONE_FILE in the child was '$(cat "$DONE_RECORD" 2>/dev/null)'"
fi
if grep -q '"summary": "claude exit"' "$DONE_FILE" 2>/dev/null; then
  log_pass "the pane writes .done with summary 'claude exit' after claude exits"
else
  log_fail "no .done with summary 'claude exit' after claude exited"
fi

export MOCK_CHILD_WRITES_DONE=1
dispatch "do it"
if grep -q '"summary": "child wrote this"' "$DONE_FILE" 2>/dev/null; then
  log_pass "a .done the child wrote is kept"
else
  log_fail "the fallback replaced the child's .done ($(cat "$DONE_FILE" 2>/dev/null))"
fi
unset MOCK_CHILD_WRITES_DONE

# Kiro CLI ignores the mode, even an invalid one.
unset CLAUDECODE
export KONDUCTOR_DISPATCH_PERMISSION_MODE=yolo
dispatch "do it"
expect_args "Kiro CLI ignores an invalid mode" <<ARGS
chat
--agent
k-developer
--no-interactive
--trust-all-tools
do it
ARGS

unset KONDUCTOR_DISPATCH_PERMISSION_MODE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
