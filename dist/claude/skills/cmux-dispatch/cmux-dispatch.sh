#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# cmux-dispatch.sh — Dispatch a task to a kiro-cli agent in a cmux tab, split, or workspace.
# Usage: bash cmux-dispatch.sh --agent <name> --task "description" [options]
#
# Modes: split right (default), --split down, --tab, --workspace
# Flags: --name, --cwd, --close, --interactive
#
# Features:
#   - Readiness polling: waits for shell init before sending kiro command
#   - Dispatch registry: tracks spawned workspaces in /tmp/konductor-cmux/dispatched.json
#   - Completion hook: child agents write .done files via cmux-completion-hook.sh
set -euo pipefail

AGENT="" TASK="" CWD="" NAME="" MODE="split" SPLIT_DIR="right" CLOSE=false INTERACTIVE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)       AGENT="$2"; shift 2 ;;
    --task)        TASK="$2"; shift 2 ;;
    --name)        NAME="$2"; shift 2 ;;
    --cwd)         CWD="$2"; shift 2 ;;
    --workspace)   MODE="workspace"; shift ;;
    --tab)         MODE="tab"; shift ;;
    --split)
      MODE="split"
      if [[ -n "${2:-}" && "$2" != --* ]]; then
        SPLIT_DIR="$2"; shift 2
      else
        SPLIT_DIR="right"; shift
      fi ;;
    --close)       CLOSE=true; shift ;;
    --interactive) INTERACTIVE=true; shift ;;
    *) echo "ERROR: Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$AGENT" ]] && { echo "ERROR: --agent required" >&2; exit 1; }
[[ -z "$TASK" ]]  && { echo "ERROR: --task required" >&2; exit 1; }
# AGENT is used verbatim -- the caller (orchestrator routing table) is the
# single source of truth for the fully-qualified agent name (e.g. 'k-developer').
# This script never adds or strips a role prefix.
[[ "$AGENT" =~ ^[a-z0-9-]+$ ]] || { echo "ERROR: --agent must be alphanumeric/hyphens only" >&2; exit 1; }
CMUX_BIN="${CMUX_BIN:-/Applications/cmux.app/Contents/MacOS/cmux}"
[[ -x "$CMUX_BIN" ]] || { echo "ERROR: cmux binary not found or not executable (set CMUX_BIN to override)" >&2; exit 1; }
cmux() { "$CMUX_BIN" "$@"; }

LABEL="${NAME:-$AGENT: $(echo "$TASK" | head -c 40)}"
WS_ID="${CMUX_WORKSPACE_ID:-}"
# KONDUCTOR_CMUX_REGISTRY_DIR lets tests point at an isolated directory
# instead of the real shared production registry; unset (the default) for
# every real dispatch.
REGISTRY_DIR="${KONDUCTOR_CMUX_REGISTRY_DIR:-/tmp/konductor-cmux}"
REGISTRY_FILE="$REGISTRY_DIR/dispatched.json"
# Sibling lock file guarding the read-modify-write of $REGISTRY_FILE below,
# so concurrent cmux-dispatch.sh invocations serialize instead of racing on
# the shared registry (flock creates it on demand; the lock is released when
# the wrapped process exits).
REGISTRY_LOCK="$REGISTRY_FILE.lock"

# --- Readiness polling ---
wait_for_shell() {
  local flag="$1" id="$2" max_wait="${3:-10}"
  for i in $(seq 1 "$max_wait"); do
    local screen
    screen=$(cmux read-screen "$flag" "$id" 2>/dev/null | tr -d '[:space:]')
    [ -n "$screen" ] && return 0
    sleep 1
  done
  echo "WARNING: surface not ready after ${max_wait}s — sending anyway" >&2
  return 0
}

# Create surface based on mode
case "$MODE" in
  workspace)
    WS_OUTPUT=$(cmux new-workspace --name "$LABEL" ${CWD:+--cwd "$CWD"} 2>&1)
    WS_ID=$(echo "$WS_OUTPUT" | grep -o 'workspace:[0-9]*')
    [[ -z "$WS_ID" ]] && { echo "ERROR: Failed to create workspace: $WS_OUTPUT" >&2; exit 1; }
    SURFACE_OUTPUT=$(cmux list-pane-surfaces --workspace "$WS_ID" 2>&1)
    SURFACE_ID=$(echo "$SURFACE_OUTPUT" | grep -o 'surface:[0-9]*' | head -1)
    ;;
  split)
    SURFACE_OUTPUT=$(cmux new-split "${SPLIT_DIR}" 2>&1)
    SURFACE_ID=$(echo "$SURFACE_OUTPUT" | grep -o 'surface:[0-9]*' | head -1)
    cmux rpc workspace.equalize_splits '{}' >/dev/null 2>&1 || true
    ;;
  tab)
    SURFACE_OUTPUT=$(cmux new-surface 2>&1)
    SURFACE_ID=$(echo "$SURFACE_OUTPUT" | grep -o 'surface:[0-9]*' | head -1)
    cmux rename-tab --surface "$SURFACE_ID" "$LABEL" 2>/dev/null || true
    ;;
esac
[[ -z "$SURFACE_ID" ]] && { echo "ERROR: No surface: ${SURFACE_OUTPUT}" >&2; exit 1; }

# Derive unique-per-dispatch key from surface id (surface:3 -> surface_3)
DONE_KEY=$(printf '%s' "$SURFACE_ID" | tr -c 'A-Za-z0-9._-' '_')

# Write task to file — no escaping needed (mirrors zellij/tmux)
mkdir -p "$REGISTRY_DIR"
TASK_FILE="$REGISTRY_DIR/task-${DONE_KEY}.txt"
printf '%s' "$TASK" > "$TASK_FILE"

# Wait for shell to be ready before sending command
wait_for_shell --surface "$SURFACE_ID"

# Build command — runtime branch: claude CLI on Claude Code, kiro-cli otherwise
CMD_PREFIX=""
if [[ -n "$CWD" && "$MODE" != "workspace" ]]; then
  CMD_PREFIX="cd $(printf '%q' "$CWD") && "
fi
# Forward the orchestrator's override (if set) into the dispatched surface --
# this env var does not otherwise cross into the separate cmux session.
if [[ -n "${WORKTREE_PROVISION_CMD:-}" ]]; then
  CMD_PREFIX="${CMD_PREFIX}export WORKTREE_PROVISION_CMD=$(printf '%q' "$WORKTREE_PROVISION_CMD") && "
fi

if [ -n "${CLAUDECODE:-}" ]; then
  # Prefix derivation: search for any locally-installed agent file ending in
  # "-${AGENT}.md". No package name is hardcoded, so this works for any
  # package (including ones added or renamed later) without a script change.
  # local- installs are a preferred tier over registry installs; within a
  # tier, 2+ matches means the caller passed a partially-qualified name that
  # is ambiguous (e.g. "orchestrator" matching both "konductor-mux-orchestrator" and
  # "konductor-cmux-orchestrator") -- error instead of silently picking one by
  # glob order. FOUND is tracked separately from PREFIX so a legitimate
  # empty prefix (a hypothetical prefix-less "<agent>.md" install) is not
  # mistaken for "not found".
  PREFIX="" FOUND="" AMBIGUOUS=""
  LOCAL_MATCHES=()
  for f in "$HOME"/.claude/agents/local-*-"${AGENT}".md; do
    [ -f "$f" ] || continue
    LOCAL_MATCHES+=("$f")
  done
  if [ "${#LOCAL_MATCHES[@]}" -eq 1 ]; then
    base=$(basename "${LOCAL_MATCHES[0]}" .md)
    PREFIX="${base%"${AGENT}"}"
    FOUND=1
  elif [ "${#LOCAL_MATCHES[@]}" -gt 1 ]; then
    AMBIGUOUS="${LOCAL_MATCHES[*]}"
  else
    REGISTRY_MATCHES=()
    for f in "$HOME"/.claude/agents/*-"${AGENT}".md; do
      [ -f "$f" ] || continue
      case "$(basename "$f")" in
        local-*) continue ;;
      esac
      REGISTRY_MATCHES+=("$f")
    done
    if [ "${#REGISTRY_MATCHES[@]}" -eq 1 ]; then
      base=$(basename "${REGISTRY_MATCHES[0]}" .md)
      PREFIX="${base%"${AGENT}"}"
      FOUND=1
    elif [ "${#REGISTRY_MATCHES[@]}" -gt 1 ]; then
      AMBIGUOUS="${REGISTRY_MATCHES[*]}"
    elif [ -f "$HOME/.claude/agents/${AGENT}.md" ]; then
      # Bare, no-prefix install
      PREFIX=""
      FOUND=1
    fi
  fi
  if [ -n "$AMBIGUOUS" ]; then
    echo "ERROR: --agent ${AGENT} matches multiple installed agents; pass a fully-qualified name. Candidates: $AMBIGUOUS" >&2
    mkdir -p "$REGISTRY_DIR"
    python3 -c "import json; json.dump({'workspace_id':'${WS_ID:-$DONE_KEY}','status':'error','summary':'ambiguous agent name'},open('${REGISTRY_DIR}/${DONE_KEY}.done','w'))"
    cmux close-surface --surface "$SURFACE_ID" 2>/dev/null || true
    exit 1
  fi
  if [ -z "$FOUND" ]; then
    echo "ERROR: claude agent ${AGENT} not installed under ~/.claude/agents (checked local-/registry installs); not dispatching" >&2
    mkdir -p "$REGISTRY_DIR"
    python3 -c "import json; json.dump({'workspace_id':'${WS_ID:-$DONE_KEY}','status':'error','summary':'agent not installed'},open('${REGISTRY_DIR}/${DONE_KEY}.done','w'))"
    cmux close-surface --surface "$SURFACE_ID" 2>/dev/null || true
    exit 1
  fi
  # Fix 1: bake resolved WS_ID at dispatch time — no in-pane parameter expansion
  # Fall back to DONE_KEY when WS_ID is empty (split/tab mode has no workspace id)
  RECORDED_WS_ID="${WS_ID:-$DONE_KEY}"
  # DONE_FILE and the mkdir below derive from $REGISTRY_DIR (already
  # resolved from KONDUCTOR_CMUX_REGISTRY_DIR above) rather than a
  # hardcoded /tmp/konductor-cmux literal, so a test pointed at an
  # isolated registry dir never leaks a .done file into the real one.
  DONE_FILE="${REGISTRY_DIR}/${DONE_KEY}.done"
  PANE_CMD="${CMD_PREFIX}claude --agent \"${PREFIX}${AGENT}\" --dangerously-skip-permissions -p \"\$(cat '${TASK_FILE}')\""
  # Fix 2: capture claude exit code; set status done/error to mirror tmux/zellij
  PANE_CMD="${PANE_CMD} ; ec=\$? ; st=done ; [ \"\$ec\" != 0 ] && st=error"
  PANE_CMD="${PANE_CMD} ; mkdir -p '${REGISTRY_DIR}' && python3 -c \"import json; f=open('${DONE_FILE}','w'); json.dump({'workspace_id':'${RECORDED_WS_ID}','status':'\$st','summary':'claude exit'},f)\""
else
  # kiro-cli: no filesystem resolution needed -- kiro-cli resolves --agent
  # against its own registry and warns on collisions itself. Unlike Claude
  # Code, kiro agents aren't looked up by a package-prefixed filename this
  # script would have to reconstruct, so AGENT is passed through as-is.
  if [[ "$INTERACTIVE" == true ]]; then
    PANE_CMD="${CMD_PREFIX}export ASDLC_DONE_KEY=\"${DONE_KEY}\" ; kiro-cli chat --agent \"$AGENT\" --trust-all-tools \"\$(cat '${TASK_FILE}')\""
  else
    PANE_CMD="${CMD_PREFIX}export ASDLC_DONE_KEY=\"${DONE_KEY}\" ; kiro-cli chat --agent \"$AGENT\" --no-interactive --trust-all-tools \"\$(cat '${TASK_FILE}')\""
  fi
  # Write .done fallback for kiro-cli path (mirrors Claude Code branch); cmux-completion-hook.sh
  # writes the file on clean stop, but this guarantees completion detection on abnormal exit too.
  # Derived from $REGISTRY_DIR (see comment on the claude branch above) for
  # the same isolation reason.
  DONE_FILE="${REGISTRY_DIR}/${DONE_KEY}.done"
  PANE_CMD="${PANE_CMD} ; ec=\$? ; st=done ; [ \"\$ec\" != 0 ] && st=error"
  PANE_CMD="${PANE_CMD} ; [ ! -f '${DONE_FILE}' ] && mkdir -p '${REGISTRY_DIR}' && python3 -c \"import json; f=open('${DONE_FILE}','w'); json.dump({'workspace_id':'${WS_ID:-$DONE_KEY}','status':'\$st','summary':'shell fallback'},f)\""
fi
# Append close for both runtimes when --close is set
[[ "$CLOSE" == true ]] && PANE_CMD="$PANE_CMD ; cmux close-surface --surface \"$SURFACE_ID\" 2>/dev/null || exit"

cmux send ${WS_ID:+--workspace "$WS_ID"} --surface "$SURFACE_ID" -- "$PANE_CMD"
cmux send-key ${WS_ID:+--workspace "$WS_ID"} --surface "$SURFACE_ID" enter

# --- Record dispatch in registry ---
# fcntl.flock (stdlib, POSIX -- works on both macOS and Linux, unlike the
# util-linux `flock` binary which macOS doesn't ship) serializes this
# read-modify-write against every other concurrent cmux-dispatch.sh
# invocation writing the same $REGISTRY_FILE.
mkdir -p "$REGISTRY_DIR"
TASK_SUMMARY=$(echo "$TASK" | head -c 100)
ENTRY=$(ASDLC_WS_ID="$WS_ID" \
  ASDLC_SURFACE_ID="$SURFACE_ID" \
  ASDLC_AGENT="$AGENT" \
  ASDLC_TASK_SUMMARY="$TASK_SUMMARY" \
  ASDLC_MODE="$MODE" \
  ASDLC_CWD="${CWD:-}" \
  ASDLC_REGISTRY_FILE="$REGISTRY_FILE" \
  ASDLC_REGISTRY_LOCK="$REGISTRY_LOCK" \
  ASDLC_DONE_KEY="$DONE_KEY" \
  python3 -c "
import json, os, sys, fcntl, tempfile
entry = {
    'workspace_id': os.environ['ASDLC_WS_ID'],
    'surface_id': os.environ['ASDLC_SURFACE_ID'],
    'agent': os.environ['ASDLC_AGENT'],
    'task_summary': os.environ['ASDLC_TASK_SUMMARY'],
    'mode': os.environ['ASDLC_MODE'],
    'cwd': os.environ['ASDLC_CWD'],
    'done_key': os.environ['ASDLC_DONE_KEY'],
    'dispatched_at': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
}
registry_file = os.environ['ASDLC_REGISTRY_FILE']
try:
    lock = open(os.environ['ASDLC_REGISTRY_LOCK'], 'w')
except OSError as e:
    print(f'ERROR: cannot open registry lock file {os.environ[\"ASDLC_REGISTRY_LOCK\"]}: {e}', file=sys.stderr)
    sys.exit(2)
with lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        with open(registry_file) as f:
            registry = json.load(f)
        # A syntactically-valid JSON document whose top level isn't a list
        # (e.g. '{}') would pass json.load() but blow up on the .append()
        # below with an uncaught AttributeError -- treat that the same as
        # unreadable/malformed content instead of letting it raise.
        if not isinstance(registry, list):
            raise ValueError('registry file does not contain a JSON array')
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        registry = []
    # A list whose top level is valid but whose elements aren't all dicts
    # (e.g. '[1, 2]') passes the isinstance(registry, list) check above but
    # would still write bad content straight back on the next .append() --
    # drop any non-dict element rather than letting a later reader trip on it.
    registry = [e for e in registry if isinstance(e, dict)]
    registry.append(entry)
    # Write to a sibling temp file and rename it into place instead of
    # truncating registry_file directly: open(registry_file, 'w')
    # truncates immediately, so a failure partway through json.dump
    # (ENOSPC, a killed process) would leave a corrupt/empty file behind,
    # and every reader here treats a JSONDecodeError as an empty registry
    # -- silently discarding every prior entry. os.replace() is an atomic
    # rename on the same filesystem (same directory), so a failed write
    # never clobbers the last-good file.
    tmp_path = None
    try:
        dir_name = os.path.dirname(registry_file) or '.'
        fd, tmp_path = tempfile.mkstemp(dir=dir_name)
        with os.fdopen(fd, 'w') as f:
            json.dump(registry, f, indent=2)
        os.replace(tmp_path, registry_file)
    except OSError as e:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        print(f'ERROR: cannot write registry file {registry_file}: {e}', file=sys.stderr)
        sys.exit(3)
print(json.dumps(entry))
") && reg_write_rc=0 || reg_write_rc=$?
# && / || above (not a bare trailing command) so `set -e` doesn't abort the
# whole dispatch on a registry-write failure -- the pane already exists by
# this point; only the registry bookkeeping failed.
if [[ "$reg_write_rc" -eq 2 ]]; then
  echo "WARNING: dispatch succeeded but failed to acquire the registry lock -- entry NOT recorded in $REGISTRY_FILE (registry directory may be missing or unwritable)" >&2
elif [[ "$reg_write_rc" -ne 0 ]]; then
  echo "WARNING: Failed to record dispatch in registry — deduplication may not work" >&2
fi

echo "DISPATCHED workspace=${WS_ID:-$DONE_KEY} surface=$SURFACE_ID agent=$AGENT mode=$MODE close=$CLOSE cwd=${CWD:-$(pwd)} done_key=$DONE_KEY"
