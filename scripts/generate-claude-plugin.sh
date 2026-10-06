#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Regenerates Claude plugin agents, SOP-derived skills, plugin.json, and
# .mcp.json. Generated files are local build output and must not be committed.
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

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: [claude-plugin] python3 not found on PATH; required to render plugin.json" >&2
  exit 1
fi

AGENTS_OUT_DIR="$REPO_ROOT/generated/claude-plugin/agents"
SKILLS_OUT_DIR="$REPO_ROOT/generated/claude-plugin/skills"
PLUGIN_JSON_OUT="$REPO_ROOT/.claude-plugin/plugin.json"
MCP_JSON_OUT="$REPO_ROOT/.mcp.json"
AGENT_SPECS_DIR="$REPO_ROOT/agents"
BUNDLED_MCP_SERVERS="$("$REPO_ROOT/scripts/read-bundled-mcp-servers.sh")"
BUNDLED_MCP_CONFIG="$REPO_ROOT/scripts/claude-plugin-mcp-servers.json"

SCRATCH_HOME=""
SCRATCH_TARGET=""
cleanup() {
  [ -z "$SCRATCH_HOME" ] || rm -rf "$SCRATCH_HOME"
  [ -z "$SCRATCH_TARGET" ] || rm -rf "$SCRATCH_TARGET"
}
trap cleanup EXIT

"$KONDUCTOR_BIN" synth --from . --claude-bundled-mcp-servers "$BUNDLED_MCP_SERVERS" \
  --claude-bundled-mcp-config "$BUNDLED_MCP_CONFIG"

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

mkdir -p "$(dirname "$PLUGIN_JSON_OUT")"
python3 "$REPO_ROOT/scripts/render-claude-plugin-json.py" \
  --template "$REPO_ROOT/scripts/claude-plugin.template.json" \
  --version-file "$REPO_ROOT/VERSION" \
  --agents-dir "$AGENTS_OUT_DIR" \
  --agent-specs-dir "$AGENT_SPECS_DIR" \
  --mcp-output "$MCP_JSON_OUT" \
  --bundled-mcp-servers "$BUNDLED_MCP_SERVERS" \
  --bundled-mcp-config "$BUNDLED_MCP_CONFIG" \
  --output "$PLUGIN_JSON_OUT"

python3 "$REPO_ROOT/scripts/rewrite-claude-plugin-mcp-tool-names.py" \
  --agents-dir "$AGENTS_OUT_DIR" \
  --plugin-json "$PLUGIN_JSON_OUT" \
  --bundled-mcp-servers "$BUNDLED_MCP_SERVERS"

if command -v claude >/dev/null 2>&1; then
  # Validate the manifest file because the repository root resolves the marketplace manifest.
  claude plugin validate "$PLUGIN_JSON_OUT"
else
  echo "notice: [claude-plugin] 'claude' CLI not found on PATH; skipping plugin validation" >&2
fi
