#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Assembles the flat Claude Code plugin tree published to claude-plugin.
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
BUNDLED_MCP_CONFIG="$REPO_ROOT/scripts/claude-plugin-mcp-servers.json"

python3 "$REPO_ROOT/scripts/render-claude-plugin-json.py" \
  --template "$REPO_ROOT/scripts/claude-plugin.template.json" \
  --version-file "$REPO_ROOT/VERSION" \
  --agents-dir "$OUT/agents" \
  --path-prefix "./" \
  --agent-specs-dir "$REPO_ROOT/agents" \
  --mcp-output "$OUT/.mcp.json" \
  --bundled-mcp-servers "$BUNDLED_MCP_SERVERS" \
  --bundled-mcp-config "$BUNDLED_MCP_CONFIG" \
  --output "$OUT/.claude-plugin/plugin.json"

echo "=== [assemble-claude-plugin] Done: flat plugin tree at $OUT ==="
