#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# zellij-dispatch.sh — Dispatch a task to a kiro-cli agent in a zellij pane.
# Usage: bash zellij-dispatch.sh --agent <name> --task "description" [options]
#
# Modes: split right (default), --split down, --split stacked, --tab (new tab)
# Flags: --name, --cwd, --close, --interactive, --brief <file> (instead of --task)
#
# Note: zellij does not support --env on new-pane (issue #3856).
# MUX_WORKSPACE_ID is passed via the launcher script instead.
set -euo pipefail

AGENT="" TASK="" BRIEF="" CWD="" NAME="" MODE="split" SPLIT_DIR="right" CLOSE=false INTERACTIVE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)       AGENT="$2"; shift 2 ;;
    --task)        TASK="$2"; shift 2 ;;
    --brief)       BRIEF="$2"; shift 2 ;;
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

[[ -z "$AGENT" ]]  && { echo "ERROR: --agent required" >&2; exit 1; }
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
[[ -z "$CWD" ]]   && { echo "ERROR: --cwd required" >&2; exit 1; }
[[ -z "${ZELLIJ:-}" ]] && { echo "ERROR: Not running inside a zellij session" >&2; exit 1; }
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

# In a Claude Code plugin this skill sits at <plugin root>/skills/mux-dispatch/,
# and Claude Code names the plugin's agents <plugin>:<agent>.
PLUGIN_ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLUGIN_NAME=""
if [[ -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" ]]; then
  PLUGIN_NAME="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("name", ""))' \
    "$PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null || true)"
  [[ "$PLUGIN_NAME" =~ ^[a-z0-9-]+$ ]] || PLUGIN_NAME=""
fi

# Claude Code may sandbox $TMPDIR (e.g. /tmp/claude-<uid>); zellij locates its IPC socket
# under $TMPDIR, so restore the real per-user temp dir or zellij reports 'no active session'.
REAL_TMPDIR=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || echo "${TMPDIR:-/tmp}")
export TMPDIR="$REAL_TMPDIR"

SESSION="${ZELLIJ_SESSION_NAME:-}"
if [[ -z "$SESSION" ]]; then
  SESSION=$(zellij list-sessions --short 2>/dev/null | head -1)
fi
[[ -z "$SESSION" ]] && { echo "ERROR: no live zellij session found" >&2; exit 1; }

LABEL="${NAME:-$AGENT: $(printf '%s' "$TASK_TEXT" | head -c 40 | tr '\n' ' ')}"
# Fix: python3 uuid is portable across macOS and Linux (date +%s%N and md5sum are GNU-only)
WS_ID="zellij-$(python3 -c "import uuid; print(uuid.uuid4().hex[:8])")"
# KONDUCTOR_MUX_REGISTRY_DIR lets tests point at an isolated directory
# instead of the real shared production registry; unset (the default) for
# every real dispatch.
REGISTRY_DIR="${KONDUCTOR_MUX_REGISTRY_DIR:-/tmp/konductor-mux}"
REGISTRY_FILE="$REGISTRY_DIR/dispatched.json"
# Sibling lock file guarding every read-modify-write of $REGISTRY_FILE below.
# tmux-dispatch.sh and mux-close-pane.sh share the same $REGISTRY_DIR and
# must serialize against this script's writes too, so they lock this exact
# path (flock creates it on demand; the lock is released when the wrapped
# process exits).
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
  echo "ERROR: dispatch registry $REGISTRY_DIR $problem; it must be a directory you own that no one else can write to (chmod 700 it, or set KONDUCTOR_MUX_REGISTRY_DIR to a private directory)" >&2
  exit 1
fi

# Write launcher script — task stored in separate file to avoid all quoting issues
LAUNCHER="$REGISTRY_DIR/launcher-${WS_ID}.sh"
# Each dispatch gets its own 0700 directory holding its brief, its result and
# its .done. It is the only directory the child is granted; the shared
# registry, the launchers and other dispatches stay outside that grant.
DISPATCH_DIR="$REGISTRY_DIR/$WS_ID"
mkdir -m 700 "$DISPATCH_DIR"
TASK_FILE="$DISPATCH_DIR/task.md"
RESULT_FILE="$DISPATCH_DIR/result.md"
DONE_FILE="$DISPATCH_DIR/$WS_ID.done"

if [[ "$INTERACTIVE" == true ]]; then
  FLAGS="--trust-all-tools"
else
  FLAGS="--no-interactive --trust-all-tools"
fi

# The brief goes in its own file, so its text never passes through a shell.
if [[ -n "$BRIEF" ]]; then
  cp "$BRIEF" "$TASK_FILE"
else
  printf '%s' "$TASK" > "$TASK_FILE"
fi
# The child's prompt names its files by literal path: a headless child can't
# run a shell to read them from the environment.
PROMPT="Read and execute the task in $TASK_FILE. Write your full result to $RESULT_FILE. As your last step, write {\"status\": \"done\", \"summary\": \"<one line>\"} to $DONE_FILE, with \"error\" as the status if you could not finish."

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
  echo "export MUX_WORKSPACE_ID=\"${WS_ID}\""
  # Forward the orchestrator's override (if set) into the dispatched pane --
  # zellij has no --env on new-pane, so this env var does not otherwise cross
  # into the new pane/tab; the launcher script is the only forwarding path.
  [[ -n "${WORKTREE_PROVISION_CMD:-}" ]] && printf 'export WORKTREE_PROVISION_CMD=%q\n' "$WORKTREE_PROVISION_CMD"
  [[ -n "$CWD" ]] && printf 'cd %q || exit 1\n' "$CWD"
  printf 'TASK=%q\n' "$PROMPT"
  printf 'export KONDUCTOR_DONE_FILE=%q\n' "$DONE_FILE"
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
    # If ~/.claude/agents has no match, an agent this skill's own plugin
    # ships launches by its bare name; Claude resolves it to <plugin>:<agent>.
    # A qualified AGENT must name this plugin and one of its agents.
    echo 'PREFIX="" FOUND="" AMBIGUOUS=""'
    if [[ "$AGENT" == *:* ]]; then
      if [[ -n "$PLUGIN_NAME" && "${AGENT%%:*}" == "$PLUGIN_NAME" && -f "$PLUGIN_ROOT/agents/${AGENT#*:}.md" ]]; then
        echo 'FOUND=1'
      fi
    else
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
      if [[ -n "$PLUGIN_NAME" ]]; then
        printf '  elif [ -f %q ]; then\n' "$PLUGIN_ROOT/agents/$AGENT.md"
        echo '    FOUND=1'
      fi
      echo '  fi'
      echo 'fi'
    fi
    printf 'if [ -n "$AMBIGUOUS" ]; then\n'
    printf '  echo "ERROR: --agent %s matches multiple installed agents; pass a fully-qualified name. Candidates: $AMBIGUOUS"\n' "$AGENT"
    printf '  EXIT_CODE=1\n'
    printf 'elif [ -z "$FOUND" ]; then\n'
    printf '  echo "ERROR: claude agent %s not installed under ~/.claude/agents or in this plugin; not dispatching"\n' "$AGENT"
    printf '  EXIT_CODE=1\n'
    printf 'else\n'
    # --add-dir grants this dispatch's own directory, outside the child's
    # working directory. It takes a list, so it goes before --agent and can
    # never swallow the prompt.
    printf '  claude --add-dir %q --agent "${PREFIX}%s"%s "$TASK"\n' "$DISPATCH_DIR" "$AGENT" "$CLAUDE_PERMISSION_ARGS"
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
  # Record the exit: keep a .done the child or its hook wrote and add the exit
  # code, or write a fallback .done. The path derives from $REGISTRY_DIR, so a
  # test pointed at an isolated registry dir never touches /tmp/konductor-mux.
  printf 'mkdir -p -m 700 %q\n' "$DISPATCH_DIR"
  printf 'python3 -c %q %q %q "$EXIT_CODE" %q || true\n' "$RECORD_DONE_PY" "$DONE_FILE" "$WS_ID" "shell fallback"
  if [[ "$CLOSE" == true ]]; then
    echo "zellij action close-pane 2>/dev/null || true"
  fi
} > "$LAUNCHER"
chmod +x "$LAUNCHER"

# Create surface
# Fix: new-tab already creates a default pane — run command directly in it, don't call new-pane
case "$MODE" in
  tab)
    if ! OUT=$(zellij --session "$SESSION" action new-tab --name "$LABEL" -- bash "$LAUNCHER" 2>&1); then
      echo "ERROR: zellij new-tab failed (session=$SESSION): $OUT" >&2; exit 1
    fi
    PANE_ID=$(printf '%s' "$OUT" | grep -o 'terminal_[0-9]*' | head -1 || true); PANE_ID="${PANE_ID:-unknown}"
    ;;
  split)
    if [[ "$SPLIT_DIR" == "right" ]]; then
      if ! OUT=$(zellij --session "$SESSION" action new-pane --direction right --name "$LABEL" -- bash "$LAUNCHER" 2>&1); then
        echo "ERROR: zellij new-pane failed (session=$SESSION): $OUT" >&2; exit 1
      fi
    elif [[ "$SPLIT_DIR" == "stacked" ]]; then
      if ! OUT=$(zellij --session "$SESSION" action new-pane --stacked --name "$LABEL" -- bash "$LAUNCHER" 2>&1); then
        echo "ERROR: zellij new-pane --stacked failed (session=$SESSION): $OUT" >&2; exit 1
      fi
    else
      if ! OUT=$(zellij --session "$SESSION" action new-pane --direction down --name "$LABEL" -- bash "$LAUNCHER" 2>&1); then
        echo "ERROR: zellij new-pane failed (session=$SESSION): $OUT" >&2; exit 1
      fi
    fi
    PANE_ID=$(printf '%s' "$OUT" | grep -o 'terminal_[0-9]*' | head -1 || true); PANE_ID="${PANE_ID:-unknown}"
    ;;
esac

# Register dispatch — values passed via env vars to avoid shell-to-Python injection
# `session` is recorded alongside `pane_id` because pane IDs are NOT unique
# across concurrent zellij sessions — callers peeking at a pane (e.g. via
# `zellij action dump-screen`) must pass both to target the right pane.
# fcntl.flock (stdlib, POSIX -- works on both macOS and Linux, unlike the
# util-linux `flock` binary which macOS doesn't ship) serializes the
# read-modify-write below against concurrent dispatches from this script,
# tmux-dispatch.sh, and mux-close-pane.sh -- all three read, mutate, and
# rewrite the same $REGISTRY_FILE with no other coordination.
TASK_SUMMARY=$(printf '%s' "$TASK_TEXT" | head -c 100)
WS_ID="$WS_ID" PANE_ID="${PANE_ID:-unknown}" AGENT="$AGENT" \
TASK_SUMMARY="$TASK_SUMMARY" MODE="$MODE" CWD="${CWD:-}" CLOSE="$CLOSE" \
SESSION="$SESSION" \
REGISTRY_FILE="$REGISTRY_FILE" REGISTRY_LOCK="$REGISTRY_LOCK" DISPATCH_DIR="$DISPATCH_DIR" \
DISPATCHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
python3 -c "
import json, os, sys, fcntl, tempfile
entry = {
    'workspace_id': os.environ['WS_ID'],
    'pane_id': os.environ['PANE_ID'],
    'session': os.environ['SESSION'],
    'agent': os.environ['AGENT'],
    'task_summary': os.environ['TASK_SUMMARY'],
    'mode': os.environ['MODE'],
    'cwd': os.environ['CWD'],
    'backend': 'zellij',
    'dispatch_dir': os.environ['DISPATCH_DIR'],
    'dispatched_at': os.environ['DISPATCHED_AT'],
    'close': os.environ.get('CLOSE', 'false') == 'true',
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
    # truncating reg_file directly -- see tmux-dispatch.sh's identical
    # comment for why: open(reg_file, 'w') truncates immediately, so a
    # failure partway through json.dump would leave a corrupt/empty file
    # that every reader here treats as an empty registry, silently
    # discarding every prior entry. os.replace() is an atomic rename.
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

echo "DISPATCHED workspace=$WS_ID pane=${PANE_ID:-unknown} session=$SESSION agent=$AGENT mode=$MODE backend=zellij dispatch_dir=$DISPATCH_DIR done_file=$DONE_FILE"
