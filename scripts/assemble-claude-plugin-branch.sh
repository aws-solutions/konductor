#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Assembles the flat Claude Code plugin tree published via the
# plugin-candidate-branch + draft-PR flow into release/plugins.
# Usage: assemble-claude-plugin-branch.sh --out <dir>
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out)
      if [ $# -lt 2 ]; then
        echo "assemble-claude-plugin-branch.sh: --out requires a directory argument" >&2
        exit 64
      fi
      OUT="$2"
      shift 2
      ;;
    *)
      echo "assemble-claude-plugin-branch.sh: unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [ -z "$OUT" ]; then
  echo "assemble-claude-plugin-branch.sh: --out <dir> is required" >&2
  exit 64
fi
if [ -e "$OUT" ]; then
  echo "assemble-claude-plugin-branch.sh: $OUT already exists; refusing to overwrite" >&2
  exit 1
fi
if [ ! -f README.md ] || [ ! -f LICENSE.txt ]; then
  echo "error: [assemble-claude-plugin] README.md and/or LICENSE.txt not found at repo root" >&2
  exit 1
fi

"$REPO_ROOT/scripts/generate-claude-plugin.sh"

mkdir -p "$OUT/agents" "$OUT/skills" "$OUT/.claude-plugin"
cp generated/claude-plugin/agents/*.md "$OUT/agents/"

# Fails if a native skill and an SOP-derived skill share a name.
"$REPO_ROOT/scripts/copy-skills-with-collision-guard.sh" \
  --native "$REPO_ROOT/skills" \
  --sop "$REPO_ROOT/generated/claude-plugin/skills" \
  --out "$OUT/skills"

cp README.md "$OUT/README.md"
cp LICENSE.txt "$OUT/LICENSE.txt"

BUNDLED_MCP_SERVERS="$("$REPO_ROOT/scripts/read-bundled-mcp-servers.sh")"

python3 "$REPO_ROOT/scripts/render-claude-plugin-json.py" \
  --template "$REPO_ROOT/scripts/claude-plugin.template.json" \
  --version-file "$REPO_ROOT/VERSION" \
  --agents-dir "$OUT/agents" \
  --path-prefix "./" \
  --agent-specs-dir "$REPO_ROOT/agents" \
  --mcp-output "$OUT/.mcp.json" \
  --bundled-mcp-servers "$BUNDLED_MCP_SERVERS" \
  --output "$OUT/.claude-plugin/plugin.json"

# konductor synth (run by generate-claude-plugin.sh above) writes bare
# mcp__<server>__* grants, since it has no way to know a plugin name at
# that point. Rewrite them to the plugin-scoped form here, now that
# $OUT/.claude-plugin/plugin.json exists and carries that name, so a
# released plugin agent's tool grant matches what Claude Code actually
# namespaces a plugin MCP server's tools to.
python3 "$REPO_ROOT/scripts/rewrite-claude-plugin-mcp-tool-names.py" \
  --agents-dir "$OUT/agents" \
  --plugin-json "$OUT/.claude-plugin/plugin.json" \
  --bundled-mcp-servers "$BUNDLED_MCP_SERVERS"

echo "=== [assemble-claude-plugin] Done: flat plugin tree at $OUT ==="
