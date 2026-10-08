#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Rewrite bundled MCP tool grants for Claude Code plugin agent files.

Plugin MCP tools include the plugin name in their identifiers. This script
rewrites only YAML frontmatter for bundled servers and leaves bring-your-own
server grants and prompt bodies unchanged.
"""

import argparse
import json
import sys
from pathlib import Path

FRONTMATTER_FENCE = "---"


def _plugin_name(plugin_json_path: Path) -> str:
    plugin = json.loads(plugin_json_path.read_text(encoding="utf-8"))
    name = plugin.get("name")
    if not name or not isinstance(name, str):
        raise ValueError(f'{plugin_json_path}: missing or non-string "name" field')
    return name


def _split_frontmatter(text: str) -> tuple[str, str, bool]:
    """Return the frontmatter, body, and whether a complete frontmatter block exists."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != FRONTMATTER_FENCE:
        return "", text, False
    for index in range(1, len(lines)):
        if lines[index].strip() == FRONTMATTER_FENCE:
            return "\n".join(lines[: index + 1]), "\n".join(lines[index + 1 :]), True
    return "", text, False


def rewrite_frontmatter(frontmatter: str, plugin_name: str, bundled_servers: list[str]) -> tuple[str, int]:
    """Return frontmatter with bundled-server grants rewritten and a replacement count."""
    replacements = 0
    rewritten = frontmatter
    for server in bundled_servers:
        old_prefix = f"mcp__{server}__"
        new_prefix = f"mcp__plugin_{plugin_name}_{server}__"
        count = rewritten.count(old_prefix)
        if count:
            rewritten = rewritten.replace(old_prefix, new_prefix)
            replacements += count
    return rewritten, replacements


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--agents-dir",
        required=True,
        type=Path,
        help="Directory of generated Claude agent Markdown files",
    )
    parser.add_argument(
        "--plugin-json",
        required=True,
        type=Path,
        help='Rendered plugin.json used to read the plugin "name"',
    )
    parser.add_argument(
        "--bundled-mcp-servers",
        default="",
        help="Comma-separated MCP server names to rewrite",
    )
    args = parser.parse_args()

    if not args.agents_dir.is_dir():
        print(f"error: agents directory not found: {args.agents_dir}", file=sys.stderr)
        return 1
    if not args.plugin_json.is_file():
        print(f"error: plugin.json not found: {args.plugin_json}", file=sys.stderr)
        return 1

    bundled_servers = [server.strip() for server in args.bundled_mcp_servers.split(",") if server.strip()]
    if not bundled_servers:
        print("notice: no bundled MCP servers configured; nothing to rewrite")
        return 0

    try:
        plugin_name = _plugin_name(args.plugin_json)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    files_changed = 0
    replacements = 0
    for md_path in sorted(args.agents_dir.glob("*.md")):
        frontmatter, body, has_frontmatter = _split_frontmatter(md_path.read_text(encoding="utf-8"))
        if not has_frontmatter:
            continue
        rewritten, count = rewrite_frontmatter(frontmatter, plugin_name, bundled_servers)
        if count == 0:
            continue
        md_path.write_text(rewritten + body, encoding="utf-8")
        files_changed += 1
        replacements += count

    print(f"rewrote {replacements} tool grant(s) across {files_changed} file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
