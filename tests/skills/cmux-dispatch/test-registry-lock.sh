#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-registry-lock.sh — Regression test proving cmux-dispatch.sh
# serializes its read-modify-write of the shared dispatched.json registry
# instead of racing on it.
#
# Background: the script reads the whole registry file, appends an entry in
# memory, and rewrites the whole file, with no coordination between
# concurrent invocations. Before an exclusive fcntl.flock was added around
# that critical section, N concurrent dispatches reliably lost most of
# their entries (measured: 6-7/50-60 survived in a synthetic reproduction
# of the identical read-append-write pattern; see the sibling mux-dispatch
# test for the same proof against tmux/zellij). This test fires many
# concurrent dispatches at the real script and asserts every single one is
# present in the final registry -- a regression that drops the lock will
# fail this test.
#
# Isolation: points the script at a private registry directory via
# KONDUCTOR_CMUX_REGISTRY_DIR (an env override the script supports
# specifically for this) rather than the real, shared
# /tmp/konductor-cmux/dispatched.json production registry -- so a broken
# lock under test (the exact regression this test exists to catch) can
# never lose or corrupt a real user's registry entries as a side effect of
# running this test.
#
# Usage: bash test-registry-lock.sh
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

N=${TEST_REGISTRY_LOCK_N:-50}
AGENT_MARKER="racetestagent"   # must satisfy the script's ^[a-z0-9-]+$ check

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"

# Isolated registry directory -- never the real /tmp/konductor-cmux --
# passed to the script via its KONDUCTOR_CMUX_REGISTRY_DIR override.
REGISTRY_DIR="$WORKDIR/registry"
REGISTRY_FILE="${REGISTRY_DIR}/dispatched.json"
mkdir -p "$REGISTRY_DIR"

# Mock cmux: minimal surface (new-split/rpc/read-screen/send/send-key), all
# returning immediately. The registry write under test happens in the
# dispatching script itself right after "cmux send"/"send-key" return, so
# PANE_CMD's contents are never executed by this mock.
cat > "$MOCK_BIN/cmux" <<'MOCKEOF'
#!/usr/bin/env bash
case "$1" in
  new-split) echo "surface:$$" ;;
  rpc) exit 0 ;;
  read-screen) echo "ready" ;;
  send|send-key) exit 0 ;;
  *) echo "MOCK cmux: unhandled subcommand: $1" >&2; exit 1 ;;
esac
MOCKEOF
chmod +x "$MOCK_BIN/cmux"

export CMUX_BIN="$MOCK_BIN/cmux"
export KONDUCTOR_CMUX_REGISTRY_DIR="$REGISTRY_DIR"
unset CLAUDECODE  # force the kiro-cli branch (no filesystem agent lookup)

dispatch_one() {
  bash "$DISPATCH_SCRIPT" \
    --agent "$AGENT_MARKER" --task "race test $1" --cwd "$WORKDIR" --split right >/dev/null 2>/dev/null
}

# --- Fire N concurrent cmux dispatches ---
for i in $(seq 1 "$N"); do
  dispatch_one "$i" &
done
wait

ACTUAL=$(python3 -c "
import json
try:
    with open('${REGISTRY_FILE}') as f:
        registry = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    registry = []
print(sum(1 for e in registry if e.get('agent') == '${AGENT_MARKER}'))
")

if [[ "$ACTUAL" -eq "$N" ]]; then
  log_pass "all $N concurrent cmux dispatches recorded in the registry (no lost updates)"
else
  log_fail "expected $N registry entries from concurrent dispatches, found $ACTUAL -- read-modify-write race on dispatched.json (lost $((N - ACTUAL)) updates)"
fi

# Registry must still be valid JSON after the concurrent writes -- a lock
# that serializes but corrupts content mid-write would defeat the point.
if python3 -c "import json; json.load(open('${REGISTRY_FILE}'))" 2>/dev/null; then
  log_pass "registry file is valid JSON after concurrent writes"
else
  log_fail "registry file is corrupted (not valid JSON) after concurrent writes"
fi

# --- AutoSDE finding f-76962d1c: a write-side failure (the lock opens fine
# and the read succeeds, but writing the registry data file itself fails)
# must not leak a raw Python traceback -- only the lock-open failure was
# already a distinguished case (exit 2); every other write exception is now
# caught too (exit 3) and reported as the same clean "Failed to record
# dispatch" warning.
#
# AutoSDE finding f-cd8592d8: the write is now atomic (tempfile.mkstemp +
# os.replace, see the script's own comment) rather than a direct truncating
# open(reg_file, 'w'), so a write-only failure has to be induced at the
# "create the new temp file" step instead: opening an *existing* file for
# write, or reading one, needs write permission on that file/its own bits,
# not on the containing directory -- but *creating* a new file (what
# mkstemp does, and what the script's own earlier task-file write also
# does, in the same $REGISTRY_DIR) needs write permission on the directory.
# Making the whole directory read-only too early would break that earlier,
# unrelated task-file write instead of isolating the registry write -- so
# this synchronizes on a marker the mock cmux touches on its first
# `read-screen` call (which happens strictly after the task file is
# already written, since that happens earlier in the same, single-threaded
# script) to chmod the directory only once it's safe to, then lets the
# dispatch proceed into the now-read-only-directory registry write.
#
# AutoSDE finding f-1d3d1e42: chmod does not block anything when this test
# itself runs as root (common in CI containers; root bypasses all DAC
# permission checks) -- the write would then silently succeed, no warning
# would be emitted, and the assertion below would falsely FAIL rather than
# skip. Skip under root instead of asserting.
if [[ "$EUID" -eq 0 ]]; then
  echo "SKIP: write-failure test (chmod is not enforced for root)"
else
  MARKER_FILE="${WORKDIR}/reached-read-screen"
  READY_FLAG="${WORKDIR}/dir-is-readonly"
  rm -f "$MARKER_FILE" "$READY_FLAG"

  MOCK_BIN2="$WORKDIR/bin2"
  mkdir -p "$MOCK_BIN2"
  cat > "$MOCK_BIN2/cmux" <<MOCKEOF
#!/usr/bin/env bash
case "\$1" in
  new-split) echo "surface:\$\$" ;;
  rpc) exit 0 ;;
  read-screen)
    touch "${MARKER_FILE}"
    if [[ -f "${READY_FLAG}" ]]; then echo "ready"; else echo ""; fi
    ;;
  send|send-key) exit 0 ;;
  *) echo "MOCK cmux: unhandled subcommand: \$1" >&2; exit 1 ;;
esac
MOCKEOF
  chmod +x "$MOCK_BIN2/cmux"

  (
    CMUX_BIN="$MOCK_BIN2/cmux" bash "$DISPATCH_SCRIPT" \
      --agent "$AGENT_MARKER" --task "write error test" --cwd "$WORKDIR" --split right
  ) > "${WORKDIR}/write_err.out" 2>&1 &
  dispatch_pid=$!

  # Poll for the marker instead of a fixed sleep -- deterministic on when
  # to chmod (strictly after the task-file write, since read-screen is
  # only ever reached after it in this single-threaded script), without
  # guessing at a wall-clock delay.
  for _ in $(seq 1 50); do
    [[ -f "$MARKER_FILE" ]] && break
    sleep 0.1
  done
  chmod 0555 "${REGISTRY_DIR}"
  touch "$READY_FLAG"   # next read-screen call returns "ready"

  wait "$dispatch_pid"
  write_err_rc=$?
  write_err_out=$(cat "${WORKDIR}/write_err.out")
  chmod 0755 "${REGISTRY_DIR}"

  if [[ "$write_err_rc" -eq 0 \
        && "$write_err_out" != *"Traceback"* \
        && "$write_err_out" == *"WARNING: Failed to record dispatch in registry"* \
        && "$write_err_out" == *"DISPATCHED workspace="* ]]; then
    log_pass "a registry write failure (not a lock-open failure) is caught and reported as a clean warning, with no raw traceback, and the dispatch still completes"
  else
    log_fail "expected a clean warning (no traceback) plus a successful DISPATCHED line (rc=$write_err_rc); got: $write_err_out"
  fi
fi

# --- AutoSDE finding f-11f7f646: a registry file whose top level is valid
# JSON but not a list (e.g. a malformed/hand-edited '{}') must not leak a
# raw Python traceback. Before the fix, json.load() succeeds on '{}' (no
# JSONDecodeError), so the dict flows past the (FileNotFoundError,
# JSONDecodeError) guard and the following registry.append(entry) raises
# an uncaught AttributeError -- printing a traceback to stderr instead of
# falling through to the same graceful reset used for a JSONDecodeError.
rm -f "${REGISTRY_FILE}.lock"
printf '{}' > "$REGISTRY_FILE"

malformed_out=$(bash "$DISPATCH_SCRIPT" \
  --agent "$AGENT_MARKER" --task "malformed registry test" --cwd "$WORKDIR" --split right 2>&1)
malformed_rc=$?

if [[ "$malformed_rc" -eq 0 && "$malformed_out" != *"Traceback (most recent call last)"* && "$malformed_out" == *"DISPATCHED workspace="* ]]; then
  log_pass "a non-list registry ('{}') is handled gracefully -- no traceback, dispatch still completes"
else
  log_fail "expected a graceful reset (no traceback, successful DISPATCHED line) for a non-list registry (rc=$malformed_rc); got: $malformed_out"
fi

# The malformed content must have been discarded (same behavior as an
# unparsable/JSONDecodeError registry) and the file left as valid JSON
# containing only this dispatch's entry.
if python3 -c "
import json, sys
with open('${REGISTRY_FILE}') as f:
    registry = json.load(f)
sys.exit(0 if isinstance(registry, list) and len(registry) == 1 else 1)
" 2>/dev/null; then
  log_pass "registry file is reset to a fresh JSON array after recovering from non-list content"
else
  log_fail "registry file is not a clean single-entry JSON array after recovering from non-list content"
fi

echo
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
