#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# cmux-dispatch.sh — Dispatch a task to a kiro-cli agent in a cmux tab, split, or workspace.
# Usage: bash cmux-dispatch.sh --agent <name> --task "description" [options]
#
# Modes: split right (default), --split down, --tab, --workspace
# Flags: --name, --cwd, --close, --interactive, --brief <file> (instead of --task)
#
# Features:
#   - Readiness polling: waits for shell init before sending kiro command
#   - Dispatch registry: tracks spawned workspaces in /tmp/konductor-cmux/dispatched.json
#   - Completion hook: child agents write .done files via cmux-completion-hook.sh
set -euo pipefail

# Resolve the real path of this script before taking dirname, so invocation
# through a symlink (direct or via a relative link target) still locates
# sibling files next to the REAL file, not next to the symlink. Mirrors
# dispatch.sh's own resolution so a caller that found this script via an
# absolute path (per mux-dispatch/cmux-dispatch SKILL.md's resolution order)
# gets the same guarantee: this script can find its sibling resources
# (e.g. cmux-completion-hook.sh) regardless of the caller's cwd. No
# `readlink -f` (GNU-only; macOS readlink lacks it) -- loop-resolve one level
# at a time with plain `readlink` + `cd -P`.
SOURCE="${BASH_SOURCE[0]}"
MAX_SYMLINK_HOPS=40
hop_count=0
while [[ -L "$SOURCE" ]]; do
  hop_count=$((hop_count + 1))
  if (( hop_count > MAX_SYMLINK_HOPS )); then
    echo "ERROR: symlink resolution exceeded ${MAX_SYMLINK_HOPS} hops (possible cyclic symlink) while resolving '$SOURCE'." >&2
    exit 1
  fi
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  LINK_TARGET="$(readlink "$SOURCE")"
  case "$LINK_TARGET" in
    /*) SOURCE="$LINK_TARGET" ;;              # absolute link target
    *)  SOURCE="$DIR/$LINK_TARGET" ;;          # relative link target
  esac
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

# Sanity check: the kiro-cli completion hook (wired via the dispatched
# agent's own `clientConfig.kiroCli.hooks.stop` config) lives next to this
# script. Warn early if a broken install is missing it, rather than let
# completion detection silently fall back to the shell-fallback .done path.
if [[ ! -f "$SCRIPT_DIR/cmux-completion-hook.sh" ]]; then
  echo "WARNING: cmux-completion-hook.sh not found next to $SCRIPT_DIR/cmux-dispatch.sh -- completion detection will rely on the shell fallback only." >&2
fi

AGENT="" TASK="" BRIEF="" CWD="" NAME="" MODE="split" SPLIT_DIR="right" CLOSE=false INTERACTIVE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)       AGENT="$2"; shift 2 ;;
    --task)        TASK="$2"; shift 2 ;;
    --brief)       BRIEF="$2"; shift 2 ;;
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
if [[ -n "$TASK" && -n "$BRIEF" ]]; then
  echo "ERROR: pass --task or --brief, not both" >&2; exit 1
fi
if [[ -n "$BRIEF" ]]; then
  [[ -f "$BRIEF" && -r "$BRIEF" ]] || { echo "ERROR: --brief file not found or unreadable: $BRIEF" >&2; exit 1; }
  [[ "$(wc -c < "$BRIEF")" -le 1048576 ]] || { echo "ERROR: --brief file is over 1 MB: $BRIEF" >&2; exit 1; }
  TASK_TEXT="$(head -c 100 "$BRIEF")"
else
  [[ -z "$TASK" ]] && { echo "ERROR: --task or --brief required" >&2; exit 1; }
  TASK_TEXT="$TASK"
fi
# AGENT is the name from the orchestrator routing table (e.g. 'k-developer'),
# or one qualified with this plugin's name ('konductor:k-developer').
[[ "$AGENT" =~ ^([a-z0-9-]+:)?[a-z0-9-]+$ ]] || { echo "ERROR: --agent must be alphanumeric/hyphens only, optionally prefixed with '<plugin>:'" >&2; exit 1; }

# Permission mode for a Claude Code child session, from
# KONDUCTOR_DISPATCH_PERMISSION_MODE. Kiro CLI children ignore it.
quote_args() {
  local out="" a
  for a in "$@"; do out+=" $(printf '%q' "$a")"; done
  printf '%s' "$out"
}
CLAUDE_PERMISSION_ARGS=""
if [[ -n "${CLAUDECODE:-}" ]]; then
  case "${KONDUCTOR_DISPATCH_PERMISSION_MODE:-interactive}" in
    interactive) ;;
    headless) CLAUDE_PERMISSION_ARGS="$(quote_args -p --permission-mode acceptEdits --permission-prompts none)" ;;
    bypass)
      CLAUDE_PERMISSION_ARGS="$(quote_args --dangerously-skip-permissions -p)"
      echo "WARNING: KONDUCTOR_DISPATCH_PERMISSION_MODE=bypass: the child session skips every permission check. Use it only in an isolated environment." >&2
      ;;
    *)
      echo "ERROR: KONDUCTOR_DISPATCH_PERMISSION_MODE must be interactive, headless or bypass (got '${KONDUCTOR_DISPATCH_PERMISSION_MODE}')" >&2
      # The plugin's SessionStart hook writes "invalid" for a mistyped option.
      if [[ "$KONDUCTOR_DISPATCH_PERMISSION_MODE" == invalid ]]; then
        echo "ERROR: check the Claude Code plugin's dispatch_permission_mode option; it must be interactive, headless or bypass (case-sensitive)." >&2
      fi
      exit 1
      ;;
  esac
fi

# Run by the launcher after the child exits. It keeps a .done the child
# wrote itself (the completion signal) and adds the exit code, so an early
# .done can't hide a crash: a non-zero exit always ends as status "error".
# It reads only a regular file of at most 64 KiB, never through a symlink and
# never blocking on a FIFO, and replaces it through a fresh temp file.
RECORD_DONE_PY='import json, os, stat, sys, tempfile
path, ws, code, default = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
data = None
try:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        st = os.fstat(fd)
        if stat.S_ISREG(st.st_mode) and st.st_size <= 65536:
            data = json.loads(os.read(fd, 65537).decode("utf-8"))
    finally:
        os.close(fd)
except (OSError, ValueError):
    data = None
if not isinstance(data, dict):
    data = {"workspace_id": ws, "summary": default}
data.setdefault("workspace_id", ws)
if data.get("status") not in ("done", "error"):
    data["status"] = "done" if code == 0 else "error"
data["exit_code"] = code
if code != 0:
    data["status"] = "error"
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".done-")
try:
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)
except BaseException:
    os.unlink(tmp)
    raise'
CMUX_BIN="${CMUX_BIN:-/Applications/cmux.app/Contents/MacOS/cmux}"
[[ -x "$CMUX_BIN" ]] || { echo "ERROR: cmux binary not found or not executable (set CMUX_BIN to override)" >&2; exit 1; }
cmux() { "$CMUX_BIN" "$@"; }

LABEL="${NAME:-$AGENT: $(printf '%s' "$TASK_TEXT" | head -c 40 | tr '\n' ' ')}"
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
# The registry holds every dispatch's files, so it must be a real directory
# owned by this user that no one else can write to. Prints the problem and
# fails when it isn't. KONDUCTOR_REGISTRY_OWNER_UID names the owner to expect
# (default: this user); it cannot turn the check off.
registry_problem() {
  python3 - "$1" "${KONDUCTOR_REGISTRY_OWNER_UID:-$(id -u)}" <<'PY'
import os, stat, sys
path, uid = sys.argv[1], int(sys.argv[2])
try:
    st = os.lstat(path)
except OSError as e:
    sys.exit(f"cannot be read ({e.strerror})")
if stat.S_ISLNK(st.st_mode):
    sys.exit("is a symlink")
if not stat.S_ISDIR(st.st_mode):
    sys.exit("is not a directory")
if st.st_uid != uid:
    sys.exit(f"is owned by uid {st.st_uid}, not {uid}")
if st.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
    sys.exit("is group- or world-writable")
PY
}

[[ -e "$REGISTRY_DIR" || -L "$REGISTRY_DIR" ]] || { mkdir -p "$(dirname "$REGISTRY_DIR")" && mkdir -m 700 "$REGISTRY_DIR"; }
if ! problem="$(registry_problem "$REGISTRY_DIR" 2>&1)"; then
  echo "ERROR: dispatch registry $REGISTRY_DIR $problem; it must be a directory you own that no one else can write to (chmod 700 it, or set KONDUCTOR_CMUX_REGISTRY_DIR to a private directory)" >&2
  exit 1
fi

# The dispatch directory is created before the surface opens, so a failure
# here leaves no surface behind. It gets its final name once the surface id
# is known.
DISPATCH_SUFFIX="$(python3 -c "import uuid; print(uuid.uuid4().hex[:8])")"
PENDING_DIR="$REGISTRY_DIR/.pending-$DISPATCH_SUFFIX"
mkdir -m 700 "$PENDING_DIR"
trap '[ -z "$PENDING_DIR" ] || rm -rf "$PENDING_DIR"' EXIT

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

# Per-dispatch key: the surface id (surface:3 -> surface_3) plus a random
# suffix, since surface numbers repeat across cmux sessions.
DONE_KEY="$(printf '%s' "$SURFACE_ID" | tr -c 'A-Za-z0-9._-' '_')-$DISPATCH_SUFFIX"

# Each dispatch gets its own 0700 directory holding its brief, its result and
# its .done. It is the only directory the child is granted; the shared
# registry and other dispatches stay outside that grant.
DISPATCH_DIR="$REGISTRY_DIR/$DONE_KEY"
if ! mv "$PENDING_DIR" "$DISPATCH_DIR"; then
  echo "ERROR: cannot create the dispatch directory $DISPATCH_DIR; not dispatching" >&2
  cmux close-surface --surface "$SURFACE_ID" 2>/dev/null || true
  exit 1
fi
PENDING_DIR=""
TASK_FILE="$DISPATCH_DIR/task.md"
RESULT_FILE="$DISPATCH_DIR/result.md"
DONE_FILE="$DISPATCH_DIR/$DONE_KEY.done"
# The brief goes in its own file, so its text never passes through a shell.
if [[ -n "$BRIEF" ]]; then
  cp "$BRIEF" "$TASK_FILE"
else
  printf '%s' "$TASK" > "$TASK_FILE"
fi
# The child's prompt names its files by literal path: a headless child can't
# run a shell to read them from the environment.
PROMPT="Read and execute the task in $TASK_FILE. Write your full result to $RESULT_FILE. As your last step, write {\"status\": \"done\", \"summary\": \"<one line>\"} to $DONE_FILE, with \"error\" as the status if you could not finish."

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
  # If ~/.claude/agents has no match, an agent this skill's own plugin ships
  # (this script sits at <plugin root>/skills/cmux-dispatch/) launches by its
  # bare name; Claude resolves it to <plugin>:<agent>. A qualified AGENT must
  # name this plugin and one of its agents.
  PLUGIN_ROOT="$(cd -P "$SCRIPT_DIR/../.." && pwd)"
  PLUGIN_NAME=""
  if [[ -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" ]]; then
    PLUGIN_NAME="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("name", ""))' \
      "$PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null || true)"
    [[ "$PLUGIN_NAME" =~ ^[a-z0-9-]+$ ]] || PLUGIN_NAME=""
  fi
  PREFIX="" FOUND="" AMBIGUOUS=""
  if [[ "$AGENT" == *:* ]]; then
    if [[ -n "$PLUGIN_NAME" && "${AGENT%%:*}" == "$PLUGIN_NAME" && -f "$PLUGIN_ROOT/agents/${AGENT#*:}.md" ]]; then
      FOUND=1
    fi
  else
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
      elif [[ -n "$PLUGIN_NAME" && -f "$PLUGIN_ROOT/agents/${AGENT}.md" ]]; then
        FOUND=1
      fi
    fi
  fi
  if [ -n "$AMBIGUOUS" ]; then
    echo "ERROR: --agent ${AGENT} matches multiple installed agents; pass a fully-qualified name. Candidates: $AMBIGUOUS" >&2
    python3 -c "import json; json.dump({'workspace_id':'${WS_ID:-$DONE_KEY}','status':'error','summary':'ambiguous agent name'},open('${DONE_FILE}','w'))"
    cmux close-surface --surface "$SURFACE_ID" 2>/dev/null || true
    exit 1
  fi
  # PREFIX comes from a filename and is pasted into PANE_CMD below.
  if [[ ! "$PREFIX" =~ ^[A-Za-z0-9._-]*$ ]]; then
    echo "ERROR: unsafe agent file name for ${AGENT} under ~/.claude/agents (prefix '${PREFIX}'); not dispatching" >&2
    python3 -c "import json; json.dump({'workspace_id':'${WS_ID:-$DONE_KEY}','status':'error','summary':'unsafe agent file name'},open('${DONE_FILE}','w'))"
    cmux close-surface --surface "$SURFACE_ID" 2>/dev/null || true
    exit 1
  fi
  if [ -z "$FOUND" ]; then
    echo "ERROR: claude agent ${AGENT} not installed under ~/.claude/agents or in this plugin; not dispatching" >&2
    python3 -c "import json; json.dump({'workspace_id':'${WS_ID:-$DONE_KEY}','status':'error','summary':'agent not installed'},open('${DONE_FILE}','w'))"
    cmux close-surface --surface "$SURFACE_ID" 2>/dev/null || true
    exit 1
  fi
  # Fix 1: bake resolved WS_ID at dispatch time — no in-pane parameter expansion
  # Fall back to DONE_KEY when WS_ID is empty (split/tab mode has no workspace id)
  RECORDED_WS_ID="${WS_ID:-$DONE_KEY}"
  # --add-dir grants this dispatch's own directory, outside the child's
  # working directory. It takes a list, so it goes before --agent and can
  # never swallow the prompt.
  PANE_CMD="${CMD_PREFIX}export KONDUCTOR_DONE_FILE=$(printf '%q' "$DONE_FILE") && claude --add-dir $(printf '%q' "$DISPATCH_DIR") --agent \"${PREFIX}${AGENT}\"${CLAUDE_PERMISSION_ARGS} $(printf '%q' "$PROMPT")"
  # Record the exit: keep a .done the child wrote and add the exit code, or
  # write a fallback .done.
  PANE_CMD="${PANE_CMD} ; ec=\$? ; mkdir -p -m 700 $(printf '%q' "$DISPATCH_DIR") ; python3 -c $(printf '%q' "$RECORD_DONE_PY") $(printf '%q %q' "$DONE_FILE" "$RECORDED_WS_ID") \"\$ec\" 'claude exit' || true"
else
  # kiro-cli: no filesystem resolution needed -- kiro-cli resolves --agent
  # against its own registry and warns on collisions itself. Unlike Claude
  # Code, kiro agents aren't looked up by a package-prefixed filename this
  # script would have to reconstruct, so AGENT is passed through as-is.
  KIRO_FLAGS="--no-interactive --trust-all-tools"
  [[ "$INTERACTIVE" == true ]] && KIRO_FLAGS="--trust-all-tools"
  PANE_CMD="${CMD_PREFIX}export ASDLC_DONE_KEY=\"${DONE_KEY}\" KONDUCTOR_DONE_FILE=$(printf '%q' "$DONE_FILE") ; kiro-cli chat --agent \"$AGENT\" ${KIRO_FLAGS} $(printf '%q' "$PROMPT")"
  # Record the exit: keep a .done cmux-completion-hook.sh wrote on a clean stop
  # and add the exit code, or write a fallback .done on an abnormal exit.
  PANE_CMD="${PANE_CMD} ; ec=\$? ; mkdir -p -m 700 $(printf '%q' "$DISPATCH_DIR") ; python3 -c $(printf '%q' "$RECORD_DONE_PY") $(printf '%q %q' "$DONE_FILE" "${WS_ID:-$DONE_KEY}") \"\$ec\" 'shell fallback' || true"
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
TASK_SUMMARY=$(printf '%s' "$TASK_TEXT" | head -c 100)
ENTRY=$(ASDLC_WS_ID="$WS_ID" \
  ASDLC_SURFACE_ID="$SURFACE_ID" \
  ASDLC_AGENT="$AGENT" \
  ASDLC_TASK_SUMMARY="$TASK_SUMMARY" \
  ASDLC_MODE="$MODE" \
  ASDLC_CWD="${CWD:-}" \
  ASDLC_REGISTRY_FILE="$REGISTRY_FILE" \
  ASDLC_REGISTRY_LOCK="$REGISTRY_LOCK" \
  ASDLC_DONE_KEY="$DONE_KEY" \
  ENTRY_DISPATCH_DIR="$DISPATCH_DIR" \
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
    'dispatch_dir': os.environ['ENTRY_DISPATCH_DIR'],
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

echo "DISPATCHED workspace=${WS_ID:-$DONE_KEY} surface=$SURFACE_ID agent=$AGENT mode=$MODE close=$CLOSE cwd=${CWD:-$(pwd)} done_key=$DONE_KEY dispatch_dir=$DISPATCH_DIR done_file=$DONE_FILE"
