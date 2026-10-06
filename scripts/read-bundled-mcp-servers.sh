#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Prints the comma-separated `bundled` MCP server names from
# scripts/claude-plugin-mcp-servers.json. Both plugin generators use this
# output, so malformed configuration must stop the build rather than publish
# an empty .mcp.json.
#
# Usage: BUNDLED_MCP_SERVERS="$(scripts/read-bundled-mcp-servers.sh)"
#    or: scripts/read-bundled-mcp-servers.sh /path/to/other-config.json
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${1:-$REPO_ROOT/scripts/claude-plugin-mcp-servers.json}"

if [ ! -f "$CONFIG" ]; then
  echo "error: [read-bundled-mcp-servers] config not found: $CONFIG" >&2
  exit 1
fi

python3 -c '
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    config = json.load(f)
if not isinstance(config, dict) or "bundled" not in config:
    raise SystemExit("error: [read-bundled-mcp-servers] config must contain a bundled object")
if not isinstance(config["bundled"], dict):
    raise SystemExit("error: [read-bundled-mcp-servers] bundled must be an object")
print(",".join(config["bundled"].keys()))
' "$CONFIG"
