#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-worktree-provision-cmd.sh — Regression test for WORKTREE_PROVISION_CMD
# forwarding in tmux-dispatch.sh and zellij-dispatch.sh.
#
# Background: WORKTREE_PROVISION_CMD is an orchestrator-set env var that does
# not otherwise cross into the new tmux window/pane or zellij pane/tab the
# dispatched agent runs in. Both scripts forward it by writing an
# `export WORKTREE_PROVISION_CMD=%q ...` line into the generated LAUNCHER
# script at generation time (see each script's own comment above that line).
# Neither script has an equivalent test today — this is the sibling test to
# tests/skills/cmux-dispatch/test-cwd-injection.sh, covering the two
# remaining dispatch backends for the same concern.
#
# To prove the value is actually carried by the launcher file (not merely
# inherited from the parent shell's environment), the mock tmux/zellij
# binaries strip WORKTREE_PROVISION_CMD from the environment (`env -u`)
# before running the launcher — so the only way the value can reach the
# mocked kiro-cli is through the export line baked into the launcher file.
#
# Usage: bash test-worktree-provision-cmd.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

set -u

# Lives at tests/skills/mux-dispatch/ -- three levels up is the package
# root, where skills/mux-dispatch/ holds the scripts under test.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
TMUX_SCRIPT="${PKG_ROOT}/skills/mux-dispatch/tmux-dispatch.sh"
ZELLIJ_SCRIPT="${PKG_ROOT}/skills/mux-dispatch/zellij-dispatch.sh"

PASS=0
FAIL=0

log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

[[ -f "$TMUX_SCRIPT" ]]   || { echo "ERROR: cannot find tmux-dispatch.sh at $TMUX_SCRIPT" >&2; exit 1; }
[[ -f "$ZELLIJ_SCRIPT" ]] || { echo "ERROR: cannot find zellij-dispatch.sh at $ZELLIJ_SCRIPT" >&2; exit 1; }

# --- Sandbox setup -----------------------------------------------------
WORKDIR="$(mktemp -d)"
# Isolated registry directory via KONDUCTOR_MUX_REGISTRY_DIR (an env override
# both dispatch scripts support specifically for this) rather than the real,
# shared /tmp/konductor-mux production registry. This test never touches
# another process's live registry state, so it needs no unlocked
# read-filter-write cleanup against it -- `rm -rf "$WORKDIR"` on exit is
# sufficient (see test-registry-lock.sh for the actual concurrency/locking
# regression coverage against the shared registry).
REGISTRY_DIR="$WORKDIR/registry"
mkdir -p "$REGISTRY_DIR"
export KONDUCTOR_MUX_REGISTRY_DIR="$REGISTRY_DIR"

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"

WPC_RECORD_FILE="$WORKDIR/kiro_wpc.txt"

# Mock `kiro-cli`: records the WORKTREE_PROVISION_CMD value visible in its
# own environment when invoked. Both launcher scripts run kiro-cli directly
# (no --agent-file lookup needed since CLAUDECODE is unset below).
cat > "$MOCK_BIN/kiro-cli" <<MOCKEOF
#!/usr/bin/env bash
printf '%s' "\${WORKTREE_PROVISION_CMD:-__UNSET__}" > "${WPC_RECORD_FILE}"
exit 0
MOCKEOF
chmod +x "$MOCK_BIN/kiro-cli"

# Mock `tmux`: handles just the subcommands tmux-dispatch.sh exercises.
# `env -u WORKTREE_PROVISION_CMD` strips the var before running the launcher
# so a pass can only happen via the launcher file's own export line, never
# via inheritance from this mock's (or the test's) environment.
cat > "$MOCK_BIN/tmux" <<MOCKEOF
#!/usr/bin/env bash
case "\$1" in
  split-window|new-window)
    CMD="\${!#}"
    env -u WORKTREE_PROVISION_CMD bash -c "\$CMD"
    echo "%1"
    ;;
  select-pane|select-layout)
    exit 0
    ;;
  *)
    echo "MOCK tmux: unhandled subcommand: \$1" >&2
    exit 1
    ;;
esac
MOCKEOF
chmod +x "$MOCK_BIN/tmux"

# Mock `zellij`: handles `list-sessions --short` and
# `--session NAME action new-pane|new-tab ... -- <command...>`. Extracts the
# command array after the `--` separator and execs it directly (not via a
# joined string) so multi-arg commands (`bash "$LAUNCHER"`) run unmodified.
cat > "$MOCK_BIN/zellij" <<MOCKEOF
#!/usr/bin/env bash
if [[ "\$1" == "list-sessions" ]]; then
  echo "test-session"
  exit 0
fi
args=("\$@")
cmd=()
sep=0
for a in "\${args[@]}"; do
  if [[ "\$sep" == 1 ]]; then
    cmd+=("\$a")
  elif [[ "\$a" == "--" ]]; then
    sep=1
  fi
done
if [[ "\${#cmd[@]}" -gt 0 ]]; then
  env -u WORKTREE_PROVISION_CMD "\${cmd[@]}"
fi
echo "terminal_1"
MOCKEOF
chmod +x "$MOCK_BIN/zellij"

export PATH="$MOCK_BIN:$PATH"
unset CLAUDECODE  # force the kiro-cli branch in both launcher scripts

# $REGISTRY_DIR lives under $WORKDIR (isolated via KONDUCTOR_MUX_REGISTRY_DIR
# above), so a plain recursive removal on exit cleans up every artifact this
# test's runs create (launcher, task file, .done file, dispatched.json) with
# no risk to the real shared /tmp/konductor-mux registry and no need for an
# unlocked read-filter-write against it.
trap 'rm -rf "$WORKDIR"' EXIT

run_tmux() {
  rm -f "$WPC_RECORD_FILE"
  TMUX="fake-tmux-session" bash "$TMUX_SCRIPT" \
    --agent test-agent --task "test task" --cwd "$WORKDIR" --split right \
    >"$WORKDIR/tmux.out" 2>"$WORKDIR/tmux.err"
  track_launcher "$WORKDIR/tmux.out"
}

run_zellij() {
  rm -f "$WPC_RECORD_FILE"
  ZELLIJ="fake-zellij-session" ZELLIJ_SESSION_NAME="test-session" bash "$ZELLIJ_SCRIPT" \
    --agent test-agent --task "test task" --cwd "$WORKDIR" --split right \
    >"$WORKDIR/zellij.out" 2>"$WORKDIR/zellij.err"
  track_launcher "$WORKDIR/zellij.out"
}

# Extracts the exact workspace_id this run's "DISPATCHED workspace=<id> ..."
# summary line reports, and derives that run's launcher path directly from
# it -- never by globbing "newest launcher in $REGISTRY_DIR" (a concurrent
# dispatch, or a same-second mtime tie with a leftover launcher from a prior
# run, could make `ls -t | head -1` pick a launcher this test did not
# generate). $REGISTRY_DIR is this test's own isolated directory (see
# KONDUCTOR_MUX_REGISTRY_DIR above), so no separate cleanup tracking is
# needed -- `rm -rf "$WORKDIR"` on exit removes it regardless.
CURRENT_LAUNCHER=""
track_launcher() {
  local out_file="$1" ws_id
  ws_id="$(grep -o 'workspace=[^ ]*' "$out_file" 2>/dev/null | head -1 | cut -d= -f2)"
  if [[ -n "$ws_id" ]]; then
    CURRENT_LAUNCHER="${REGISTRY_DIR}/launcher-${ws_id}.sh"
  else
    CURRENT_LAUNCHER=""
  fi
}

# --- Test 1: tmux-dispatch.sh forwards WORKTREE_PROVISION_CMD intact ---
export WORKTREE_PROVISION_CMD="wt-provision --create --name"
run_tmux

if [[ ! -f "$WPC_RECORD_FILE" ]]; then
  log_fail "tmux: kiro-cli mock never ran (see tmux.err)"
  cat "$WORKDIR/tmux.err" >&2
else
  RECORDED="$(cat "$WPC_RECORD_FILE")"
  if [[ "$RECORDED" == "wt-provision --create --name" ]]; then
    log_pass "tmux: WORKTREE_PROVISION_CMD forwarded intact into the dispatched pane's kiro-cli invocation"
  else
    log_fail "tmux: WORKTREE_PROVISION_CMD value corrupted in transit (expected 'wt-provision --create --name', got '$RECORDED')"
  fi
fi

LAUNCHER="$CURRENT_LAUNCHER"
if [[ -n "$LAUNCHER" && -f "$LAUNCHER" ]] && grep -q '^export WORKTREE_PROVISION_CMD=' "$LAUNCHER"; then
  log_pass "tmux: generated launcher script contains the WORKTREE_PROVISION_CMD export line"
else
  log_fail "tmux: generated launcher script is missing the WORKTREE_PROVISION_CMD export line (launcher=${LAUNCHER:-none})"
fi

# --- Test 2: zellij-dispatch.sh forwards WORKTREE_PROVISION_CMD intact ---
run_zellij

if [[ ! -f "$WPC_RECORD_FILE" ]]; then
  log_fail "zellij: kiro-cli mock never ran (see zellij.err)"
  cat "$WORKDIR/zellij.err" >&2
else
  RECORDED="$(cat "$WPC_RECORD_FILE")"
  if [[ "$RECORDED" == "wt-provision --create --name" ]]; then
    log_pass "zellij: WORKTREE_PROVISION_CMD forwarded intact into the dispatched pane's kiro-cli invocation"
  else
    log_fail "zellij: WORKTREE_PROVISION_CMD value corrupted in transit (expected 'wt-provision --create --name', got '$RECORDED')"
  fi
fi

LAUNCHER="$CURRENT_LAUNCHER"
if [[ -n "$LAUNCHER" && -f "$LAUNCHER" ]] && grep -q '^export WORKTREE_PROVISION_CMD=' "$LAUNCHER"; then
  log_pass "zellij: generated launcher script contains the WORKTREE_PROVISION_CMD export line"
else
  log_fail "zellij: generated launcher script is missing the WORKTREE_PROVISION_CMD export line (launcher=${LAUNCHER:-none})"
fi

# --- Test 3: a value with shell metacharacters is not misinterpreted ---
# Exercises the printf '%q' quoting used by both scripts -- a value
# containing spaces, semicolons, and a single quote must not break out of
# the export statement or execute as separate commands in the launcher.
export WORKTREE_PROVISION_CMD="echo hi; touch ${WORKDIR}/pwned-tmux; echo 'done'"
run_tmux
if [[ -f "${WORKDIR}/pwned-tmux" ]]; then
  log_fail "tmux: WORKTREE_PROVISION_CMD value containing shell metacharacters executed as commands"
else
  log_pass "tmux: WORKTREE_PROVISION_CMD value containing shell metacharacters did not execute as commands"
fi
if [[ -f "$WPC_RECORD_FILE" ]] && [[ "$(cat "$WPC_RECORD_FILE")" == "echo hi; touch ${WORKDIR}/pwned-tmux; echo 'done'" ]]; then
  log_pass "tmux: WORKTREE_PROVISION_CMD with shell metacharacters forwarded intact as a single value"
else
  log_fail "tmux: WORKTREE_PROVISION_CMD with shell metacharacters not forwarded intact"
fi

export WORKTREE_PROVISION_CMD="echo hi; touch ${WORKDIR}/pwned-zellij; echo 'done'"
run_zellij
if [[ -f "${WORKDIR}/pwned-zellij" ]]; then
  log_fail "zellij: WORKTREE_PROVISION_CMD value containing shell metacharacters executed as commands"
else
  log_pass "zellij: WORKTREE_PROVISION_CMD value containing shell metacharacters did not execute as commands"
fi
if [[ -f "$WPC_RECORD_FILE" ]] && [[ "$(cat "$WPC_RECORD_FILE")" == "echo hi; touch ${WORKDIR}/pwned-zellij; echo 'done'" ]]; then
  log_pass "zellij: WORKTREE_PROVISION_CMD with shell metacharacters forwarded intact as a single value"
else
  log_fail "zellij: WORKTREE_PROVISION_CMD with shell metacharacters not forwarded intact"
fi

# --- Test 4: WORKTREE_PROVISION_CMD unset is not forced into the launcher ---
unset WORKTREE_PROVISION_CMD
run_tmux
LAUNCHER="$CURRENT_LAUNCHER"
if [[ -n "$LAUNCHER" && -f "$LAUNCHER" ]] && grep -q '^export WORKTREE_PROVISION_CMD=' "$LAUNCHER"; then
  log_fail "tmux: launcher exports WORKTREE_PROVISION_CMD even though it was unset in the dispatching shell"
else
  log_pass "tmux: launcher does not export WORKTREE_PROVISION_CMD when it was unset in the dispatching shell"
fi

run_zellij
LAUNCHER="$CURRENT_LAUNCHER"
if [[ -n "$LAUNCHER" && -f "$LAUNCHER" ]] && grep -q '^export WORKTREE_PROVISION_CMD=' "$LAUNCHER"; then
  log_fail "zellij: launcher exports WORKTREE_PROVISION_CMD even though it was unset in the dispatching shell"
else
  log_pass "zellij: launcher does not export WORKTREE_PROVISION_CMD when it was unset in the dispatching shell"
fi

# --- Summary -------------------------------------------------------------
echo
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
