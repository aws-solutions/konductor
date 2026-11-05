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

if [ ! -x "$KONDUCTOR_BIN" ]; then
  echo "error: [claude-plugin] $KONDUCTOR_BIN not found; run 'make -C cli build' first" >&2
  exit 1
fi

# A relative --out is relative to the caller's directory, not the repo root.
case "$OUT" in
  /*) ;;
  *) OUT="$CALLER_DIR/$OUT" ;;
esac
mkdir -p "$OUT"
AGENTS_OUT_DIR="$OUT/agents"
SKILLS_OUT_DIR="$OUT/skills"
BUNDLED_MCP_SERVERS="$("$REPO_ROOT/scripts/read-bundled-mcp-servers.sh")"

SCRATCH_HOME=""
SCRATCH_TARGET=""
cleanup() {
  [ -z "$SCRATCH_HOME" ] || rm -rf "$SCRATCH_HOME"
  [ -z "$SCRATCH_TARGET" ] || rm -rf "$SCRATCH_TARGET"
}
trap cleanup EXIT

"$KONDUCTOR_BIN" synth --from . --claude-bundled-mcp-servers "$BUNDLED_MCP_SERVERS"

SCRATCH_HOME="$(mktemp -d)"
SCRATCH_TARGET="$(mktemp -d)"
HOME="$SCRATCH_HOME" "$KONDUCTOR_BIN" install --from . --harness claude \
  --target "$SCRATCH_TARGET" --no-telemetry

rm -rf "$AGENTS_OUT_DIR" "$SKILLS_OUT_DIR"
mkdir -p "$AGENTS_OUT_DIR" "$SKILLS_OUT_DIR"
cp dist/claude/agents/*.md "$AGENTS_OUT_DIR/"

for d in "$SCRATCH_TARGET"/.claude/skills/sop-*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  # This native skill shares the SOP-derived naming prefix.
  [ "$name" = "sop-state-management" ] && continue
  cp -r "$d" "$SKILLS_OUT_DIR/$name"
done
