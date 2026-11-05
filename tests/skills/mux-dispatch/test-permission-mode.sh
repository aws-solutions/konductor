#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-permission-mode.sh: how tmux-dispatch.sh and zellij-dispatch.sh launch
# a Claude Code child for each KONDUCTOR_DISPATCH_PERMISSION_MODE value, that
# an unknown value is refused before any pane opens, that a task starting
# with '-' still reaches claude as the prompt, that the child sees
# KONDUCTOR_DONE_FILE, and that the Kiro CLI branch ignores the mode.
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
# KONDUCTOR_DONE_FILE they saw.
ARGS_RECORD="$WORKDIR/args.txt"
DONE_RECORD="$WORKDIR/done-file.txt"
PANE_OPENED="$WORKDIR/pane-opened"

for bin in claude kiro-cli; do
  cat > "$MOCK_BIN/$bin" <<MOCKEOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "${ARGS_RECORD}"
printf '%s' "\${KONDUCTOR_DONE_FILE:-__UNSET__}" > "${DONE_RECORD}"
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

# dispatch <backend> <task>: runs one dispatch with the current environment.
# Leaves stderr in $WORKDIR/err and the exit code in $RC.
RC=0
dispatch() {
  local backend="$1" task="$2"
  rm -rf "$KONDUCTOR_MUX_REGISTRY_DIR" "$ARGS_RECORD" "$DONE_RECORD" "$PANE_OPENED"
  if [[ "$backend" == tmux ]]; then
    TMUX=fake bash "$SKILL_DIR/tmux-dispatch.sh" \
      --agent k-developer --task "$task" --cwd "$WORKDIR" >"$WORKDIR/out" 2>"$WORKDIR/err"
  else
    ZELLIJ=fake ZELLIJ_SESSION_NAME=test-session bash "$SKILL_DIR/zellij-dispatch.sh" \
      --agent k-developer --task "$task" --cwd "$WORKDIR" >"$WORKDIR/out" 2>"$WORKDIR/err"
  fi
  RC=$?
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

for backend in tmux zellij; do
  unset KONDUCTOR_DISPATCH_PERMISSION_MODE
  export CLAUDECODE=1

  dispatch "$backend" "do it"
  expect_args "$backend unset mode (interactive)" "--agent k-developer do it"

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=interactive
  dispatch "$backend" "do it"
  expect_args "$backend interactive" "--agent k-developer do it"

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
  dispatch "$backend" "do it"
  expect_args "$backend headless" "--agent k-developer -p --permission-mode acceptEdits --permission-prompts none do it"

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass
  dispatch "$backend" "do it"
  expect_args "$backend bypass" "--agent k-developer --dangerously-skip-permissions -p do it"
  if grep -q "WARNING: KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass" "$WORKDIR/err"; then
    log_pass "$backend bypass: prints a warning"
  else
    log_fail "$backend bypass: no warning on stderr"
  fi

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=yolo
  dispatch "$backend" "do it"
  if [[ "$RC" -ne 0 && ! -e "$PANE_OPENED" ]] && grep -q "must be interactive, headless or bypass" "$WORKDIR/err"; then
    log_pass "$backend unknown mode: refused before a pane opens"
  else
    log_fail "$backend unknown mode: expected a non-zero exit and no pane (exit $RC)"
    sed 's/^/    /' "$WORKDIR/err"
  fi

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
  dispatch "$backend" "--help me"
  if [[ "$(tail -n 1 "$ARGS_RECORD" 2>/dev/null)" == " --help me" ]]; then
    log_pass "$backend task starting with '-': passed as the prompt"
  else
    log_fail "$backend task starting with '-': last argument was '$(tail -n 1 "$ARGS_RECORD" 2>/dev/null)'"
  fi

  dispatch "$backend" "do it"
  done_seen="$(cat "$DONE_RECORD" 2>/dev/null)"
  if [[ "$done_seen" == "$KONDUCTOR_MUX_REGISTRY_DIR/$backend-"*.done ]]; then
    log_pass "$backend: the child sees KONDUCTOR_DONE_FILE"
  else
    log_fail "$backend: KONDUCTOR_DONE_FILE in the child was '${done_seen:-<none>}'"
  fi
  if ls "$KONDUCTOR_MUX_REGISTRY_DIR"/"$backend"-*.done >/dev/null 2>&1; then
    log_pass "$backend: the launcher writes .done after claude exits"
  else
    log_fail "$backend: no .done file after claude exited"
  fi

  # Kiro CLI ignores the mode, even an invalid one.
  unset CLAUDECODE
  export KONDUCTOR_DISPATCH_PERMISSION_MODE=yolo
  dispatch "$backend" "do it"
  expect_args "$backend Kiro CLI with an invalid mode" "chat --agent k-developer --no-interactive --trust-all-tools do it"
done

unset KONDUCTOR_DISPATCH_PERMISSION_MODE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
