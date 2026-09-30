#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# read-bundled-mcp-servers.sh -- prints the comma-joined "bundled" MCP
# server allowlist from scripts/claude-plugin-mcp-servers.json to stdout.
#
# Single source of truth for which MCP servers Konductor packages with the
# Claude Code target (today: just aws-mcp -- everything else, e.g.
# k-browser's playwright-mcp, is bring-your-own). Both `konductor synth
# --claude-bundled-mcp-servers` (cli/konductor-rs/src/cli.rs) and
# render-claude-plugin-json.py's --bundled-mcp-servers flag need the exact
# same comma-separated list; this script is the one place that reads
# scripts/claude-plugin-mcp-servers.json's "bundled" object so
# generate-claude-plugin.sh and assemble-claude-plugin-branch.sh -- and the
# root Makefile's plain `synth` target -- can never pass the two callers a
# different list from the same config file. "bundled" is an object keyed
# by server name (each value is that server's own launch definition, read
# separately by --claude-bundled-mcp-config/--bundled-mcp-config); this
# script only ever prints the keys, never the launch definitions.
#
# Usage: BUNDLED_MCP_SERVERS="$(scripts/read-bundled-mcp-servers.sh)"
#    or: scripts/read-bundled-mcp-servers.sh /path/to/other-config.json
#
# Prints an empty string (not an error) when the "bundled" key is absent,
# so a caller that forgets to update its own config after an upstream
# schema change fails open into "nothing bundled" rather than aborting the
# whole build -- the same default `--claude-bundled-mcp-servers`/
# `--bundled-mcp-servers` already use when omitted entirely.
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
print(",".join(config.get("bundled", {}).keys()))
' "$CONFIG"
