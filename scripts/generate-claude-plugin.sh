#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Regenerates the Claude plugin's intermediate build output:
# generated/claude-plugin/{agents,skills}/, rendered from
# agents/*.agent-spec.json via `konductor synth` and from
# agent-sops/*.sop.md via `konductor install --harness claude`'s
# SOP-to-skill conversion. This is local build output and must not be
# committed.
#
# This script does not render a plugin.json or .mcp.json itself -- the
# only Claude Code plugin layout this repo ships is the flat tree
# scripts/assemble-claude-plugin-branch.sh assembles (which calls this
# script first, then renders those two files at the flat tree's own root).
# A prior revision additionally wrote a second, repo-root plugin.json/
# .mcp.json pair for local testing; that shape was dropped because it
# duplicated the flat tree's generation and validation path for no
# functional difference. See generated/claude-plugin/README.md.
#
# Usage: generate-claude-plugin.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

KONDUCTOR_BIN="${KONDUCTOR_BIN:-build/cli/konductor}"

if [ $# -gt 0 ]; then
  echo "generate-claude-plugin.sh: unexpected argument(s): $*" >&2
  exit 64
fi

if [ ! -x "$KONDUCTOR_BIN" ]; then
  echo "error: [claude-plugin] $KONDUCTOR_BIN not found; run 'make -C cli build' first" >&2
  exit 1
fi

AGENTS_OUT_DIR="$REPO_ROOT/generated/claude-plugin/agents"
SKILLS_OUT_DIR="$REPO_ROOT/generated/claude-plugin/skills"
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
  name="$(basename "$d")"
  # This native skill shares the SOP-derived naming prefix.
  [ "$name" = "sop-state-management" ] && continue
  cp -r "$d" "$SKILLS_OUT_DIR/$name"
done
