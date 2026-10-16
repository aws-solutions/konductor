#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Fails if an assembled Claude Code plugin tree has a top-level entry outside
# the set the marketplace plugin ships, so build output such as cli/ or dist/
# can never be published.
#
# Usage: check-claude-plugin-tree.sh <plugin-dir>
set -euo pipefail

PLUGIN_DIR="${1:?usage: check-claude-plugin-tree.sh <plugin-dir>}"
[ -d "$PLUGIN_DIR" ] || { echo "check-claude-plugin-tree.sh: '$PLUGIN_DIR' is not a directory" >&2; exit 1; }

ALLOWED=".claude-plugin .mcp.json LICENSE.txt README.md agents docs hooks skills"

unexpected=()
for entry in "$PLUGIN_DIR"/* "$PLUGIN_DIR"/.[!.]* "$PLUGIN_DIR"/..?*; do
  [ -e "$entry" ] || continue
  name="$(basename "$entry")"
  case " $ALLOWED " in
    *" $name "*) ;;
    *) unexpected+=("$name") ;;
  esac
done

if [ "${#unexpected[@]}" -gt 0 ]; then
  echo "FATAL: plugin tree '$PLUGIN_DIR' has unexpected top-level entries: ${unexpected[*]}" >&2
  echo "Allowed: $ALLOWED" >&2
  exit 1
fi
