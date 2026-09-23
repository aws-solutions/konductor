#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-worktree-provision-cmd.sh — Regression test for WORKTREE_PROVISION_CMD
# forwarding in cmux-dispatch.sh's CMD_PREFIX construction.
#
# Background: WORKTREE_PROVISION_CMD is an orchestrator-set env var that does
# not otherwise cross into the separate cmux session the dispatched agent
# runs in. cmux-dispatch.sh forwards it by prepending
# `export WORKTREE_PROVISION_CMD=$(printf '%q' "$WORKTREE_PROVISION_CMD") && `
# to CMD_PREFIX (see the file's own comment above that line). This test
# follows the same end-to-end pattern as the sibling test-cwd-injection.sh:
# it stubs out cmux and kiro-cli, runs cmux-dispatch.sh, captures the exact
# PANE_CMD string the script would have sent to the pane, and executes that
# string in a real bash subshell — exactly what happens once cmux types it
# into the target pane — to prove the forwarded value survives intact.
#
# Usage: bash test-worktree-provision-cmd.sh
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

# Isolated registry directory via KONDUCTOR_CMUX_REGISTRY_DIR (an env
# override cmux-dispatch.sh supports specifically for this) rather than the
# real, shared /tmp/konductor-cmux production registry -- so this test never
# reads or rewrites another process's live registry state: a per-DONE_KEY
# task file, a per-DONE_KEY .done file, and an appended entry in
# dispatched.json all land under $WORKDIR and are removed wholesale by the
# EXIT trap below, with no unlocked read-filter-write needed against a
# directory real dispatches also write to (see test-registry-lock.sh for the
# actual concurrency/locking regression coverage).
REGISTRY_DIR="$WORKDIR/registry"
mkdir -p "$REGISTRY_DIR"
export KONDUCTOR_CMUX_REGISTRY_DIR="$REGISTRY_DIR"

trap 'rm -rf "$WORKDIR"' EXIT

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"

CAPTURE_FILE="$WORKDIR/captured_pane_cmd.txt"

# Mock `cmux`: same minimal surface as test-cwd-injection.sh's mock.
cat > "$MOCK_BIN/cmux" <<MOCKEOF
#!/usr/bin/env bash
case "\$1" in
  new-split)
    # Unique per invocation (this mock's own PID at runtime, hence the
    # escaped \$\$) -- never a fixed value -- so cleanup below can never
    # target a real concurrent dispatch's files that happen to share a
    # hardcoded key (AutoSDE finding f-de8ce28e).
    echo "surface:\$\$"
    ;;
  rpc)
    exit 0
    ;;
  read-screen)
    echo "ready"
    ;;
  send)
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

# Mock `kiro-cli`: records the WORKTREE_PROVISION_CMD value it sees in its
# environment when invoked, so we can confirm the forwarded export survived
# the round trip through CMD_PREFIX, PANE_CMD, and the pane's own shell.
WPC_RECORD_FILE="$WORKDIR/kiro_wpc.txt"
cat > "$MOCK_BIN/kiro-cli" <<MOCKEOF
#!/usr/bin/env bash
printf '%s' "\${WORKTREE_PROVISION_CMD:-__UNSET__}" > "${WPC_RECORD_FILE}"
exit 0
MOCKEOF
chmod +x "$MOCK_BIN/kiro-cli"

export PATH="$MOCK_BIN:$PATH"
export CMUX_BIN="$MOCK_BIN/cmux"
unset CLAUDECODE  # force the kiro-cli branch (no local agent file lookup needed)

# $REGISTRY_DIR is this test's own isolated directory (see
# KONDUCTOR_CMUX_REGISTRY_DIR above), so the task/.done files each dispatch
# writes under it need no per-done_key cleanup tracking -- `rm -rf
# "$WORKDIR"` on exit removes them regardless of which done_key the mock
# cmux happened to generate.
run_dispatch() {
  rm -f "$CAPTURE_FILE"
  bash "$DISPATCH_SCRIPT" \
    --agent test-agent \
    --task "test task" \
    --cwd "$WORKDIR" \
    --split right \
    >"$WORKDIR/dispatch.out" 2>"$WORKDIR/dispatch.err"
}

# --- Test 1: WORKTREE_PROVISION_CMD is forwarded and survives intact ---
export WORKTREE_PROVISION_CMD="wt-provision --create --name"
rm -f "$WPC_RECORD_FILE"

run_dispatch

if [[ ! -f "$CAPTURE_FILE" ]]; then
  log_fail "no PANE_CMD was captured from the mock cmux (dispatch script did not reach 'cmux send')"
  cat "$WORKDIR/dispatch.err" >&2
else
  PANE_CMD="$(cat "$CAPTURE_FILE")"

  if [[ "$PANE_CMD" != *"export WORKTREE_PROVISION_CMD="* ]]; then
    log_fail "PANE_CMD does not contain an export of WORKTREE_PROVISION_CMD at all"
  else
    log_pass "PANE_CMD contains an export of WORKTREE_PROVISION_CMD"
  fi

  # Run the captured PANE_CMD exactly as a real cmux pane's shell would.
  ( unset WORKTREE_PROVISION_CMD; bash -c "$PANE_CMD" ) \
    >"$WORKDIR/pane_run.out" 2>"$WORKDIR/pane_run.err" || true

  if [[ -f "$WPC_RECORD_FILE" ]]; then
    RECORDED="$(cat "$WPC_RECORD_FILE")"
    if [[ "$RECORDED" == "wt-provision --create --name" ]]; then
      log_pass "WORKTREE_PROVISION_CMD forwarded intact into the dispatched pane's kiro-cli invocation"
    else
      log_fail "WORKTREE_PROVISION_CMD value corrupted in transit (expected 'wt-provision --create --name', got '$RECORDED')"
    fi
  else
    log_fail "kiro-cli mock never ran (see pane_run.err)"
    cat "$WORKDIR/pane_run.err" >&2
  fi
fi

# --- Test 2: a value with shell metacharacters is not misinterpreted ---
# Exercises the printf '%q' quoting in CMD_PREFIX -- a value containing
# spaces and a single quote must not break out of the export statement or
# execute as separate commands.
export WORKTREE_PROVISION_CMD="echo hi; touch ${WORKDIR}/pwned; echo 'done'"
rm -f "$WPC_RECORD_FILE" "${WORKDIR}/pwned"

run_dispatch

if [[ ! -f "$CAPTURE_FILE" ]]; then
  log_fail "no PANE_CMD was captured from the mock cmux for the metacharacter-value case"
  cat "$WORKDIR/dispatch.err" >&2
else
  PANE_CMD="$(cat "$CAPTURE_FILE")"
  ( unset WORKTREE_PROVISION_CMD; bash -c "$PANE_CMD" ) \
    >"$WORKDIR/pane_run2.out" 2>"$WORKDIR/pane_run2.err" || true

  if [[ -f "${WORKDIR}/pwned" ]]; then
    log_fail "WORKTREE_PROVISION_CMD value containing shell metacharacters executed as commands (created ${WORKDIR}/pwned)"
  else
    log_pass "WORKTREE_PROVISION_CMD value containing shell metacharacters did not execute as commands"
  fi

  if [[ -f "$WPC_RECORD_FILE" ]]; then
    RECORDED="$(cat "$WPC_RECORD_FILE")"
    if [[ "$RECORDED" == "echo hi; touch ${WORKDIR}/pwned; echo 'done'" ]]; then
      log_pass "WORKTREE_PROVISION_CMD with shell metacharacters forwarded intact as a single value"
    else
      log_fail "WORKTREE_PROVISION_CMD with shell metacharacters corrupted in transit (got '$RECORDED')"
    fi
  else
    log_fail "kiro-cli mock never ran for the metacharacter-value case (see pane_run2.err)"
    cat "$WORKDIR/pane_run2.err" >&2
  fi
fi

# --- Test 3: WORKTREE_PROVISION_CMD unset is not forced into the pane ---
unset WORKTREE_PROVISION_CMD
rm -f "$WPC_RECORD_FILE"

run_dispatch

if [[ ! -f "$CAPTURE_FILE" ]]; then
  log_fail "no PANE_CMD was captured from the mock cmux for the unset-var case"
  cat "$WORKDIR/dispatch.err" >&2
else
  PANE_CMD="$(cat "$CAPTURE_FILE")"
  if [[ "$PANE_CMD" == *"export WORKTREE_PROVISION_CMD="* ]]; then
    log_fail "PANE_CMD exports WORKTREE_PROVISION_CMD even though it was unset in the dispatching shell"
  else
    log_pass "PANE_CMD does not export WORKTREE_PROVISION_CMD when it was unset in the dispatching shell"
  fi
fi

# --- Summary -------------------------------------------------------------
echo
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
