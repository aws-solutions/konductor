#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# tmux-dispatch.sh — Dispatch a task to a kiro-cli agent in a tmux window or pane.
# Usage: bash tmux-dispatch.sh --agent <name> --task "description" [options]
#
# Modes: split right (default), --split down, --tab (new window)
# Flags: --name, --cwd, --close, --interactive
set -euo pipefail

AGENT="" TASK="" CWD="" NAME="" MODE="split" SPLIT_DIR="right" CLOSE=false INTERACTIVE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)       AGENT="$2"; shift 2 ;;
    --task)        TASK="$2"; shift 2 ;;
    --name)        NAME="$2"; shift 2 ;;
    --cwd)         CWD="$2"; shift 2 ;;
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
[[ -z "$CWD" ]]   && { echo "ERROR: --cwd required" >&2; exit 1; }
[[ -z "${TMUX:-}" ]]  && { echo "ERROR: Not running inside a tmux session" >&2; exit 1; }
[[ "$SPLIT_DIR" == "stacked" ]] && { echo "ERROR: tmux does not support stacked panes (see tmux#2770); use zellij for stacked, or --split right|down" >&2; exit 1; }
# AGENT is used verbatim -- the caller (orchestrator routing table) is the
# single source of truth for the fully-qualified agent name (e.g. 'k-developer').
# This script never adds or strips a role prefix.
[[ "$AGENT" =~ ^[a-z0-9-]+$ ]] || { echo "ERROR: --agent must be alphanumeric/hyphens only" >&2; exit 1; }

LABEL="${NAME:-$AGENT: $(printf '%s' "$TASK" | head -c 40)}"
# Fix: python3 uuid is portable across macOS and Linux (date +%s%N and md5sum are GNU-only)
WS_ID="tmux-$(python3 -c "import uuid; print(uuid.uuid4().hex[:8])")"
# KONDUCTOR_MUX_REGISTRY_DIR lets tests point at an isolated directory
# instead of the real shared production registry; unset (the default) for
# every real dispatch.
REGISTRY_DIR="${KONDUCTOR_MUX_REGISTRY_DIR:-/tmp/konductor-mux}"
REGISTRY_FILE="$REGISTRY_DIR/dispatched.json"
# Sibling lock file guarding every read-modify-write of $REGISTRY_FILE below.
# zellij-dispatch.sh and mux-close-pane.sh share the same $REGISTRY_DIR and
# must serialize against this script's writes too, so they lock this exact
# path (flock creates it on demand; the lock is released when the wrapped
# process exits).
REGISTRY_LOCK="$REGISTRY_FILE.lock"
mkdir -p "$REGISTRY_DIR"

# Write launcher script — task stored in separate file to avoid all quoting issues
LAUNCHER="$REGISTRY_DIR/launcher-${WS_ID}.sh"
TASK_FILE="$REGISTRY_DIR/task-text-${WS_ID}.txt"

if [[ "$INTERACTIVE" == true ]]; then
  FLAGS="--trust-all-tools"
else
  FLAGS="--no-interactive --trust-all-tools"
fi

# Write task text to its own file — no escaping needed
printf '%s' "$TASK" > "$TASK_FILE"

# Detect runtime at dispatch time (parent has the env var; child pane won't)
if [[ -n "${CLAUDECODE:-}" ]]; then
  RUNTIME="claude"
else
  RUNTIME="kiro"
fi

# Generate launcher script
# The .done file is written by the shell after the agent CLI exits (guaranteed fallback
# in case the stop hook fails to run, e.g. on abnormal exit)
{
  echo "#!/bin/bash"
  # Forward the orchestrator's override (if set) into the dispatched pane --
  # this env var does not otherwise cross into the new tmux window/split.
  [[ -n "${WORKTREE_PROVISION_CMD:-}" ]] && printf 'export WORKTREE_PROVISION_CMD=%q\n' "$WORKTREE_PROVISION_CMD"
  [[ -n "$CWD" ]] && printf 'cd %q || exit 1\n' "$CWD"
  echo "TASK=\$(cat \"${TASK_FILE}\")"
  if [[ "$RUNTIME" == "claude" ]]; then
    # Claude Code: resolve agent prefix and invoke claude CLI. No package name
    # is hardcoded -- search for any locally-installed agent file ending in
    # "-<agent-name>.md", so this works for any package without a script
    # change. local- installs are a preferred tier over registry installs;
    # within a tier, 2+ matches means the caller passed a partially-qualified
    # name that is ambiguous (e.g. "orchestrator" matching both
    # "konductor-mux-orchestrator" and "konductor-cmux-orchestrator") -- error instead of
    # silently picking one by glob order. FOUND is tracked separately from
    # PREFIX so a legitimate empty prefix is not mistaken for "not found".
    echo 'PREFIX="" FOUND="" AMBIGUOUS=""'
    echo 'LOCAL_MATCHES=()'
    printf 'for f in "$HOME"/.claude/agents/local-*-%s.md; do\n' "$AGENT"
    echo '  [ -f "$f" ] || continue'
    echo '  LOCAL_MATCHES+=("$f")'
    echo 'done'
    echo 'if [ "${#LOCAL_MATCHES[@]}" -eq 1 ]; then'
    echo '  base=$(basename "${LOCAL_MATCHES[0]}" .md)'
    printf '  PREFIX="${base%%%s}"\n' "$AGENT"
    echo '  FOUND=1'
    echo 'elif [ "${#LOCAL_MATCHES[@]}" -gt 1 ]; then'
    echo '  AMBIGUOUS="${LOCAL_MATCHES[*]}"'
    echo 'else'
    echo '  REGISTRY_MATCHES=()'
    printf '  for f in "$HOME"/.claude/agents/*-%s.md; do\n' "$AGENT"
    echo '    [ -f "$f" ] || continue'
    echo '    case "$(basename "$f")" in'
    echo '      local-*) continue ;;'
    echo '    esac'
    echo '    REGISTRY_MATCHES+=("$f")'
    echo '  done'
    echo '  if [ "${#REGISTRY_MATCHES[@]}" -eq 1 ]; then'
    echo '    base=$(basename "${REGISTRY_MATCHES[0]}" .md)'
    printf '    PREFIX="${base%%%s}"\n' "$AGENT"
    echo '    FOUND=1'
    echo '  elif [ "${#REGISTRY_MATCHES[@]}" -gt 1 ]; then'
    echo '    AMBIGUOUS="${REGISTRY_MATCHES[*]}"'
    printf '  elif [ -f "$HOME/.claude/agents/%s.md" ]; then\n' "$AGENT"
    echo '    # Bare, no-prefix install'
    echo '    PREFIX=""'
    echo '    FOUND=1'
    echo '  fi'
    echo 'fi'
    printf 'if [ -n "$AMBIGUOUS" ]; then\n'
    printf '  echo "ERROR: --agent %s matches multiple installed agents; pass a fully-qualified name. Candidates: $AMBIGUOUS"\n' "$AGENT"
    printf '  EXIT_CODE=1\n'
    printf 'elif [ -z "$FOUND" ]; then\n'
    printf '  echo "ERROR: claude agent %s not installed under ~/.claude/agents (checked local-/registry installs); not dispatching"\n' "$AGENT"
    printf '  EXIT_CODE=1\n'
    printf 'else\n'
    printf '  claude --agent "${PREFIX}%s" --dangerously-skip-permissions -p "$TASK"\n' "$AGENT"
    echo '  EXIT_CODE=$?'
    printf 'fi\n'
  else
    # kiro-cli: no filesystem resolution needed -- kiro-cli resolves --agent
    # against its own registry and warns on collisions itself. Unlike Claude
    # Code, kiro agents aren't looked up by a package-prefixed filename this
    # script would have to reconstruct, so AGENT is passed through as-is.
    printf 'kiro-cli chat --agent %s %s "$TASK"\n' "$AGENT" "$FLAGS"
    echo "EXIT_CODE=\$?"
  fi
  # Write .done only if hook hasn't already written it. Derived from
  # $REGISTRY_DIR (already resolved from KONDUCTOR_MUX_REGISTRY_DIR at
  # generation time above) so a test pointed at an isolated registry dir
  # never leaks a .done file into the real /tmp/konductor-mux.
  echo "DONE_FILE=\"${REGISTRY_DIR}/${WS_ID}.done\""
  echo "if [ ! -f \"\$DONE_FILE\" ]; then"
  printf '  mkdir -p %q\n' "$REGISTRY_DIR"
  echo "  python3 -c \"import json; json.dump({'workspace_id': '${WS_ID}', 'status': 'done' if \$EXIT_CODE == 0 else 'error', 'summary': 'shell fallback'}, open('\$DONE_FILE', 'w'))\""
  echo "fi"
  if [[ "$CLOSE" == true ]]; then
    echo "tmux kill-pane -t \$TMUX_PANE 2>/dev/null || true"
  fi
} > "$LAUNCHER"
chmod +x "$LAUNCHER"

# Create surface and set MUX_WORKSPACE_ID env var
case "$MODE" in
  tab)
    PANE_ID=$(tmux new-window \
      -e "MUX_WORKSPACE_ID=$WS_ID" \
      -n "$LABEL" \
      -P -F '#{pane_id}' \
      "bash \"$LAUNCHER\"")
    ;;
  split)
    if [[ "$SPLIT_DIR" == "right" ]]; then
      PANE_ID=$(tmux split-window -h -e "MUX_WORKSPACE_ID=$WS_ID" -P -F '#{pane_id}' \
        "bash \"$LAUNCHER\"")
    else
      PANE_ID=$(tmux split-window -v -e "MUX_WORKSPACE_ID=$WS_ID" -P -F '#{pane_id}' \
        "bash \"$LAUNCHER\"")
    fi
    tmux select-pane -t "$PANE_ID" -T "$LABEL" 2>/dev/null || true
    tmux select-layout tiled 2>/dev/null || true
    ;;
esac

# Register dispatch — values passed via env vars to avoid shell-to-Python injection
# fcntl.flock (stdlib, POSIX -- works on both macOS and Linux, unlike the
# util-linux `flock` binary which macOS doesn't ship) serializes the
# read-modify-write below against concurrent dispatches from this script,
# zellij-dispatch.sh, and mux-close-pane.sh -- all three read, mutate, and
# rewrite the same $REGISTRY_FILE with no other coordination.
TASK_SUMMARY=$(printf '%s' "$TASK" | head -c 100)
WS_ID="$WS_ID" PANE_ID="${PANE_ID:-unknown}" AGENT="$AGENT" \
TASK_SUMMARY="$TASK_SUMMARY" MODE="$MODE" CWD="${CWD:-}" \
REGISTRY_FILE="$REGISTRY_FILE" REGISTRY_LOCK="$REGISTRY_LOCK" \
DISPATCHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
python3 -c "
import json, os, sys, fcntl, tempfile
entry = {
    'workspace_id': os.environ['WS_ID'],
    'pane_id': os.environ['PANE_ID'],
    'agent': os.environ['AGENT'],
    'task_summary': os.environ['TASK_SUMMARY'],
    'mode': os.environ['MODE'],
    'cwd': os.environ['CWD'],
    'backend': 'tmux',
    'dispatched_at': os.environ['DISPATCHED_AT'],
}
reg_file = os.environ['REGISTRY_FILE']
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
    # truncating reg_file directly: open(reg_file, 'w') truncates
    # immediately, so a failure partway through json.dump (ENOSPC, a killed
    # process) would leave a corrupt/empty file behind, and every reader
    # here treats a JSONDecodeError as an empty registry -- silently
    # discarding every prior entry. os.replace() is an atomic rename on the
    # same filesystem (same directory), so a failed write never clobbers
    # the last-good file.
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
# && / || above (not a bare trailing command) so `set -e` doesn't abort the
# whole dispatch on a registry-write failure -- the pane already exists by
# this point; only the registry bookkeeping failed.
if [[ "$reg_write_rc" -eq 2 ]]; then
  echo "WARNING: dispatch succeeded but failed to acquire the registry lock -- entry NOT recorded in $REGISTRY_FILE (registry directory may be missing or unwritable)" >&2
elif [[ "$reg_write_rc" -ne 0 ]]; then
  echo "WARNING: Failed to record dispatch in registry" >&2
fi

echo "DISPATCHED workspace=$WS_ID pane=${PANE_ID:-unknown} agent=$AGENT mode=$MODE backend=tmux"
