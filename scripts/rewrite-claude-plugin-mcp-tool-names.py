#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Rewrites bundled-MCP-server tool grants in generated Claude plugin agent
files from their bare standalone-install form (`mcp__<server>__<tool>`) to
the real plugin-scoped tool name Claude Code actually resolves when that
agent is loaded from a plugin: `mcp__plugin_<pluginName>_<server>__<tool>`
(confirmed live against a local, zero-network mock MCP server -- hyphens in
both the plugin name and the server name are preserved literally, never
normalized to underscores).

Why this is needed at all: a plugin subagent's `tools:` frontmatter is
matched against the tool names Claude Code actually registers for that
agent's *plugin* MCP connection, which are namespaced by plugin name
(`plugin:<pluginName>:<server>` -> `mcp__plugin_<pluginName>_<server>__
<tool>`), not the bare `mcp__<server>__<tool>` name a standalone
`.claude/agents/` install resolves against (see
cli/konductor-rs/src/cli/synth/claude.rs's own module docstring for the
standalone side of this same distinction). Without this rewrite, a bundled
server's tool grant in the plugin-rendered agent file would name a tool
that doesn't exist under the plugin's actual namespacing, so the agent
would never be able to call it.

Scope: ONLY servers named in --bundled-mcp-servers (sourced from
scripts/claude-plugin-mcp-servers.json's "bundled" list, e.g. "aws-mcp")
are rewritten. Everything else -- e.g. k-browser's playwright-mcp -- is
bring-your-own: the user configures it themselves under the bare
`playwright-mcp` name on every harness, so its `mcp__playwright-mcp__*`
grant is left untouched here, matching the standalone install's own bare
grant for the same server.

Scope: ONLY the YAML frontmatter block (between the two `---` fences) of
each *.md file is rewritten -- never the agent's own prompt body below it,
even if that body happens to mention the same substring in prose. Within
the frontmatter, every list/scalar value under `tools:`, `allowedTools:`,
and `disallowedTools:` is rewritten (today, in practice, only `tools:` is
ever populated for k-architect/k-developer -- see this script's own test
file for the empirical confirmation that `allowedTools:`/`disallowedTools:`
are unmodeled and `hooks:` is unset for every agent this repo ships). This
is implemented as a literal substring replacement, not a YAML parse: the
frontmatter is entirely synth's own deterministic output (see
`render_agent_md` in claude.rs), so its exact list-item shape is already
known and stable, and avoiding a YAML dependency keeps this script
runnable with nothing beyond the Python 3 standard library.

Idempotent: running this script twice against its own already-rewritten
output is a no-op the second time, since the OLD prefix
(`mcp__<server>__`) no longer appears once rewritten to the NEW one.

Called by scripts/generate-claude-plugin.sh, after
render-claude-plugin-json.py has written .claude-plugin/plugin.json (this
script's own --plugin-json source for the plugin name) -- not meant to be
run standalone, though it works that way too.
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
        raise ValueError(f"{plugin_json_path}: missing or non-string \"name\" field")
    return name


def _split_frontmatter(text: str):
    """Splits `text` into (frontmatter, body, has_frontmatter). `body`
    includes the closing fence and everything after it unchanged, so
    re-joining frontmatter + body always reproduces the original file
    when frontmatter is unchanged. `has_frontmatter` is False (and
    frontmatter is "") when `text` does not open with a `---` fence on
    its first line -- callers must leave such files untouched rather
    than guessing at a fence that isn't there."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != FRONTMATTER_FENCE:
        return "", text, False
    for i in range(1, len(lines)):
        if lines[i].strip() == FRONTMATTER_FENCE:
            frontmatter = "\n".join(lines[: i + 1])
            body = "\n".join(lines[i + 1 :])
            return frontmatter, body, True
    # Opening fence with no closing fence: malformed, leave untouched.
    return "", text, False


def rewrite_frontmatter(frontmatter: str, plugin_name: str, bundled_servers) -> tuple[str, int]:
    """Returns (new_frontmatter, replacement_count). Rewrites every
    occurrence of `mcp__<server>__` to `mcp__plugin_<plugin_name>_
    <server>__`, for each server in `bundled_servers`, within
    `frontmatter` only."""
    replaced = 0
    rewritten = frontmatter
    for server in bundled_servers:
        old_prefix = f"mcp__{server}__"
        new_prefix = f"mcp__plugin_{plugin_name}_{server}__"
        count = rewritten.count(old_prefix)
        if count:
            rewritten = rewritten.replace(old_prefix, new_prefix)
            replaced += count
    return rewritten, replaced


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--agents-dir",
        required=True,
        type=Path,
        help="Directory of rendered Claude plugin agent *.md files to rewrite in place "
        "(generated/claude-plugin/agents/)",
    )
    parser.add_argument(
        "--plugin-json",
        required=True,
        type=Path,
        help="Rendered .claude-plugin/plugin.json to read the plugin's \"name\" field "
        "from -- the plugin name comes from here, never a hardcoded string",
    )
    parser.add_argument(
        "--bundled-mcp-servers",
        default="",
        help="Comma-separated list of MCP server names to rewrite (e.g. 'aws-mcp'). "
        "Empty (the default) is a no-op: no file is touched.",
    )
    args = parser.parse_args()

    if not args.agents_dir.is_dir():
        print(f"error: agents directory not found: {args.agents_dir}", file=sys.stderr)
        return 1
    if not args.plugin_json.is_file():
        print(f"error: plugin.json not found: {args.plugin_json}", file=sys.stderr)
        return 1

    bundled_servers = [s.strip() for s in args.bundled_mcp_servers.split(",") if s.strip()]
    if not bundled_servers:
        print("notice: [rewrite-claude-plugin-mcp-tool-names] no bundled MCP servers "
              "configured -- nothing to rewrite")
        return 0

    try:
        plugin_name = _plugin_name(args.plugin_json)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    total_files_changed = 0
    total_replacements = 0
    for md_path in sorted(args.agents_dir.glob("*.md")):
        original = md_path.read_text(encoding="utf-8")
        frontmatter, body, has_frontmatter = _split_frontmatter(original)
        if not has_frontmatter:
            continue
        rewritten_frontmatter, count = rewrite_frontmatter(
            frontmatter, plugin_name, bundled_servers
        )
        if count == 0:
            continue
        md_path.write_text(rewritten_frontmatter + body, encoding="utf-8")
        total_files_changed += 1
        total_replacements += count
        print(
            f"=== [rewrite-claude-plugin-mcp-tool-names] {md_path.name}: "
            f"{count} tool grant(s) rewritten to plugin-scoped names ==="
        )

    print(
        f"=== [rewrite-claude-plugin-mcp-tool-names] done: {total_replacements} "
        f"replacement(s) across {total_files_changed} file(s) ==="
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
