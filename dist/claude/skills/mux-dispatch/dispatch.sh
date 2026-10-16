#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# dispatch.sh — Self-locating entry point for mux-dispatch.
#
# Resolves its own directory (so it works from ANY cwd, including a monorepo
# root where the documented "skills/mux-dispatch/..." relative path does not
# resolve), detects the active multiplexer, and execs the matching backend
# script with all arguments passed through unchanged.
#
# Usage: bash dispatch.sh --agent <name> --task "description" [options]
# (see tmux-dispatch.sh / zellij-dispatch.sh for the full flag set)
set -euo pipefail

# Resolve the real path of this script before taking dirname, so invocation
# through a symlink (direct or via a relative link target) still locates the
# sibling tmux-dispatch.sh / zellij-dispatch.sh next to the REAL file, not
# next to the symlink. No `readlink -f` (GNU-only; macOS readlink lacks it) --
# loop-resolve one level at a time with plain `readlink` + `cd -P`.
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

if [[ -n "${TMUX:-}" ]]; then
  exec bash "$SCRIPT_DIR/tmux-dispatch.sh" "$@"
elif [[ -n "${ZELLIJ:-}" ]]; then
  exec bash "$SCRIPT_DIR/zellij-dispatch.sh" "$@"
else
  echo "ERROR: No multiplexer detected (neither \$TMUX nor \$ZELLIJ is set)." >&2
  echo "Use the base orchestrator instead." >&2
  exit 1
fi
