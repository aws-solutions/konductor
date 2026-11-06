#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-permission-mode.sh: how cmux-dispatch.sh launches a child, for both
# runtimes. The same cases as the mux-dispatch test of the same name: the
# claude argv per KONDUCTOR_DISPATCH_PERMISSION_MODE, refusal of an unknown
# mode before a surface opens, a 0700 per-dispatch directory that is the
# child's only grant, a hostile task that runs nothing, --brief, and the
# .done contract (child-written .done kept with the exit code, a non-zero
# exit recorded as "error", and the "claude exit" fallback).
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
SURFACE_CLOSED="$WORKDIR/surface-closed"
# The claude and kiro-cli mocks write one argument per line, then the
# KONDUCTOR_DONE_FILE they saw. MOCK_CHILD_WRITES_DONE makes them write that
# .done themselves, as a child should; MOCK_EXIT sets their exit code.
ARGS_RECORD="$WORKDIR/args.txt"
DONE_RECORD="$WORKDIR/done-file.txt"

cat > "$MOCK_BIN/cmux" <<MOCKEOF
#!/usr/bin/env bash
case "\$1" in
  new-split)
    [ -n "\${MOCK_NO_SURFACE:-}" ] && { echo "surface:"; exit 0; }
    touch "${SURFACE_OPENED}"
    # MOCK_COLLIDE plants the directory this dispatch is about to claim.
    if [ -n "\${MOCK_COLLIDE:-}" ]; then
      for d in "\$KONDUCTOR_CMUX_REGISTRY_DIR"/.pending-*; do mkdir "\$KONDUCTOR_CMUX_REGISTRY_DIR/surface_1-\${d##*.pending-}"; done
    fi
    echo "surface:1" ;;
  close-surface) touch "${SURFACE_CLOSED}" ;;
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
chmod +x "$MOCK_BIN"/*

export PATH="$MOCK_BIN:$PATH"
export CMUX_BIN="$MOCK_BIN/cmux"
export KONDUCTOR_CMUX_REGISTRY_DIR="$WORKDIR/registry"
export HOME="$WORKDIR/home"
mkdir -p "$HOME/.claude/agents"
touch "$HOME/.claude/agents/k-developer.md"
REG="$KONDUCTOR_CMUX_REGISTRY_DIR"

# dispatch [dispatch args...]: runs the dispatch with --agent k-developer,
# then the pane command it sent, as a cmux surface would. Leaves stderr in
# $WORKDIR/err, the exit code in $RC, and the printed paths in $DIR / $DONE.
RC=0 DIR="" DONE=""
dispatch() {
  rm -f "$ARGS_RECORD" "$DONE_RECORD" "$PANE_CMD_FILE" "$SURFACE_OPENED"
  bash "$DISPATCH" --agent k-developer "$@" >"$WORKDIR/out" 2>"$WORKDIR/err"
  RC=$?
  DIR="$(grep -o 'dispatch_dir=[^ ]*' "$WORKDIR/out" | cut -d= -f2)"
  DONE="$(grep -o 'done_file=[^ ]*' "$WORKDIR/out" | cut -d= -f2)"
  if [[ -f "$PANE_CMD_FILE" ]]; then
    (cd "$WORKDIR" && bash -c "$(cat "$PANE_CMD_FILE")") >/dev/null 2>&1
  fi
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

export CLAUDECODE=1
unset KONDUCTOR_DISPATCH_PERMISSION_MODE MOCK_CHILD_WRITES_DONE MOCK_EXIT

dispatch --task "do it"
expect_args "unset mode runs interactive" <<ARGS
--add-dir
$DIR
--agent
k-developer
$(prompt_for "$DIR" "$DONE")
ARGS
check "the dispatch dir is a 0700 directory under the registry, keyed by surface and a random suffix" \
  '[[ "$DIR" =~ ^$REG/surface_1-[0-9a-f]{8}$ && -d "$DIR" && "$(stat -c %a "$DIR" 2>/dev/null || stat -f %Lp "$DIR")" == 700 ]]'
check "the brief holds the task text" '[[ "$(cat "$DIR/task.md")" == "do it" ]]'
check "the .done path is inside the dispatch dir" '[[ "$DONE" == "$DIR/"*.done ]]'
check "the registry stays outside the grant and records the dispatch dir" \
  "[[ ! -e '$DIR/dispatched.json' ]] && grep -q '\"dispatch_dir\": \"$DIR\"' '$REG/dispatched.json'"

# shellcheck disable=SC2034  # read inside check's eval
FIRST="$DIR"
dispatch --task "do it"
# shellcheck disable=SC2034  # read inside check's eval
GRANT="$(sed -n 2p "$ARGS_RECORD")"
check "a second dispatch on the same surface gets a different directory" '[[ -n "$DIR" && "$DIR" != "$FIRST" ]]'
check "the child's grant is its own directory, not a sibling's or the registry" \
  '[[ "$GRANT" == "$DIR" && "$FIRST/" != "$GRANT"/* && "$GRANT" != "$REG" ]]'

export KONDUCTOR_DISPATCH_PERMISSION_MODE=interactive
dispatch --task "do it"
expect_args "interactive" <<ARGS
--add-dir
$DIR
--agent
k-developer
$(prompt_for "$DIR" "$DONE")
ARGS

export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
dispatch --task "do it"
expect_args "headless" <<ARGS
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
dispatch --task "do it"
expect_args "bypass" <<ARGS
--add-dir
$DIR
--agent
k-developer
--dangerously-skip-permissions
-p
$(prompt_for "$DIR" "$DONE")
ARGS
check "bypass: prints a warning" 'grep -q "WARNING: KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass" "$WORKDIR/err"'

# "invalid" is the value the plugin's env hook writes for a mistyped option.
for bad in yolo invalid Headless; do
  export KONDUCTOR_DISPATCH_PERMISSION_MODE="$bad"
  dispatch --task "do it"
  check "mode '$bad': refused before a surface opens" \
    '[[ "$RC" -ne 0 && ! -e "$SURFACE_OPENED" ]] && grep -q "must be interactive, headless or bypass" "$WORKDIR/err"'
  if [[ "$bad" == invalid ]]; then
    check "mode 'invalid': points at the plugin option" \
      "grep -q \"check the Claude Code plugin's dispatch_permission_mode option\" '$WORKDIR/err'"
  fi
done

export KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
dispatch --task "$HOSTILE"
check "hostile task: lands verbatim in the brief" '[[ "$RC" -eq 0 && "$(cat "$DIR/task.md")" == "$HOSTILE" ]]'
check "hostile task: the prompt argument is the fixed instruction" \
  '[[ "$(tail -n 1 "$ARGS_RECORD")" == "$(prompt_for "$DIR" "$DONE")" ]]'
check "hostile task: nothing ran" '[[ ! -e "$WORKDIR/pwned1" && ! -e "$WORKDIR/pwned2" ]]'

printf 'a brief\nwith "quotes" and $(no expansion)\n' > "$WORKDIR/brief.md"
dispatch --brief "$WORKDIR/brief.md"
check "--brief: the file is copied into the dispatch dir" 'cmp -s "$WORKDIR/brief.md" "$DIR/task.md"'
dispatch --brief "$WORKDIR/brief.md" --task "x"
check "--brief and --task together are refused before a surface opens" '[[ "$RC" -ne 0 && ! -e "$SURFACE_OPENED" ]]'

# The .done contract.
dispatch --task "do it"
check "the child sees KONDUCTOR_DONE_FILE" '[[ "$(cat "$DONE_RECORD")" == "$DONE" ]]'
check "child never writes .done: the fallback records done, 'claude exit' and exit 0" \
  '[[ "$(done_field status)" == done && "$(done_field summary)" == "claude exit" && "$(done_field exit_code)" == 0 ]]'

export MOCK_CHILD_WRITES_DONE=1
dispatch --task "do it"
check "child writes .done then exits 0: its .done is kept and gains exit_code 0" \
  '[[ "$(done_field status)" == done && "$(done_field summary)" == "child wrote this" && "$(done_field exit_code)" == 0 ]]'

export MOCK_EXIT=3
dispatch --task "do it"
check "child writes .done then exits 3: the failure is recorded" \
  '[[ "$(done_field status)" == error && "$(done_field summary)" == "child wrote this" && "$(done_field exit_code)" == 3 ]]'
unset MOCK_CHILD_WRITES_DONE
dispatch --task "do it"
check "child exits 3 without .done: the fallback records the error" \
  '[[ "$(done_field status)" == error && "$(done_field exit_code)" == 3 ]]'
unset MOCK_EXIT

# Hardened .done recording: never follows a symlink, never blocks on a
# FIFO, ignores an oversized .done, and fills in a missing status.
echo victim > "$WORKDIR/victim"
export MOCK_PLANT=tmp-symlink
dispatch --task "do it"
check "a planted .tmp symlink is not followed" \
  '[[ "$(cat "$WORKDIR/victim")" == victim && -f "$DONE" && ! -L "$DONE" && "$(done_field exit_code)" == 0 ]]'
export MOCK_PLANT=done-symlink
dispatch --task "do it"
check "a .done symlink is replaced, not followed" \
  '[[ "$(cat "$WORKDIR/victim")" == victim && -f "$DONE" && ! -L "$DONE" && "$(done_field exit_code)" == 0 ]]'
export MOCK_PLANT=big
dispatch --task "do it"
check "an oversized .done gets the fallback" \
  '[[ "$(done_field exit_code)" == 0 && "$(wc -c < "$DONE")" -lt 1000 && "$(done_field summary)" != x* ]]'
export MOCK_PLANT=no-status
dispatch --task "do it"
check "a .done without status gets done on exit 0" '[[ "$(done_field status)" == done && "$(done_field summary)" == "no status here" ]]'
export MOCK_EXIT=3
dispatch --task "do it"
check "a .done without status gets error on exit 3" '[[ "$(done_field status)" == error && "$(done_field exit_code)" == 3 ]]'
unset MOCK_EXIT
export MOCK_PLANT=fifo
dispatch --task "do it" &
bg=$!
for _ in $(seq 1 100); do kill -0 "$bg" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$bg" 2>/dev/null; then
  kill "$bg"; wait "$bg" 2>/dev/null
  log_fail "a FIFO .done blocked the launcher"
else
  wait "$bg"
  DONE="$(grep -o 'done_file=[^ ]*' "$WORKDIR/out" | cut -d= -f2)"
  check "a FIFO .done gets the fallback without blocking" '[[ -f "$DONE" && "$(done_field exit_code)" == 0 ]]'
fi
unset MOCK_PLANT

# --brief size cap.
head -c 1048577 /dev/zero > "$WORKDIR/big-brief.md"
dispatch --brief "$WORKDIR/big-brief.md"
check "a --brief over 1 MB is refused before a surface opens" \
  '[[ "$RC" -ne 0 && ! -e "$SURFACE_OPENED" ]] && grep -q "over 1 MB" "$WORKDIR/err"'

# The shared registry must be private to this user.
export KONDUCTOR_CMUX_REGISTRY_DIR="$WORKDIR/fresh/registry"
dispatch --task "do it"
check "a new registry is created with mode 700" \
  '[[ "$RC" -eq 0 && "$(python3 -c "import os, stat, sys; print(oct(stat.S_IMODE(os.lstat(sys.argv[1]).st_mode)))" "$WORKDIR/fresh/registry")" == 0o700 ]]'
rm -rf "$WORKDIR/fresh" "$WORKDIR/reg-link"
ln -s "$REG" "$WORKDIR/reg-link"
export KONDUCTOR_CMUX_REGISTRY_DIR="$WORKDIR/reg-link"
dispatch --task "do it"
check "a symlinked registry is refused before a surface opens" \
  '[[ "$RC" -ne 0 && ! -e "$SURFACE_OPENED" ]] && grep -q "is a symlink" "$WORKDIR/err"'
export KONDUCTOR_CMUX_REGISTRY_DIR="$REG"
chmod 777 "$REG"
dispatch --task "do it"
check "a world-writable registry is refused" \
  '[[ "$RC" -ne 0 && ! -e "$SURFACE_OPENED" ]] && grep -q "group- or world-writable" "$WORKDIR/err"'
chmod 700 "$REG"
# / is owned by root, so it stands in for a registry someone else owns.
if [[ "$(id -u)" -ne 0 ]]; then
  export KONDUCTOR_CMUX_REGISTRY_DIR=/
  dispatch --task "do it"
  check "a registry owned by someone else is refused" \
    '[[ "$RC" -ne 0 && ! -e "$SURFACE_OPENED" ]] && grep -q "is owned by uid 0" "$WORKDIR/err"'
  export KONDUCTOR_CMUX_REGISTRY_DIR="$REG"
fi
dispatch --task "do it"
check "an owned 700 registry passes" '[[ "$RC" -eq 0 ]]'

# The dispatch directory exists before the surface opens: a failure to
# create it leaves no surface behind, and a failed surface leaves no
# directory behind.
chmod 500 "$REG"
dispatch --task "do it"
check "a dispatch directory that can't be created opens no surface" '[[ "$RC" -ne 0 && ! -e "$SURFACE_OPENED" ]]'
chmod 700 "$REG"
export MOCK_NO_SURFACE=1
dispatch --task "do it"
check "a surface that fails to open leaves no pending directory" '[[ "$RC" -ne 0 ]] && ! ls -A "$REG" | grep -q "^\.pending-"'
check "a surface that fails to open is reported" 'grep -q "ERROR: No surface" "$WORKDIR/err"'
unset MOCK_NO_SURFACE
rm -f "$SURFACE_CLOSED"
mkdir -m 700 "$WORKDIR/collide"
export KONDUCTOR_CMUX_REGISTRY_DIR="$WORKDIR/collide" MOCK_COLLIDE=1
dispatch --task "do it"
check "an existing dispatch directory is refused and its surface closed" \
  '[[ "$RC" -eq 1 && -e "$SURFACE_CLOSED" ]] && grep -q "already exists" "$WORKDIR/err"'
check "a refused dispatch leaves the existing directory untouched and no pending directory" \
  '[[ "$(ls -A "$WORKDIR/collide" | grep -v "^dispatched\.json")" == surface_1-* && -z "$(ls -A "$WORKDIR"/collide/surface_1-*)" ]]'
unset MOCK_COLLIDE
export KONDUCTOR_CMUX_REGISTRY_DIR="$REG"

# Kiro CLI ignores the mode, even an invalid one, and gets the same files.
unset CLAUDECODE
export KONDUCTOR_DISPATCH_PERMISSION_MODE=yolo
dispatch --task "do it"
expect_args "Kiro CLI ignores an invalid mode" <<ARGS
chat
--agent
k-developer
--no-interactive
--trust-all-tools
$(prompt_for "$DIR" "$DONE")
ARGS
check "Kiro CLI: the child sees KONDUCTOR_DONE_FILE, for its stop hook" '[[ "$(cat "$DONE_RECORD")" == "$DONE" ]]'
check "Kiro CLI: the fallback records 'shell fallback' with the exit code" \
  '[[ "$(done_field summary)" == "shell fallback" && "$(done_field exit_code)" == 0 ]]'

unset KONDUCTOR_DISPATCH_PERMISSION_MODE

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
