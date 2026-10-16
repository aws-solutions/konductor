#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# mux-close-pane.sh — Safely close a dispatched child pane from the orchestrator.
# Usage: bash mux-close-pane.sh [--workspace-id <id>] [--pane-id <id>] [--all]
#
# Auto-detects tmux or zellij backend. Looks up pane from registry or accepts direct pane ID.
# Idempotent: if the pane is already gone, exits 0 with a warning.
# Safety: never closes the current pane.
set -euo pipefail

WORKSPACE_ID="" PANE_ID_ARG="" CLOSE_ALL=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace-id) WORKSPACE_ID="$2"; shift 2 ;;
    --pane-id)      PANE_ID_ARG="$2"; shift 2 ;;
    --all)          CLOSE_ALL=true; shift ;;
    *) echo "ERROR: Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Require at least one targeting argument
if [[ -z "$WORKSPACE_ID" && -z "$PANE_ID_ARG" && "$CLOSE_ALL" == false ]]; then
  echo "ERROR: One of --workspace-id, --pane-id, or --all is required" >&2
  exit 1
fi

# Backend detection
if [[ -n "${TMUX:-}" ]]; then
  BACKEND="tmux"
elif [[ -n "${ZELLIJ:-}" ]]; then
  BACKEND="zellij"
else
  echo "ERROR: Not running inside tmux or zellij" >&2
  exit 1
fi

# Restore real TMPDIR for zellij (same fix as zellij-dispatch.sh lines 40-41)
if [[ "$BACKEND" == "zellij" ]]; then
  REAL_TMPDIR=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || echo "${TMPDIR:-/tmp}")
  export TMPDIR="$REAL_TMPDIR"

  SESSION="${ZELLIJ_SESSION_NAME:-}"
  if [[ -z "$SESSION" ]]; then
    SESSION=$(zellij list-sessions --short 2>/dev/null | head -1)
  fi
  [[ -z "$SESSION" ]] && { echo "ERROR: no live zellij session found" >&2; exit 1; }
fi

# KONDUCTOR_MUX_REGISTRY_DIR lets tests point at an isolated directory
# instead of the real shared production registry; unset (the default) for
# every real usage. Must match tmux-dispatch.sh/zellij-dispatch.sh's default
# and override so this script locks/reads the same registry they write.
REGISTRY_DIR="${KONDUCTOR_MUX_REGISTRY_DIR:-/tmp/konductor-mux}"
REGISTRY_FILE="$REGISTRY_DIR/dispatched.json"
# Sibling lock file guarding the read-modify-write in close_pane() below.
# tmux-dispatch.sh and zellij-dispatch.sh share the same $REGISTRY_DIR and
# lock this exact path too, so an append there and a removal here never
# interleave (flock creates it on demand; the lock is released when the
# wrapped process exits).
REGISTRY_LOCK="$REGISTRY_FILE.lock"

# ---------------------------------------------------------------------------
# close_pane <workspace_id_or_empty> <pane_id> <backend> [session_or_empty]
# Closes a single pane and cleans up registry + associated files. `session`
# (4th arg) is the zellij session recorded in the registry entry, when
# available; legacy entries without it fall back to the detected $SESSION.
# ---------------------------------------------------------------------------
close_pane() {
  local ws_id="$1"
  local pane_id="$2"
  local entry_backend="$3"
  local entry_session="${4:-}"

  # Safety: never close the current pane
  if [[ "$BACKEND" == "tmux" ]]; then
    if [[ "$pane_id" == "${TMUX_PANE:-}" ]]; then
      echo "WARNING: Refusing to close current tmux pane ($pane_id)" >&2
      return 0
    fi
  elif [[ "$BACKEND" == "zellij" ]]; then
    if [[ -n "${ZELLIJ_PANE_ID:-}" ]]; then
      if [[ "$pane_id" == "$ZELLIJ_PANE_ID" ]]; then
        echo "WARNING: Refusing to close current zellij pane ($pane_id)" >&2
        return 0
      fi
    else
      echo "WARNING: \$ZELLIJ_PANE_ID not set; skipping current-pane safety check" >&2
    fi
  fi

  # Execute close command
  if [[ "$BACKEND" == "tmux" ]]; then
    if ! tmux kill-pane -t "$pane_id" 2>/dev/null; then
      echo "WARNING: tmux pane $pane_id not found (already closed?)" >&2
    else
      echo "CLOSED workspace=${ws_id:-<direct>} pane=$pane_id backend=tmux"
    fi
  elif [[ "$BACKEND" == "zellij" ]]; then
    # Extract numeric id from e.g. "terminal_1" -> "1"
    local numeric_id="${pane_id#terminal_}"
    # Prefer the session recorded in the registry entry (pane IDs are not
    # unique across concurrent zellij sessions); fall back to the
    # environment/current-session detection above for legacy entries that
    # predate the `session` field.
    local target_session="${entry_session:-$SESSION}"
    if ! zellij --session "$target_session" action close-pane --pane-id "$numeric_id" 2>/dev/null; then
      echo "WARNING: zellij pane $pane_id not found (already closed?)" >&2
    else
      echo "CLOSED workspace=${ws_id:-<direct>} pane=$pane_id backend=zellij session=$target_session"
    fi
  fi

  # Cleanup associated files
  if [[ -n "$ws_id" ]]; then
    rm -f "$REGISTRY_DIR/launcher-${ws_id}.sh" \
           "$REGISTRY_DIR/task-text-${ws_id}.txt" \
           "$REGISTRY_DIR/${ws_id}.done" 2>/dev/null || true
  fi

  # Remove entry from registry (only when we have a workspace_id)
  # fcntl.flock (stdlib, POSIX -- works on both macOS and Linux, unlike the
  # util-linux `flock` binary which macOS doesn't ship) serializes this
  # read-modify-write against concurrent tmux-dispatch.sh/zellij-dispatch.sh
  # appends to the same $REGISTRY_FILE.
  if [[ -n "$ws_id" && -f "$REGISTRY_FILE" ]]; then
    WS_ID_TO_REMOVE="$ws_id" REGISTRY_FILE="$REGISTRY_FILE" REGISTRY_LOCK="$REGISTRY_LOCK" \
    python3 -c "
import json, os, sys, fcntl, tempfile
reg_file = os.environ['REGISTRY_FILE']
ws_id = os.environ['WS_ID_TO_REMOVE']
try:
    lock = open(os.environ['REGISTRY_LOCK'], 'w')
except OSError as e:
    print(f'ERROR: cannot open registry lock file {os.environ[\"REGISTRY_LOCK\"]}: {e}', file=sys.stderr)
    sys.exit(2)
with lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        with open(reg_file) as f:
            registry = json.load(f)
        # A syntactically-valid JSON document whose top level isn't a list
        # (e.g. '{}') would pass json.load() but blow up on the list
        # comprehension below with an uncaught AttributeError/TypeError --
        # treat that the same as unreadable/malformed content instead of
        # letting it raise.
        if not isinstance(registry, list):
            raise ValueError('registry file does not contain a JSON array')
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        registry = []
    # A list whose top level is valid but whose elements aren't all dicts
    # (e.g. '[1, 2]') passes the isinstance(registry, list) check above but
    # still blows up on e.get(...) below with an uncaught AttributeError --
    # drop any non-dict element rather than letting it raise.
    registry = [e for e in registry if isinstance(e, dict)]
    registry = [e for e in registry if e.get('workspace_id') != ws_id]
    # Write to a sibling temp file and rename it into place instead of
    # truncating reg_file directly -- see tmux-dispatch.sh's identical
    # comment for why: open(reg_file, 'w') truncates immediately, so a
    # failure partway through json.dump would leave a corrupt/empty file
    # that every reader here treats as an empty registry, silently
    # discarding every remaining entry. os.replace() is an atomic rename.
    tmp_path = None
    try:
        dir_name = os.path.dirname(reg_file) or '.'
        fd, tmp_path = tempfile.mkstemp(dir=dir_name)
        with os.fdopen(fd, 'w') as f:
            json.dump(registry, f, indent=2)
        os.replace(tmp_path, reg_file)
    except OSError as e:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        print(f'ERROR: cannot write registry file {reg_file}: {e}', file=sys.stderr)
        sys.exit(3)
" && reg_write_rc=0 || reg_write_rc=$?
    # && / || above (not a bare trailing command) so `set -e` doesn't abort
    # the whole close on a registry-write failure -- the pane is already
    # closed by this point; only the registry bookkeeping failed.
    if [[ "$reg_write_rc" -eq 2 ]]; then
      echo "WARNING: pane closed but failed to acquire the registry lock -- stale entry may remain in $REGISTRY_FILE pointing at a dead pane (registry directory may be missing or unwritable)" >&2
    elif [[ "$reg_write_rc" -ne 0 ]]; then
      echo "WARNING: Failed to update registry after close" >&2
    fi
  fi
}

# ---------------------------------------------------------------------------
# Load entries from registry for workspace-id or --all targeting
# ---------------------------------------------------------------------------
load_registry_entries() {
  # Emits lines of: <workspace_id> <pane_id> <backend> <session-or-empty>
  # `session` is absent on legacy entries recorded before the field was
  # added; those print a trailing empty field and fall back to
  # environment/current-session detection in close_pane.
  # Takes a shared (LOCK_SH) lock so this read never observes a half-written
  # file mid-truncate from a concurrent close_pane()/dispatch-script write
  # (which holds LOCK_EX) -- an unlocked read hitting that window would see
  # a JSONDecodeError and silently fall back to an empty registry.
  #
  # Stderr is NOT suppressed here (unlike the write path below): a failure
  # to open/acquire the lock (e.g. registry dir missing or unwritable) exits
  # 2 with a distinct message on stderr, rather than being caught by the
  # (FileNotFoundError, JSONDecodeError) fallback and silently reported as
  # an empty registry -- and `set -e` aborts the caller on that exit 2
  # instead of proceeding as if there was simply nothing to close.
  REGISTRY_FILE="$REGISTRY_FILE" REGISTRY_LOCK="$REGISTRY_LOCK" python3 -c "
import json, os, sys, fcntl
reg_file = os.environ['REGISTRY_FILE']
# Open the lock file read-only when it already exists: 'r' needs no write
# permission on the file or the registry directory, so a pure read of an
# already-populated registry still works against a read-only directory
# (e.g. a defensive read-only mount). Only fall back to 'w' (which creates
# the lock file) the first time it doesn't exist yet -- flock() works the
# same on a read-only fd, since the lock is advisory and keyed by inode,
# not by the fd's open mode.
try:
    lock = open(os.environ['REGISTRY_LOCK'], 'r')
except FileNotFoundError:
    try:
        lock = open(os.environ['REGISTRY_LOCK'], 'w')
    except OSError as e:
        print(f'ERROR: cannot open registry lock file {os.environ[\"REGISTRY_LOCK\"]}: {e}', file=sys.stderr)
        sys.exit(2)
except OSError as e:
    print(f'ERROR: cannot open registry lock file {os.environ[\"REGISTRY_LOCK\"]}: {e}', file=sys.stderr)
    sys.exit(2)
with lock:
    fcntl.flock(lock, fcntl.LOCK_SH)
    try:
        with open(reg_file) as f:
            registry = json.load(f)
        # A syntactically-valid JSON document whose top level isn't a list
        # (e.g. '{}') would pass json.load() but blow up on the 'for e in
        # registry' loop below with an uncaught AttributeError -- treat
        # that the same as unreadable/malformed content instead of
        # letting it raise.
        if not isinstance(registry, list):
            raise ValueError('registry file does not contain a JSON array')
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        registry = []
for e in registry:
    # A list whose top level is valid but whose elements aren't all dicts
    # (e.g. '[1, 2]') passes the isinstance(registry, list) check above but
    # still blows up on e.get(...) below with an uncaught AttributeError --
    # skip any non-dict element rather than letting it raise.
    if not isinstance(e, dict):
        continue
    ws   = e.get('workspace_id', '')
    pid  = e.get('pane_id', '')
    be   = e.get('backend', '')
    sess = e.get('session', '')
    if ws and pid and be:
        print(ws + ' ' + pid + ' ' + be + ' ' + sess)
"
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

if [[ "$CLOSE_ALL" == true ]]; then
  # Close every entry in the registry
  if [[ ! -f "$REGISTRY_FILE" ]]; then
    echo "WARNING: Registry file not found; nothing to close" >&2
    exit 0
  fi
  # set +e/-e bracket -- same reasoning as the --workspace-id lookup below:
  # load_registry_entries exits 2 on a lock-open failure (stderr is not
  # suppressed there), and under `set -e` that would abort this whole
  # script with a raw python ERROR line and exit 2, instead of the same
  # distinct message + exit 1 the --workspace-id path gives for the
  # identical failure.
  set +e
  entries=$(load_registry_entries)
  load_rc=$?
  set -e
  if [[ "$load_rc" -eq 2 ]]; then
    echo "ERROR: failed to acquire registry lock while listing entries for --all (registry directory may be missing or unwritable)" >&2
    exit 1
  elif [[ -z "$entries" ]]; then
    echo "WARNING: Registry is empty; nothing to close" >&2
    exit 0
  fi
  while IFS=' ' read -r ws pid be sess; do
    # Validate backend matches current environment
    if [[ "$be" != "$BACKEND" ]]; then
      echo "WARNING: Skipping workspace=$ws — registered backend=$be but current backend=$BACKEND" >&2
      continue
    fi
    close_pane "$ws" "$pid" "$be" "$sess"
  done <<< "$entries"

elif [[ -n "$WORKSPACE_ID" ]]; then
  # Look up pane from registry by workspace-id
  if [[ ! -f "$REGISTRY_FILE" ]]; then
    echo "ERROR: Registry file not found: $REGISTRY_FILE" >&2
    exit 1
  fi
  # Shared (LOCK_SH) lock -- same reasoning as load_registry_entries above.
  # Exit codes distinguish "not found" (1, the pre-existing case) from a
  # lock/registry-access failure (2, new): a lock-open error is NOT caught
  # by the (FileNotFoundError, JSONDecodeError) fallback, so it must not be
  # collapsed into the same generic "not found" message below -- that would
  # misreport an infrastructure error (can't acquire the lock) as if the
  # workspace_id simply doesn't exist.
  set +e
  result=$(WORKSPACE_ID="$WORKSPACE_ID" REGISTRY_FILE="$REGISTRY_FILE" REGISTRY_LOCK="$REGISTRY_LOCK" python3 -c "
import json, os, sys, fcntl
reg_file = os.environ['REGISTRY_FILE']
ws_id = os.environ['WORKSPACE_ID']
# Open the lock file read-only when it already exists -- see
# load_registry_entries's identical comment above for why: 'r' needs no
# write permission on the file or the registry directory, so a pure
# lookup still works against a read-only directory.
try:
    lock = open(os.environ['REGISTRY_LOCK'], 'r')
except FileNotFoundError:
    try:
        lock = open(os.environ['REGISTRY_LOCK'], 'w')
    except OSError as e:
        print(f'ERROR: cannot open registry lock file {os.environ[\"REGISTRY_LOCK\"]}: {e}', file=sys.stderr)
        sys.exit(2)
except OSError as e:
    print(f'ERROR: cannot open registry lock file {os.environ[\"REGISTRY_LOCK\"]}: {e}', file=sys.stderr)
    sys.exit(2)
with lock:
    fcntl.flock(lock, fcntl.LOCK_SH)
    try:
        with open(reg_file) as f:
            registry = json.load(f)
        # A syntactically-valid JSON document whose top level isn't a list
        # (e.g. '{}') would pass json.load() but blow up on the 'for e in
        # registry' loop below with an uncaught AttributeError -- treat
        # that the same as unreadable/malformed content instead of
        # letting it raise.
        if not isinstance(registry, list):
            raise ValueError('registry file does not contain a JSON array')
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        registry = []
for e in registry:
    # A list whose top level is valid but whose elements aren't all dicts
    # (e.g. '[1, 2]') passes the isinstance(registry, list) check above but
    # still blows up on e.get(...) below with an uncaught AttributeError --
    # skip any non-dict element rather than letting it raise (an
    # AutoSDE-style type-safety gap caught in code review).
    if not isinstance(e, dict):
        continue
    if e.get('workspace_id') == ws_id:
        print(e.get('pane_id', '') + ' ' + e.get('backend', '') + ' ' + e.get('session', ''))
        sys.exit(0)
# Not found
sys.exit(1)
")
  lookup_rc=$?
  set -e
  if [[ "$lookup_rc" -eq 2 ]]; then
    echo "ERROR: failed to acquire registry lock while looking up workspace_id=$WORKSPACE_ID (registry directory may be missing or unwritable)" >&2
    exit 1
  elif [[ "$lookup_rc" -ne 0 ]]; then
    echo "ERROR: workspace_id=$WORKSPACE_ID not found in registry" >&2
    exit 1
  fi

  REG_PANE_ID=$(echo "$result" | awk '{print $1}')
  REG_BACKEND=$(echo "$result"  | awk '{print $2}')
  REG_SESSION=$(echo "$result"  | awk '{print $3}')

  if [[ "$REG_BACKEND" != "$BACKEND" ]]; then
    echo "ERROR: workspace=$WORKSPACE_ID was dispatched with backend=$REG_BACKEND but current backend=$BACKEND" >&2
    exit 1
  fi

  close_pane "$WORKSPACE_ID" "$REG_PANE_ID" "$REG_BACKEND" "$REG_SESSION"

elif [[ -n "$PANE_ID_ARG" ]]; then
  # Direct pane-id targeting (no registry lookup, no registry cleanup)
  close_pane "" "$PANE_ID_ARG" "$BACKEND"
fi
