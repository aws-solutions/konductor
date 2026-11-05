#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-permission-mode.sh: how tmux-dispatch.sh and zellij-dispatch.sh launch
# a Claude Code child for each KONDUCTOR_DISPATCH_PERMISSION_MODE value, that
# an unknown value is refused before any pane opens, that a task starting
# with '-' or carrying shell metacharacters reaches claude as exactly one
# prompt argument and runs nothing, that the child gets --add-dir for the
# registry dir and sees KONDUCTOR_DONE_FILE, that a .done the child writes
# itself is kept, and that the Kiro CLI branch ignores the mode.
#
# Usage: bash test-permission-mode.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SKILL_DIR="${PKG_ROOT}/skills/mux-dispatch"

PASS=0
FAIL=0
log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"
# The claude and kiro-cli mocks write one argument per line, then the
# KONDUCTOR_DONE_FILE they saw. With MOCK_CHILD_WRITES_DONE set they also
# write that .done file themselves, as a child may.
ARGS_RECORD="$WORKDIR/args.txt"
DONE_RECORD="$WORKDIR/done-file.txt"
PANE_OPENED="$WORKDIR/pane-opened"

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

cat > "$MOCK_BIN/tmux" <<MOCKEOF
#!/usr/bin/env bash
case "\$1" in
  split-window|new-window) touch "${PANE_OPENED}"; bash -c "\${!#}" >/dev/null 2>&1; echo "%1" ;;
  *) exit 0 ;;
esac
MOCKEOF

cat > "$MOCK_BIN/zellij" <<MOCKEOF
#!/usr/bin/env bash
[[ "\$1" == "list-sessions" ]] && { echo "test-session"; exit 0; }
cmd=() sep=0
for a in "\$@"; do
  if [[ "\$sep" == 1 ]]; then cmd+=("\$a"); elif [[ "\$a" == "--" ]]; then sep=1; fi
done
touch "${PANE_OPENED}"
[[ "\${#cmd[@]}" -gt 0 ]] && "\${cmd[@]}" >/dev/null 2>&1
echo "terminal_1"
MOCKEOF
chmod +x "$MOCK_BIN"/*

export PATH="$MOCK_BIN:$PATH"
export KONDUCTOR_MUX_REGISTRY_DIR="$WORKDIR/registry"
export HOME="$WORKDIR/home"
mkdir -p "$HOME/.claude/agents"
touch "$HOME/.claude/agents/k-developer.md"
REG="$KONDUCTOR_MUX_REGISTRY_DIR"

# dispatch <backend> <task>: runs one dispatch with the current environment.
# Leaves stderr in $WORKDIR/err and the exit code in $RC.
RC=0
dispatch() {
  local backend="$1" task="$2"
  rm -rf "$REG" "$ARGS_RECORD" "$DONE_RECORD" "$PANE_OPENED"
  if [[ "$backend" == tmux ]]; then
    TMUX=fake bash "$SKILL_DIR/tmux-dispatch.sh" \
      --agent k-developer --task "$task" --cwd "$WORKDIR" >"$WORKDIR/out" 2>"$WORKDIR/err"
  else
    ZELLIJ=fake ZELLIJ_SESSION_NAME=test-session bash "$SKILL_DIR/zellij-dispatch.sh" \
      --agent k-developer --task "$task" --cwd "$WORKDIR" >"$WORKDIR/out" 2>"$WORKDIR/err"
  fi
  RC=$?
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

for backend in tmux zellij; do
  unset KONDUCTOR_DISPATCH_PERMISSION_MODE MOCK_CHILD_WRITES_DONE
  export CLAUDECODE=1

  dispatch "$backend" "do it"
  expect_args "$backend unset mode runs interactive" <<ARGS
--add-dir
$REG
--agent
k-developer
do it
ARGS

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=interactive
  dispatch "$backend" "do it"
  expect_args "$backend interactive" <<ARGS
--add-dir
$REG
--agent
k-developer
do it
ARGS

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
  dispatch "$backend" "do it"
  expect_args "$backend headless" <<ARGS
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
  dispatch "$backend" "do it"
  expect_args "$backend bypass" <<ARGS
--add-dir
$REG
--agent
k-developer
--dangerously-skip-permissions
-p
do it
ARGS
  if grep -q "WARNING: KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass" "$WORKDIR/err"; then
    log_pass "$backend bypass: prints a warning"
  else
    log_fail "$backend bypass: no warning on stderr"
  fi

  # "invalid" is the value the plugin's env hook writes for a mistyped option.
  for bad in yolo invalid Headless; do
    export KONDUCTOR_DISPATCH_PERMISSION_MODE="$bad"
    dispatch "$backend" "do it"
    if [[ "$RC" -ne 0 && ! -e "$PANE_OPENED" ]] && grep -q "must be interactive, headless or bypass" "$WORKDIR/err"; then
      log_pass "$backend mode '$bad': refused before a pane opens"
    else
      log_fail "$backend mode '$bad': expected a non-zero exit and no pane (exit $RC)"
      sed 's/^/    /' "$WORKDIR/err"
    fi
  done

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
  dispatch "$backend" "$HOSTILE"
  expect_args "$backend hostile task arrives as one prompt argument" <<ARGS
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
    log_fail "$backend hostile task: a substitution ran"
  else
    log_pass "$backend hostile task: nothing ran"
  fi
  rm -f "$WORKDIR/pwned1" "$WORKDIR/pwned2"

  dispatch "$backend" "do it"
  done_seen="$(cat "$DONE_RECORD" 2>/dev/null)"
  if [[ "$done_seen" == "$REG/$backend-"*.done ]]; then
    log_pass "$backend: the child sees KONDUCTOR_DONE_FILE"
  else
    log_fail "$backend: KONDUCTOR_DONE_FILE in the child was '${done_seen:-<none>}'"
  fi
  if grep -q '"summary": "shell fallback"' "$done_seen" 2>/dev/null; then
    log_pass "$backend: the launcher writes .done after claude exits"
  else
    log_fail "$backend: no fallback .done file after claude exited"
  fi

  export MOCK_CHILD_WRITES_DONE=1
  dispatch "$backend" "do it"
  done_seen="$(cat "$DONE_RECORD" 2>/dev/null)"
  if grep -q '"summary": "child wrote this"' "$done_seen" 2>/dev/null; then
    log_pass "$backend: a .done the child wrote is kept"
  else
    log_fail "$backend: the fallback replaced the child's .done ($(cat "$done_seen" 2>/dev/null))"
  fi
  unset MOCK_CHILD_WRITES_DONE

  # Kiro CLI ignores the mode, even an invalid one.
  unset CLAUDECODE
  export KONDUCTOR_DISPATCH_PERMISSION_MODE=yolo
  dispatch "$backend" "do it"
  expect_args "$backend Kiro CLI ignores an invalid mode" <<ARGS
chat
--agent
k-developer
--no-interactive
--trust-all-tools
do it
ARGS
done

unset KONDUCTOR_DISPATCH_PERMISSION_MODE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
