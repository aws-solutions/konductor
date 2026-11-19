#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Writes the Claude plugin's intermediate build output into <dir>/agents/
# and <dir>/skills/, rendered from agents/*.agent-spec.json via
# `konductor synth` and from agent-sops/*.sop.md via
# `konductor install --harness claude`'s SOP-to-skill conversion.
# scripts/assemble-claude-plugin-branch.sh passes a temporary directory;
# `make claude-plugin` passes dist/claude-plugin/, which is gitignored.
#
# <dir> is replaced as a whole, so it is checked first. The script refuses
# the repo root or any ancestor of it, any path inside the repo outside
# dist/, and a non-empty directory without the marker file this script
# leaves in every output. Output is built in a sibling staging directory
# and moved into place only when complete.
#
# This script does not render a plugin.json or .mcp.json itself -- the
# only Claude Code plugin layout this repo ships is the flat tree
# scripts/assemble-claude-plugin-branch.sh assembles (which calls this
# script first, then renders those two files at the flat tree's own root).
# A prior revision additionally wrote a second, repo-root plugin.json/
# .mcp.json pair for local testing; that shape was dropped because it
# duplicated the flat tree's generation and validation path for no
# functional difference. See docs/guides/claude-plugin-build.md.
#
# Usage: generate-claude-plugin.sh --out <dir>
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CALLER_DIR="$PWD"
cd "$REPO_ROOT"

KONDUCTOR_BIN="${KONDUCTOR_BIN:-build/cli/konductor}"

OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out)
      if [ $# -lt 2 ]; then
        echo "generate-claude-plugin.sh: --out requires a directory argument" >&2
        exit 64
      fi
      OUT="$2"
      shift 2
      ;;
    *)
      echo "generate-claude-plugin.sh: unexpected argument: $1" >&2
      exit 64
      ;;
  esac
done

if [ -z "$OUT" ]; then
  echo "generate-claude-plugin.sh: --out <dir> is required" >&2
  exit 64
fi

MARKER=".konductor-claude-plugin-out"

refuse() {
  echo "generate-claude-plugin.sh: refusing --out '$OUT': $1" >&2
  exit 1
}

# A relative --out is relative to the caller's directory, not the repo root.
case "$OUT" in
  /*) ;;
  *) OUT="$CALLER_DIR/$OUT" ;;
esac
# Resolve symlinks and '..' (the path may not exist yet). python3 rather
# than `realpath -m`, which macOS lacks.
canonical() { python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"; }
OUT="$(canonical "$OUT")"
ROOT="$(canonical "$REPO_ROOT")"

[ "$OUT" != "/" ] || refuse "it is the filesystem root"
case "$ROOT/" in
  "$OUT"/*) refuse "it is the repository root or an ancestor of it" ;;
esac
case "$OUT/" in
  "$ROOT"/dist/?*) ;;
  "$ROOT"/*) refuse "inside the repository it must be under dist/" ;;
esac
if [ -e "$OUT" ] || [ -L "$OUT" ]; then
  [ -d "$OUT" ] || refuse "it exists and is not a directory"
  if [ -n "$(ls -A "$OUT")" ] && [ ! -f "$OUT/$MARKER" ]; then
    refuse "it is a non-empty directory this script did not create (no $MARKER); remove it or pass another --out"
  fi
fi

if [ ! -x "$KONDUCTOR_BIN" ]; then
  echo "error: [claude-plugin] $KONDUCTOR_BIN not found; run 'make -C cli build' first" >&2
  exit 1
fi

BUNDLED_MCP_SERVERS="$("$REPO_ROOT/scripts/read-bundled-mcp-servers.sh")"

SCRATCH_HOME=""
SCRATCH_TARGET=""
STAGE=""
OLD=""
cleanup() {
  [ -z "$SCRATCH_HOME" ] || rm -rf "$SCRATCH_HOME"
  [ -z "$SCRATCH_TARGET" ] || rm -rf "$SCRATCH_TARGET"
  [ -z "$STAGE" ] || rm -rf "$STAGE"
  [ -z "$OLD" ] || rm -rf "$OLD"
}
trap cleanup EXIT

"$KONDUCTOR_BIN" synth --from . --claude-bundled-mcp-servers "$BUNDLED_MCP_SERVERS"

SCRATCH_HOME="$(mktemp -d)"
SCRATCH_TARGET="$(mktemp -d)"
HOME="$SCRATCH_HOME" "$KONDUCTOR_BIN" install --from . --harness claude \
  --target "$SCRATCH_TARGET" --no-telemetry

# Created after synth, which writes under dist/. Same parent as OUT, so the
# final moves are renames on one filesystem.
mkdir -p "$(dirname "$OUT")"
STAGE="$(mktemp -d "$(dirname "$OUT")/.claude-plugin-out.XXXXXX")"
AGENTS_OUT_DIR="$STAGE/agents"
SKILLS_OUT_DIR="$STAGE/skills"
mkdir -p "$AGENTS_OUT_DIR" "$SKILLS_OUT_DIR"
cp dist/claude/agents/*.md "$AGENTS_OUT_DIR/"

for d in "$SCRATCH_TARGET"/.claude/skills/sop-*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  # This native skill shares the SOP-derived naming prefix.
  [ "$name" = "sop-state-management" ] && continue
  cp -r "$d" "$SKILLS_OUT_DIR/$name"
done

: > "$STAGE/$MARKER"
# Swap the finished output in. A failure before this point leaves OUT as it
# was; the staging directory is removed on exit.
if [ -e "$OUT" ]; then
  OLD="$(mktemp -d "$(dirname "$OUT")/.claude-plugin-old.XXXXXX")"
  mv "$OUT" "$OLD/out"
fi
mv "$STAGE" "$OUT"
STAGE=""
