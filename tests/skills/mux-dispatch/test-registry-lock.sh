#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-registry-lock.sh — Regression test proving tmux-dispatch.sh and
# zellij-dispatch.sh serialize their read-modify-write of the shared
# dispatched.json registry instead of racing on it.
#
# Background: both scripts read the whole registry file, append an entry in
# memory, and rewrite the whole file, with no coordination between
# concurrent invocations (of either script -- both write the same file).
# Before an exclusive fcntl.flock was added around that critical section, N
# concurrent dispatches reliably lost most of their entries (measured:
# 6-7/50-60 survived in a synthetic reproduction of the identical
# read-append-write pattern used here, and by mux-close-pane.sh's registry
# removal). This test fires many concurrent dispatches (a mix of both
# backends) at the real scripts and asserts every single one is present in
# the final registry -- a regression that drops the lock will fail this
# test.
#
# Isolation: points the scripts at a private registry directory via
# KONDUCTOR_MUX_REGISTRY_DIR (an env override the scripts support
# specifically for this) rather than the real, shared
# /tmp/konductor-mux/dispatched.json production registry -- so a broken
# lock under test (the exact regression this test exists to catch) can
# never lose or corrupt a real user's registry entries as a side effect of
# running this test.
#
# Usage: bash test-registry-lock.sh
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

N=${TEST_REGISTRY_LOCK_N:-25}   # concurrent dispatches per backend (2N total)
AGENT_MARKER="racetestagent"    # must satisfy the scripts' ^[a-z0-9-]+$ check

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"

# Isolated registry directory -- never the real /tmp/konductor-mux -- passed
# to both scripts via their KONDUCTOR_MUX_REGISTRY_DIR override.
REGISTRY_DIR="$WORKDIR/registry"
REGISTRY_FILE="${REGISTRY_DIR}/dispatched.json"
mkdir -p "$REGISTRY_DIR"

# Mock kiro-cli: present only so PATH resolution succeeds; never actually
# invoked -- the mocks below never execute the generated launcher script,
# and the registry write under test happens in the dispatching script
# itself, immediately after the mocked tmux/zellij call returns.
cat > "$MOCK_BIN/kiro-cli" <<'MOCKEOF'
#!/usr/bin/env bash
exit 0
MOCKEOF
chmod +x "$MOCK_BIN/kiro-cli"

# Mock tmux: returns a unique pane id and exits immediately.
cat > "$MOCK_BIN/tmux" <<'MOCKEOF'
#!/usr/bin/env bash
case "$1" in
  split-window|new-window) echo "%$$" ;;
  select-pane|select-layout) exit 0 ;;
  *) echo "MOCK tmux: unhandled subcommand: $1" >&2; exit 1 ;;
esac
MOCKEOF
chmod +x "$MOCK_BIN/tmux"

# Mock zellij: same minimal surface, returns a unique terminal_<pid> id.
cat > "$MOCK_BIN/zellij" <<'MOCKEOF'
#!/usr/bin/env bash
if [[ "$1" == "list-sessions" ]]; then
  echo "test-session"
  exit 0
fi
echo "terminal_$$"
MOCKEOF
chmod +x "$MOCK_BIN/zellij"

export PATH="$MOCK_BIN:$PATH"
export KONDUCTOR_MUX_REGISTRY_DIR="$REGISTRY_DIR"
unset CLAUDECODE  # force the kiro-cli branch (no filesystem agent lookup)

dispatch_tmux() {
  TMUX="fake-session" bash "$TMUX_SCRIPT" \
    --agent "$AGENT_MARKER" --task "race test $1" --cwd "$WORKDIR" --split right >/dev/null 2>/dev/null
}

dispatch_zellij() {
  ZELLIJ="fake-session" ZELLIJ_SESSION_NAME="test-session" bash "$ZELLIJ_SCRIPT" \
    --agent "$AGENT_MARKER" --task "race test $1" --cwd "$WORKDIR" --split right >/dev/null 2>/dev/null
}

# --- Fire N concurrent tmux dispatches + N concurrent zellij dispatches ---
for i in $(seq 1 "$N"); do
  dispatch_tmux "tmux-$i" &
done
for i in $(seq 1 "$N"); do
  dispatch_zellij "zellij-$i" &
done
wait

EXPECTED=$((N * 2))
ACTUAL=$(python3 -c "
import json
try:
    with open('${REGISTRY_FILE}') as f:
        registry = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    registry = []
print(sum(1 for e in registry if e.get('agent') == '${AGENT_MARKER}'))
")

if [[ "$ACTUAL" -eq "$EXPECTED" ]]; then
  log_pass "all $EXPECTED concurrent tmux+zellij dispatches recorded in the registry (no lost updates)"
else
  log_fail "expected $EXPECTED registry entries from concurrent dispatches, found $ACTUAL -- read-modify-write race on dispatched.json (lost $((EXPECTED - ACTUAL)) updates)"
fi

# Registry must still be valid JSON after the concurrent writes -- a lock
# that serializes but corrupts content mid-write would defeat the point.
if python3 -c "import json; json.load(open('${REGISTRY_FILE}'))" 2>/dev/null; then
  log_pass "registry file is valid JSON after concurrent writes"
else
  log_fail "registry file is corrupted (not valid JSON) after concurrent writes"
fi

# --- A lock-open failure on the write side surfaces a distinct warning and
# lets the dispatch complete, instead of a generic "Failed to record
# dispatch" message or (were `set -e` not guarded correctly) aborting the
# whole dispatch outright. Make the lock path a directory so open(path,'w')
# raises an OSError. Remove any existing lock file first (the concurrent
# dispatches above already created one as a regular file).
rm -f "${REGISTRY_FILE}.lock"
mkdir -p "${REGISTRY_FILE}.lock"
lock_err_out=$(TMUX="fake-session" bash "$TMUX_SCRIPT" \
  --agent "$AGENT_MARKER" --task "lock error test" --cwd "$WORKDIR" --split right 2>&1)
lock_err_rc=$?
rmdir "${REGISTRY_FILE}.lock"

if [[ "$lock_err_rc" -eq 0 && "$lock_err_out" == *"failed to acquire the registry lock"* && "$lock_err_out" == *"DISPATCHED workspace="* ]]; then
  log_pass "a registry lock-open failure surfaces a distinct warning and still completes the dispatch (exit 0, DISPATCHED line printed)"
else
  log_fail "expected a distinct lock-open warning plus a successful DISPATCHED line (rc=$lock_err_rc); got: $lock_err_out"
fi

# --- A registry file whose top level is valid JSON but not a list (e.g. a
# malformed/hand-edited '{}') must not leak a raw Python traceback. Before
# the fix, json.load() succeeds on '{}' (no JSONDecodeError), so the dict
# flows past the (FileNotFoundError, JSONDecodeError) guard and the
# following registry.append(entry) raises an uncaught AttributeError --
# printing a traceback to stderr instead of falling through to the same
# graceful reset used for a JSONDecodeError. Assert for BOTH backends
# (tmux-dispatch.sh and zellij-dispatch.sh carry the identical block).
for backend in tmux zellij; do
  rm -f "${REGISTRY_FILE}.lock"
  printf '{}' > "$REGISTRY_FILE"

  if [[ "$backend" == "tmux" ]]; then
    malformed_out=$(TMUX="fake-session" bash "$TMUX_SCRIPT" \
      --agent "$AGENT_MARKER" --task "malformed registry test $backend" --cwd "$WORKDIR" --split right 2>&1)
  else
    malformed_out=$(ZELLIJ="fake-session" ZELLIJ_SESSION_NAME="test-session" bash "$ZELLIJ_SCRIPT" \
      --agent "$AGENT_MARKER" --task "malformed registry test $backend" --cwd "$WORKDIR" --split right 2>&1)
  fi
  malformed_rc=$?

  if [[ "$malformed_rc" -eq 0 && "$malformed_out" != *"Traceback (most recent call last)"* && "$malformed_out" == *"DISPATCHED workspace="* ]]; then
    log_pass "[$backend] a non-list registry ('{}') is handled gracefully -- no traceback, dispatch still completes"
  else
    log_fail "[$backend] expected a graceful reset (no traceback, successful DISPATCHED line) for a non-list registry (rc=$malformed_rc); got: $malformed_out"
  fi

  # The malformed content must have been discarded (same behavior as an
  # unparsable/JSONDecodeError registry) and the file left as valid JSON
  # containing only this dispatch's entry -- not silently left as '{}',
  # and not still holding a corrupt mix of old and new content.
  if python3 -c "
import json, sys
with open('${REGISTRY_FILE}') as f:
    registry = json.load(f)
sys.exit(0 if isinstance(registry, list) and len(registry) == 1 else 1)
" 2>/dev/null; then
    log_pass "[$backend] registry file is reset to a fresh JSON array after recovering from non-list content"
  else
    log_fail "[$backend] registry file is not a clean single-entry JSON array after recovering from non-list content"
  fi
done

echo
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
