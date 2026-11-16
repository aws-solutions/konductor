#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Rewrite bundled MCP tool grants for Claude Code plugin agent files.

Plugin MCP tools include the plugin name in their identifiers. This script
rewrites only YAML frontmatter for bundled servers and leaves bring-your-own
server grants and prompt bodies unchanged. It also drops each agent's
`mcpServers:` block, which Claude Code ignores for plugin agents; the plugin's
.mcp.json declares the servers instead. The drop is line-based and expects the
block style synth emits; it fails rather than write a file whose other
top-level keys changed.
"""

import argparse
import json
import re
import sys
from pathlib import Path

FRONTMATTER_FENCE = "---"
TOP_LEVEL_KEY_RE = re.compile(r"^([A-Za-z_][\w-]*):", re.M)


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
        if lines[index].rstrip() == FRONTMATTER_FENCE:
            return "\n".join(lines[: index + 1]), "\n".join(lines[index + 1 :]), True
    return "", text, False


def drop_mcp_servers_block(frontmatter: str) -> str:
    """Remove a top-level `mcpServers:` key and its indented value from frontmatter."""
    kept: list[str] = []
    in_block = False
    for line in frontmatter.split("\n"):
        if line.startswith("mcpServers:"):
            value = line[len("mcpServers:"):].strip()
            opened = value.count("[") + value.count("{")
            if opened != value.count("]") + value.count("}"):
                raise ValueError("mcpServers uses a multi-line flow value")
            in_block = True
            continue
        if in_block and (line.startswith((" ", "- ")) or not line.strip()):
            continue
        in_block = False
        kept.append(line)
    return "\n".join(kept)


def _top_level_keys(frontmatter: str) -> list[str]:
    return TOP_LEVEL_KEY_RE.findall(frontmatter)


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

    try:
        plugin_name = _plugin_name(args.plugin_json)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    files_changed = 0
    replacements = 0
    blocks_dropped = 0
    for md_path in sorted(args.agents_dir.glob("*.md")):
        frontmatter, body, has_frontmatter = _split_frontmatter(md_path.read_text(encoding="utf-8"))
        if not has_frontmatter:
            continue
        try:
            stripped = drop_mcp_servers_block(frontmatter)
        except ValueError as error:
            print(f"error: {md_path.name}: {error}; expected block-style YAML", file=sys.stderr)
            return 1
        expected_keys = [key for key in _top_level_keys(frontmatter) if key != "mcpServers"]
        if _top_level_keys(stripped) != expected_keys:
            print(
                f"error: {md_path.name}: dropping mcpServers changed other frontmatter keys; "
                "expected block-style YAML",
                file=sys.stderr,
            )
            return 1
        if stripped != frontmatter:
            blocks_dropped += 1
        rewritten, count = rewrite_frontmatter(stripped, plugin_name, bundled_servers)
        if rewritten == frontmatter:
            continue
        md_path.write_text(rewritten + "\n" + body, encoding="utf-8")
        files_changed += 1
        replacements += count

    print(
        f"rewrote {replacements} tool grant(s) and dropped {blocks_dropped} mcpServers "
        f"block(s) across {files_changed} file(s)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
