#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-close-pane-registry-lock.sh — Regression test for mux-close-pane.sh's
# locked registry removal/reads, and for the lock-open error handling added
# alongside them.
#
# Background: mux-close-pane.sh's close_pane() removes a registry entry
# under an exclusive fcntl.flock on the same sibling .lock file
# tmux-dispatch.sh/zellij-dispatch.sh use for their appends; its
# load_registry_entries() and --workspace-id lookup take a shared lock for
# the same reason. Neither path previously had any test coverage in this
# repo (an adversarial self-review of this fix's own diff flagged this as
# an IMPORTANT-severity "untested write path" gap). This test covers both:
#
#   Test 1: mux-close-pane.sh removals race against tmux-dispatch.sh
#           appends on the same shared (isolated) registry file, and every
#           entry -- both the pre-seeded ones being removed and the newly
#           appended ones -- ends up correct with none lost or duplicated.
#   Test 2: a lock-open failure (the lock path is a directory) surfaces a
#           distinct error for both --workspace-id and --all, instead of
#           being misreported as "not found" / "registry is empty".
#
# Isolation: points the scripts at a private registry directory via
# KONDUCTOR_MUX_REGISTRY_DIR, never the real shared production one.
#
# Usage: bash test-close-pane-registry-lock.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

set -u

# Lives at tests/skills/mux-dispatch/ -- three levels up is the package
# root, where skills/mux-dispatch/ holds the scripts under test.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
TMUX_SCRIPT="${PKG_ROOT}/skills/mux-dispatch/tmux-dispatch.sh"
CLOSE_SCRIPT="${PKG_ROOT}/skills/mux-dispatch/mux-close-pane.sh"

PASS=0
FAIL=0
log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

[[ -f "$TMUX_SCRIPT" ]]  || { echo "ERROR: cannot find tmux-dispatch.sh at $TMUX_SCRIPT" >&2; exit 1; }
[[ -f "$CLOSE_SCRIPT" ]] || { echo "ERROR: cannot find mux-close-pane.sh at $CLOSE_SCRIPT" >&2; exit 1; }

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"

cat > "$MOCK_BIN/kiro-cli" <<'MOCKEOF'
#!/usr/bin/env bash
exit 0
MOCKEOF
chmod +x "$MOCK_BIN/kiro-cli"

# Mock tmux: handles the dispatch-side calls (split-window/select-*) and the
# close-side call (kill-pane), all returning success immediately.
cat > "$MOCK_BIN/tmux" <<'MOCKEOF'
#!/usr/bin/env bash
case "$1" in
  split-window|new-window) echo "%$$" ;;
  select-pane|select-layout) exit 0 ;;
  kill-pane) exit 0 ;;
  *) echo "MOCK tmux: unhandled subcommand: $1" >&2; exit 1 ;;
esac
MOCKEOF
chmod +x "$MOCK_BIN/tmux"

export PATH="$MOCK_BIN:$PATH"
unset CLAUDECODE

# ---------------------------------------------------------------------------
# Test 1: concurrent close_pane() removals race against concurrent
# tmux-dispatch.sh appends on the same isolated registry file.
# ---------------------------------------------------------------------------
REGISTRY_DIR="$WORKDIR/registry1"
REGISTRY_FILE="${REGISTRY_DIR}/dispatched.json"
mkdir -p "$REGISTRY_DIR"
export KONDUCTOR_MUX_REGISTRY_DIR="$REGISTRY_DIR"

N=${TEST_CLOSE_PANE_N:-25}   # pre-seeded entries to remove, and separately N appends
AGENT_MARKER="racetestagent"

# Pre-seed N entries to be removed, each with a distinct workspace_id and a
# real pane_id/backend so close_pane()'s "current pane" safety check and the
# mocked "tmux kill-pane" call both succeed. Indexed 1..N to match the
# close_one/dispatch_tmux loops below (range($N) would be 0..N-1 and leave
# seed-0 untargeted).
python3 -c "
import json
entries = [
    {'workspace_id': f'seed-{i}', 'pane_id': f'%seed{i}', 'agent': '${AGENT_MARKER}',
     'task_summary': 'seed', 'mode': 'split', 'cwd': '${WORKDIR}', 'backend': 'tmux',
     'dispatched_at': 'x'}
    for i in range(1, $N + 1)
]
with open('${REGISTRY_FILE}', 'w') as f:
    json.dump(entries, f, indent=2)
"

close_one() {
  local id=$1
  TMUX="fake-session" TMUX_PANE="not-this-one" bash "$CLOSE_SCRIPT" --workspace-id "seed-$id" >/dev/null 2>&1
}

dispatch_tmux() {
  TMUX="fake-session" bash "$TMUX_SCRIPT" \
    --agent "$AGENT_MARKER" --task "race test $1" --cwd "$WORKDIR" --split right >/dev/null 2>/dev/null
}

for i in $(seq 1 "$N"); do
  close_one "$i" &
done
for i in $(seq 1 "$N"); do
  dispatch_tmux "new-$i" &
done
wait

FINAL=$(python3 -c "
import json
with open('${REGISTRY_FILE}') as f:
    registry = json.load(f)
seed_remaining = sum(1 for e in registry if e.get('workspace_id', '').startswith('seed-'))
appended = sum(1 for e in registry if e.get('workspace_id', '').startswith('tmux-'))
print(seed_remaining, appended, len(registry))
")
read -r SEED_REMAINING APPENDED TOTAL <<< "$FINAL"

if [[ "$SEED_REMAINING" -eq 0 ]]; then
  log_pass "all $N pre-seeded entries were removed by concurrent close_pane() calls (none left behind, none lost from a racing append)"
else
  log_fail "expected 0 seed entries remaining after concurrent close, found $SEED_REMAINING -- close_pane()'s locked removal lost track of entries or raced incorrectly"
fi

if [[ "$APPENDED" -eq "$N" ]]; then
  log_pass "all $N concurrent tmux-dispatch.sh appends survived while mux-close-pane.sh was concurrently removing other entries"
else
  log_fail "expected $N appended entries to survive, found $APPENDED -- append lost a race against a concurrent close_pane() removal"
fi

if [[ "$TOTAL" -eq "$N" ]]; then
  log_pass "final registry has exactly $N entries (all $N appends, all $N seed removals accounted for -- no duplicate or phantom entries)"
else
  log_fail "expected exactly $N total entries in the final registry (all appends, no seed leftovers), found $TOTAL"
fi

if python3 -c "import json; json.load(open('${REGISTRY_FILE}'))" 2>/dev/null; then
  log_pass "registry file is valid JSON after concurrent close+append"
else
  log_fail "registry file is corrupted (not valid JSON) after concurrent close+append"
fi

# ---------------------------------------------------------------------------
# Test 2: a lock-open failure surfaces a distinct error, not "not found" /
# "registry is empty".
# ---------------------------------------------------------------------------
REGISTRY_DIR2="$WORKDIR/registry2"
REGISTRY_FILE2="${REGISTRY_DIR2}/dispatched.json"
mkdir -p "$REGISTRY_DIR2"
echo '[{"workspace_id":"ws1","pane_id":"%1","backend":"tmux","session":""}]' > "$REGISTRY_FILE2"
# Make the lock path a directory so open(path, 'w') raises an OSError.
mkdir -p "${REGISTRY_FILE2}.lock"
export KONDUCTOR_MUX_REGISTRY_DIR="$REGISTRY_DIR2"

lookup_err=$(TMUX="fake-session" bash "$CLOSE_SCRIPT" --workspace-id ws1 2>&1)
lookup_rc=$?
if [[ "$lookup_rc" -ne 0 && "$lookup_err" == *"failed to acquire registry lock"* ]]; then
  log_pass "--workspace-id reports a distinct lock-acquisition error (not 'not found in registry') when the lock cannot be opened"
else
  log_fail "--workspace-id did not report a distinct lock error (rc=$lookup_rc, output: $lookup_err)"
fi

all_err=$(TMUX="fake-session" bash "$CLOSE_SCRIPT" --all 2>&1)
all_rc=$?
# AutoSDE finding f-7b2c51a7: --all used to abort with a raw, unhandled
# `load_registry_entries` exit 2 and only python's bare "cannot open
# registry lock file ..." line on stderr -- an inconsistent failure surface
# vs --workspace-id's handled rc==2 -> distinct message + exit 1 above. --all
# now brackets the call in set +e/-e, captures the same rc, and reports the
# same "failed to acquire registry lock" message at the same exit code 1.
if [[ "$all_rc" -eq 1 && "$all_err" == *"failed to acquire registry lock"* ]]; then
  log_pass "--all reports the same distinct lock-acquisition error (and exit code) as --workspace-id when the lock cannot be opened"
else
  log_fail "--all did not surface the lock-open error consistently with --workspace-id (rc=$all_rc, expected 1; output: $all_err)"
fi

# ---------------------------------------------------------------------------
# Test 3: a *read* against a read-only lock file still succeeds --
# AutoSDE finding f-7407eadb: opening the shared lock in 'w' mode truncates
# it, which needs write permission on the lock file itself (this is what
# actually fails on a read-only filesystem/mount, since a directory-only
# read-only permission bit does not by itself block truncating an already
# -writable existing file -- only creating a brand new one). The lock is
# now opened 'r' first (falling back to 'w' only to create it the first
# time it doesn't exist), so a lookup against an existing, already
# -populated registry whose *lock file* is read-only must still find the
# entry, rather than report the *lookup* itself as "failed to acquire
# registry lock" -- distinct from the message text
# close_pane()'s own *removal write* against the very same still-read-only
# lock file produces right after (unfixed here; a write correctly still
# needs 'w' access to the lock for its exclusive LOCK_EX, and this is the
# already-covered write-path warning from an earlier fix in this CR, not a
# regression) -- both are asserted for explicitly below so the distinction
# is proven, not just assumed by loose substring matching.
#
# AutoSDE finding f-e6acaf37: both Test 3 and Test 4 assert a
# permission-based failure (the removal write's own "failed to acquire the
# registry lock" warning) without guarding for root. That warning only
# appears because opening the read-only lock file for write fails -- root
# bypasses DAC permission checks entirely, so under root (common in CI
# containers) the write would silently succeed, no warning would be
# emitted, and the assertion below would falsely FAIL. The sibling
# tests/skills/cmux-dispatch/test-registry-lock.sh already handles exactly
# this (citing AutoSDE finding f-1d3d1e42) -- Tests 3 and 4 get the same
# guard. Test 2 above is unaffected: it makes the lock path a directory,
# which fails `open()` regardless of privilege level, so it needs no
# root guard.
# ---------------------------------------------------------------------------
if [[ "$EUID" -eq 0 ]]; then
  echo "SKIP: read-only-lock-file tests (chmod is not enforced for root)"
else
  REGISTRY_DIR3="$WORKDIR/registry3"
  REGISTRY_FILE3="${REGISTRY_DIR3}/dispatched.json"
  mkdir -p "$REGISTRY_DIR3"
  echo '[{"workspace_id":"ws-ro","pane_id":"%1","backend":"tmux","session":""}]' > "$REGISTRY_FILE3"
  touch "${REGISTRY_FILE3}.lock"
  chmod 0444 "${REGISTRY_FILE3}.lock"
  export KONDUCTOR_MUX_REGISTRY_DIR="$REGISTRY_DIR3"

  ro_err=$(TMUX="fake-session" TMUX_PANE="not-this-one" bash "$CLOSE_SCRIPT" --workspace-id ws-ro 2>&1)
  chmod 0644 "${REGISTRY_FILE3}.lock"
  if [[ "$ro_err" == *"CLOSED workspace=ws-ro"* \
        && "$ro_err" == *"WARNING: pane closed but failed to acquire the registry lock"* ]]; then
    log_pass "--workspace-id finds and closes an entry when the registry lock file itself is read-only (the lookup/read no longer requires write permission on it; the removal write against the same still-read-only lock file correctly still reports its own, already-covered warning)"
  else
    log_fail "--workspace-id could not read a registry with a read-only lock file (expected the lookup+close to succeed, with the write's own separate warning after); got: $ro_err"
  fi

  # Same coverage for --all, which goes through load_registry_entries()
  # rather than the --workspace-id lookup block above -- a separate call
  # site with its own (previously separately-broken) lock-open call, so it
  # needs its own assertion rather than assuming the --workspace-id fix
  # covers it too.
  REGISTRY_DIR4="$WORKDIR/registry4"
  REGISTRY_FILE4="${REGISTRY_DIR4}/dispatched.json"
  mkdir -p "$REGISTRY_DIR4"
  echo '[{"workspace_id":"ws-ro-all","pane_id":"%1","backend":"tmux","session":""}]' > "$REGISTRY_FILE4"
  touch "${REGISTRY_FILE4}.lock"
  chmod 0444 "${REGISTRY_FILE4}.lock"
  export KONDUCTOR_MUX_REGISTRY_DIR="$REGISTRY_DIR4"

  ro_all_err=$(TMUX="fake-session" TMUX_PANE="not-this-one" bash "$CLOSE_SCRIPT" --all 2>&1)
  chmod 0644 "${REGISTRY_FILE4}.lock"
  if [[ "$ro_all_err" == *"CLOSED workspace=ws-ro-all"* \
        && "$ro_all_err" == *"WARNING: pane closed but failed to acquire the registry lock"* ]]; then
    log_pass "--all lists and closes an entry when the registry lock file itself is read-only (load_registry_entries's lookup/read no longer requires write permission on it; the removal write's own, already-covered warning still appears after)"
  else
    log_fail "--all could not read a registry with a read-only lock file (expected the listing+close to succeed, with the write's own separate warning after); got: $ro_all_err"
  fi
fi

# ---------------------------------------------------------------------------
# Test 5 (AutoSDE finding f-6641ecbb): none of mux-close-pane.sh's three
# registry-reading python blocks previously guarded against a registry file
# whose top level is valid JSON but not a list. Use a non-empty JSON OBJECT
# ('{"a": 1}'), not '{}' -- an empty dict/`{}` has zero keys, so iterating
# it (or a list-comprehension over it) raises nothing and silently no-ops,
# masking the exact bug this guard exists to catch. A non-empty object's
# single key ("a", a plain string) is what actually reproduces the
# pre-fix AttributeError when the code calls e.get(...) on it.
# ---------------------------------------------------------------------------
MALFORMED_REGISTRY='{"a": 1}'

# 5a: load_registry_entries() (the --all path) must reset gracefully and
# report "nothing to close", not leak a traceback.
REGISTRY_DIR5A="$WORKDIR/registry5a"
REGISTRY_FILE5A="${REGISTRY_DIR5A}/dispatched.json"
mkdir -p "$REGISTRY_DIR5A"
printf '%s' "$MALFORMED_REGISTRY" > "$REGISTRY_FILE5A"
export KONDUCTOR_MUX_REGISTRY_DIR="$REGISTRY_DIR5A"

all_malformed_out=$(TMUX="fake-session" bash "$CLOSE_SCRIPT" --all 2>&1)
all_malformed_rc=$?
if [[ "$all_malformed_rc" -eq 0 \
      && "$all_malformed_out" != *"Traceback (most recent call last)"* \
      && "$all_malformed_out" == *"Registry is empty; nothing to close"* ]]; then
  log_pass "--all resets a non-list registry gracefully (no traceback, 'nothing to close') instead of crashing in load_registry_entries()"
else
  log_fail "--all did not handle a non-list registry gracefully (rc=$all_malformed_rc); got: $all_malformed_out"
fi

# 5b: the --workspace-id lookup block must reset gracefully and report
# "not found" (the pre-existing not-found path), not leak a traceback.
REGISTRY_DIR5B="$WORKDIR/registry5b"
REGISTRY_FILE5B="${REGISTRY_DIR5B}/dispatched.json"
mkdir -p "$REGISTRY_DIR5B"
printf '%s' "$MALFORMED_REGISTRY" > "$REGISTRY_FILE5B"
export KONDUCTOR_MUX_REGISTRY_DIR="$REGISTRY_DIR5B"

lookup_malformed_out=$(TMUX="fake-session" bash "$CLOSE_SCRIPT" --workspace-id anything 2>&1)
lookup_malformed_rc=$?
if [[ "$lookup_malformed_rc" -eq 1 \
      && "$lookup_malformed_out" != *"Traceback (most recent call last)"* \
      && "$lookup_malformed_out" == *"not found in registry"* ]]; then
  log_pass "--workspace-id resets a non-list registry gracefully (no traceback, 'not found in registry') instead of crashing in the lookup block"
else
  log_fail "--workspace-id did not handle a non-list registry gracefully (rc=$lookup_malformed_rc); got: $lookup_malformed_out"
fi

# 5c: close_pane()'s own removal read (its list comprehension over the
# registry). Only reachable after a successful --workspace-id lookup finds
# a real entry, so seed a valid registry and swap it to malformed content
# from inside the mocked "tmux kill-pane" call -- which close_pane() always
# invokes strictly before its own registry-removal read -- rather than
# racing a background writer against this single-threaded script. No chmod
# involved, so (unlike Tests 3/4) this needs no root guard.
REGISTRY_DIR5C="$WORKDIR/registry5c"
REGISTRY_FILE5C="${REGISTRY_DIR5C}/dispatched.json"
mkdir -p "$REGISTRY_DIR5C"
echo '[{"workspace_id":"ws-malformed-removal","pane_id":"%1","backend":"tmux","session":""}]' > "$REGISTRY_FILE5C"
export KONDUCTOR_MUX_REGISTRY_DIR="$REGISTRY_DIR5C"

MOCK_BIN5C="$WORKDIR/bin5c"
mkdir -p "$MOCK_BIN5C"
cat > "$MOCK_BIN5C/tmux" <<MOCKEOF
#!/usr/bin/env bash
case "\$1" in
  kill-pane)
    printf '%s' '$MALFORMED_REGISTRY' > "$REGISTRY_FILE5C"
    exit 0
    ;;
  *) echo "MOCK tmux: unhandled subcommand: \$1" >&2; exit 1 ;;
esac
MOCKEOF
chmod +x "$MOCK_BIN5C/tmux"

removal_malformed_out=$(PATH="$MOCK_BIN5C:$PATH" TMUX="fake-session" TMUX_PANE="not-this-one" \
  bash "$CLOSE_SCRIPT" --workspace-id ws-malformed-removal 2>&1)
removal_malformed_rc=$?
if [[ "$removal_malformed_rc" -eq 0 \
      && "$removal_malformed_out" != *"Traceback (most recent call last)"* \
      && "$removal_malformed_out" == *"CLOSED workspace=ws-malformed-removal"* ]]; then
  log_pass "close_pane()'s removal read resets a non-list registry gracefully (no traceback) after the entry is closed"
else
  log_fail "close_pane()'s removal read did not handle a non-list registry gracefully (rc=$removal_malformed_rc); got: $removal_malformed_out"
fi

echo
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
