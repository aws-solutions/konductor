#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-permission-mode.sh: how tmux-dispatch.sh and zellij-dispatch.sh launch
# a child, for both runtimes:
#   - each KONDUCTOR_DISPATCH_PERMISSION_MODE value gives the expected claude
#     argv, an unknown value is refused before any pane opens, and Kiro CLI
#     ignores the mode;
#   - every dispatch gets its own 0700 directory holding its brief, and the
#     child's --add-dir grant is that directory only, never the shared
#     registry or a sibling dispatch's directory;
#   - a hostile task lands verbatim in the brief and runs nothing, and
#     --brief copies a file in;
#   - the .done contract: a .done the child writes is kept and gains the exit
#     code, a non-zero exit after it still ends as "error", and a child that
#     never writes one gets the fallback.
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
# KONDUCTOR_DONE_FILE they saw. MOCK_CHILD_WRITES_DONE makes them write that
# .done themselves, as a child should; MOCK_EXIT sets their exit code.
ARGS_RECORD="$WORKDIR/args.txt"
DONE_RECORD="$WORKDIR/done-file.txt"
PANE_OPENED="$WORKDIR/pane-opened"

for bin in claude kiro-cli; do
  cat > "$MOCK_BIN/$bin" <<MOCKEOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "${ARGS_RECORD}"
printf '%s' "\${KONDUCTOR_DONE_FILE:-__UNSET__}" > "${DONE_RECORD}"
case "\${MOCK_PLANT:-}" in
  tmp-symlink) ln -s "${WORKDIR}/victim" "\$KONDUCTOR_DONE_FILE.tmp" ;;
  done-symlink) ln -s "${WORKDIR}/victim" "\$KONDUCTOR_DONE_FILE" ;;
  big) head -c 70000 /dev/zero | tr '\\0' x > "\$KONDUCTOR_DONE_FILE" ;;
  fifo) mkfifo "\$KONDUCTOR_DONE_FILE" ;;
  no-status) printf '{"summary": "no status here"}' > "\$KONDUCTOR_DONE_FILE" ;;
esac
if [[ -n "\${MOCK_CHILD_WRITES_DONE:-}" && -n "\${KONDUCTOR_DONE_FILE:-}" ]]; then
  printf '{"status": "done", "summary": "child wrote this"}' > "\$KONDUCTOR_DONE_FILE"
fi
exit "\${MOCK_EXIT:-0}"
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

# dispatch <backend> [dispatch args...]: runs one dispatch with the current
# environment and --agent k-developer --cwd $WORKDIR. Leaves stderr in
# $WORKDIR/err, the exit code in $RC, and the printed paths in $DIR / $DONE.
RC=0 DIR="" DONE=""
dispatch() {
  local backend="$1"; shift
  rm -f "$ARGS_RECORD" "$DONE_RECORD" "$PANE_OPENED"
  if [[ "$backend" == tmux ]]; then
    TMUX=fake bash "$SKILL_DIR/tmux-dispatch.sh" \
      --agent k-developer --cwd "$WORKDIR" "$@" >"$WORKDIR/out" 2>"$WORKDIR/err"
  else
    ZELLIJ=fake ZELLIJ_SESSION_NAME=test-session bash "$SKILL_DIR/zellij-dispatch.sh" \
      --agent k-developer --cwd "$WORKDIR" "$@" >"$WORKDIR/out" 2>"$WORKDIR/err"
  fi
  RC=$?
  DIR="$(grep -o 'dispatch_dir=[^ ]*' "$WORKDIR/out" | cut -d= -f2)"
  DONE="$(grep -o 'done_file=[^ ]*' "$WORKDIR/out" | cut -d= -f2)"
}

prompt_for() {
  printf 'Read and execute the task in %s/task.md. Write your full result to %s/result.md. As your last step, write {"status": "done", "summary": "<one line>"} to %s, with "error" as the status if you could not finish.' \
    "$1" "$1" "$2"
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

check() { if eval "$2"; then log_pass "$1"; else log_fail "$1"; fi; }

done_field() { python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], "<missing>"))' "$DONE" "$1" 2>/dev/null; }

# A leading '-', both quote kinds, a $(...) and a backtick substitution.
HOSTILE='-x "it'\''s" $(touch PWN1) `touch PWN2` end'
HOSTILE="${HOSTILE//PWN1/$WORKDIR/pwned1}"
HOSTILE="${HOSTILE//PWN2/$WORKDIR/pwned2}"

for backend in tmux zellij; do
  rm -rf "$REG"
  unset KONDUCTOR_DISPATCH_PERMISSION_MODE MOCK_CHILD_WRITES_DONE MOCK_EXIT
  export CLAUDECODE=1

  dispatch "$backend" --task "do it"
  expect_args "$backend unset mode runs interactive" <<ARGS
--add-dir
$DIR
--agent
k-developer
$(prompt_for "$DIR" "$DONE")
ARGS
  check "$backend: the dispatch dir is a 0700 directory under the registry" \
    '[[ "$DIR" == "$REG/$backend-"* && -d "$DIR" && "$(stat -c %a "$DIR" 2>/dev/null || stat -f %Lp "$DIR")" == 700 ]]'
  check "$backend: the brief holds the task text" '[[ "$(cat "$DIR/task.md")" == "do it" ]]'
  check "$backend: the .done path is inside the dispatch dir" '[[ "$DONE" == "$DIR/"*.done ]]'
  check "$backend: the registry and launchers stay outside the grant" \
    '[[ -f "$REG/dispatched.json" && ! -e "$DIR/dispatched.json" ]] && ! ls "$DIR"/launcher-* >/dev/null 2>&1'
  check "$backend: the registry records the dispatch dir" "grep -q '\"dispatch_dir\": \"$DIR\"' '$REG/dispatched.json'"

  # A second dispatch: its grant must not reach the first one's directory.
  # shellcheck disable=SC2034  # read inside check's eval
  FIRST="$DIR"
  dispatch "$backend" --task "do it"
  check "$backend: a second dispatch gets a different, sibling directory" \
    '[[ -n "$DIR" && "$DIR" != "$FIRST" && "$(dirname "$DIR")" == "$REG" ]]'
  # shellcheck disable=SC2034  # read inside check's eval
  GRANT="$(sed -n 2p "$ARGS_RECORD")"
  check "$backend: the child's grant is its own directory, not a sibling's or the registry" \
    '[[ "$GRANT" == "$DIR" && "$FIRST/" != "$GRANT"/* && "$GRANT" != "$REG" ]]'

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=interactive
  dispatch "$backend" --task "do it"
  expect_args "$backend interactive" <<ARGS
--add-dir
$DIR
--agent
k-developer
$(prompt_for "$DIR" "$DONE")
ARGS

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
  dispatch "$backend" --task "do it"
  expect_args "$backend headless" <<ARGS
--add-dir
$DIR
--agent
k-developer
-p
--permission-mode
acceptEdits
--permission-prompts
none
$(prompt_for "$DIR" "$DONE")
ARGS

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass
  dispatch "$backend" --task "do it"
  expect_args "$backend bypass" <<ARGS
--add-dir
$DIR
--agent
k-developer
--dangerously-skip-permissions
-p
$(prompt_for "$DIR" "$DONE")
ARGS
  check "$backend bypass: prints a warning" 'grep -q "WARNING: KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass" "$WORKDIR/err"'

  # "invalid" is the value the plugin's env hook writes for a mistyped option.
  for bad in yolo invalid Headless; do
    export KONDUCTOR_DISPATCH_PERMISSION_MODE="$bad"
    dispatch "$backend" --task "do it"
    check "$backend mode '$bad': refused before a pane opens" \
      '[[ "$RC" -ne 0 && ! -e "$PANE_OPENED" ]] && grep -q "must be interactive, headless or bypass" "$WORKDIR/err"'
    if [[ "$bad" == invalid ]]; then
      check "$backend mode 'invalid': points at the plugin option" \
        "grep -q \"check the Claude Code plugin's dispatch_permission_mode option\" '$WORKDIR/err'"
    fi
  done

  export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
  dispatch "$backend" --task "$HOSTILE"
  check "$backend hostile task: lands verbatim in the brief" '[[ "$RC" -eq 0 && "$(cat "$DIR/task.md")" == "$HOSTILE" ]]'
  check "$backend hostile task: the prompt argument is the fixed instruction" \
    '[[ "$(tail -n 1 "$ARGS_RECORD")" == "$(prompt_for "$DIR" "$DONE")" ]]'
  check "$backend hostile task: nothing ran" '[[ ! -e "$WORKDIR/pwned1" && ! -e "$WORKDIR/pwned2" ]]'

  printf 'a brief\nwith "quotes" and $(no expansion)\n' > "$WORKDIR/brief.md"
  dispatch "$backend" --brief "$WORKDIR/brief.md"
  check "$backend --brief: the file is copied into the dispatch dir" 'cmp -s "$WORKDIR/brief.md" "$DIR/task.md"'
  dispatch "$backend" --brief "$WORKDIR/brief.md" --task "x"
  check "$backend: --brief and --task together are refused" '[[ "$RC" -ne 0 && ! -e "$PANE_OPENED" ]]'
  dispatch "$backend" --brief "$WORKDIR/no-such-brief.md"
  check "$backend: a missing --brief file is refused" '[[ "$RC" -ne 0 && ! -e "$PANE_OPENED" ]]'

  # The .done contract.
  dispatch "$backend" --task "do it"
  check "$backend: the child sees KONDUCTOR_DONE_FILE" '[[ "$(cat "$DONE_RECORD")" == "$DONE" ]]'
  check "$backend child never writes .done: the fallback records done and exit 0" \
    '[[ "$(done_field status)" == done && "$(done_field summary)" == "shell fallback" && "$(done_field exit_code)" == 0 ]]'

  export MOCK_CHILD_WRITES_DONE=1
  dispatch "$backend" --task "do it"
  check "$backend child writes .done then exits 0: its .done is kept and gains exit_code 0" \
    '[[ "$(done_field status)" == done && "$(done_field summary)" == "child wrote this" && "$(done_field exit_code)" == 0 ]]'

  export MOCK_EXIT=3
  dispatch "$backend" --task "do it"
  check "$backend child writes .done then exits 3: the failure is recorded" \
    '[[ "$(done_field status)" == error && "$(done_field summary)" == "child wrote this" && "$(done_field exit_code)" == 3 ]]'
  unset MOCK_CHILD_WRITES_DONE
  dispatch "$backend" --task "do it"
  check "$backend child exits 3 without .done: the fallback records the error" \
    '[[ "$(done_field status)" == error && "$(done_field exit_code)" == 3 ]]'
  unset MOCK_EXIT

  # Hardened .done recording: never follows a symlink, never blocks on a
  # FIFO, ignores an oversized .done, and fills in a missing status.
  echo victim > "$WORKDIR/victim"
  export MOCK_PLANT=tmp-symlink
  dispatch "$backend" --task "do it"
  check "$backend a planted .tmp symlink is not followed" \
    '[[ "$(cat "$WORKDIR/victim")" == victim && -f "$DONE" && ! -L "$DONE" && "$(done_field exit_code)" == 0 ]]'
  export MOCK_PLANT=done-symlink
  dispatch "$backend" --task "do it"
  check "$backend a .done symlink is replaced, not followed" \
    '[[ "$(cat "$WORKDIR/victim")" == victim && -f "$DONE" && ! -L "$DONE" && "$(done_field exit_code)" == 0 ]]'
  export MOCK_PLANT=big
  dispatch "$backend" --task "do it"
  check "$backend an oversized .done gets the fallback" \
    '[[ "$(done_field exit_code)" == 0 && "$(wc -c < "$DONE")" -lt 1000 && "$(done_field summary)" != x* ]]'
  export MOCK_PLANT=no-status
  dispatch "$backend" --task "do it"
  check "$backend a .done without status gets done on exit 0" '[[ "$(done_field status)" == done && "$(done_field summary)" == "no status here" ]]'
  export MOCK_EXIT=3
  dispatch "$backend" --task "do it"
  check "$backend a .done without status gets error on exit 3" '[[ "$(done_field status)" == error && "$(done_field exit_code)" == 3 ]]'
  unset MOCK_EXIT
  export MOCK_PLANT=fifo
  dispatch "$backend" --task "do it" &
  bg=$!
  for _ in $(seq 1 100); do kill -0 "$bg" 2>/dev/null || break; sleep 0.2; done
  if kill -0 "$bg" 2>/dev/null; then
    kill "$bg"; wait "$bg" 2>/dev/null
    log_fail "$backend a FIFO .done blocked the launcher"
  else
    wait "$bg"
    DONE="$(grep -o 'done_file=[^ ]*' "$WORKDIR/out" | cut -d= -f2)"
    check "$backend a FIFO .done gets the fallback without blocking" '[[ -f "$DONE" && "$(done_field exit_code)" == 0 ]]'
  fi
  unset MOCK_PLANT

  # --brief size cap.
  head -c 1048577 /dev/zero > "$WORKDIR/big-brief.md"
  dispatch "$backend" --brief "$WORKDIR/big-brief.md"
  check "$backend a --brief over 1 MB is refused before a pane opens" \
    '[[ "$RC" -ne 0 && ! -e "$PANE_OPENED" ]] && grep -q "over 1 MB" "$WORKDIR/err"'

  # The shared registry must be private to this user.
  export KONDUCTOR_MUX_REGISTRY_DIR="$WORKDIR/fresh/registry"
  dispatch "$backend" --task "do it"
  check "$backend a new registry is created with mode 700" \
    '[[ "$RC" -eq 0 && "$(python3 -c "import os, stat, sys; print(oct(stat.S_IMODE(os.lstat(sys.argv[1]).st_mode)))" "$WORKDIR/fresh/registry")" == 0o700 ]]'
  rm -rf "$WORKDIR/fresh" "$WORKDIR/reg-link"
  ln -s "$REG" "$WORKDIR/reg-link"
  export KONDUCTOR_MUX_REGISTRY_DIR="$WORKDIR/reg-link"
  dispatch "$backend" --task "do it"
  check "$backend a symlinked registry is refused before a pane opens" \
    '[[ "$RC" -ne 0 && ! -e "$PANE_OPENED" ]] && grep -q "is a symlink" "$WORKDIR/err"'
  export KONDUCTOR_MUX_REGISTRY_DIR="$REG"
  chmod 777 "$REG"
  dispatch "$backend" --task "do it"
  check "$backend a world-writable registry is refused" \
    '[[ "$RC" -ne 0 && ! -e "$PANE_OPENED" ]] && grep -q "group- or world-writable" "$WORKDIR/err"'
  chmod 700 "$REG"
  # / is owned by root, so it stands in for a registry someone else owns.
  if [[ "$(id -u)" -ne 0 ]]; then
    export KONDUCTOR_MUX_REGISTRY_DIR=/
    dispatch "$backend" --task "do it"
    check "$backend a registry owned by someone else is refused" \
      '[[ "$RC" -ne 0 && ! -e "$PANE_OPENED" ]] && grep -q "is owned by uid 0" "$WORKDIR/err"'
    export KONDUCTOR_MUX_REGISTRY_DIR="$REG"
  fi
  dispatch "$backend" --task "do it"
  check "$backend an owned 700 registry passes" '[[ "$RC" -eq 0 ]]'

  # Kiro CLI ignores the mode, even an invalid one, and gets the same files.
  unset CLAUDECODE
  export KONDUCTOR_DISPATCH_PERMISSION_MODE=yolo
  dispatch "$backend" --task "do it"
  expect_args "$backend Kiro CLI ignores an invalid mode" <<ARGS
chat
--agent
k-developer
--no-interactive
--trust-all-tools
$(prompt_for "$DIR" "$DONE")
ARGS
  check "$backend Kiro CLI: the child sees KONDUCTOR_DONE_FILE, for its stop hook" '[[ "$(cat "$DONE_RECORD")" == "$DONE" ]]'
done

unset KONDUCTOR_DISPATCH_PERMISSION_MODE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
