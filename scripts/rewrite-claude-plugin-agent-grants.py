#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Rewrite Agent(...) tool grants for Claude Code plugin agent files.

Claude Code names plugin agents "<plugin>:<agent>", and a bare grant such as
Agent(k-developer) does not match them. This script prefixes every name in an
Agent(...) frontmatter grant with the plugin name. It fails, writing nothing,
if a grant names an agent the plugin does not ship or an agent file has no
frontmatter. Prompt bodies are left unchanged.
"""

import argparse
import json
import re
import sys
from pathlib import Path

FRONTMATTER_FENCE = "---"
AGENT_GRANT_RE = re.compile(r"\bAgent\(([^)]*)\)")


def _load_plugin(plugin_json_path: Path) -> tuple[str, set[str]]:
    plugin = json.loads(plugin_json_path.read_text(encoding="utf-8"))
    name = plugin.get("name")
    if not name or not isinstance(name, str):
        raise ValueError(f'{plugin_json_path}: missing or non-string "name" field')
    agents = plugin.get("agents") or []
    if not isinstance(agents, list):
        raise ValueError(f'{plugin_json_path}: "agents" must be a list of paths')
    return name, {Path(path).stem for path in agents}


def _split_frontmatter(text: str) -> tuple[str, str, bool]:
    """Return the frontmatter, body, and whether a complete frontmatter block exists."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != FRONTMATTER_FENCE:
        return "", text, False
    for index in range(1, len(lines)):
        if lines[index].rstrip() == FRONTMATTER_FENCE:
            return "\n".join(lines[: index + 1]), "\n".join(lines[index + 1 :]), True
    return "", text, False


def rewrite_frontmatter(frontmatter: str, plugin_name: str, shipped: set[str]) -> tuple[str, int, list[str]]:
    """Return the rewritten frontmatter, the number of names prefixed, and unknown names."""
    prefix = f"{plugin_name}:"
    prefixed = 0
    unknown: list[str] = []

    def _qualify(name: str) -> str:
        nonlocal prefixed
        bare = name.removeprefix(prefix)
        if bare not in shipped:
            unknown.append(name)
            return name
        if name == bare:
            prefixed += 1
        return prefix + bare

    def _rewrite_grant(match: re.Match) -> str:
        names = [part.strip() for part in match.group(1).split(",") if part.strip()]
        return "Agent(" + ", ".join(_qualify(name) for name in names) + ")"

    return AGENT_GRANT_RE.sub(_rewrite_grant, frontmatter), prefixed, unknown


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
        help='Rendered plugin.json used to read the plugin "name" and "agents"',
    )
    args = parser.parse_args()

    if not args.agents_dir.is_dir():
        print(f"error: agents directory not found: {args.agents_dir}", file=sys.stderr)
        return 1
    if not args.plugin_json.is_file():
        print(f"error: plugin.json not found: {args.plugin_json}", file=sys.stderr)
        return 1

    try:
        plugin_name, shipped = _load_plugin(args.plugin_json)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    rewrites: dict[Path, str] = {}
    prefixed_total = 0
    failures: list[str] = []
    for md_path in sorted(args.agents_dir.glob("*.md")):
        frontmatter, body, has_frontmatter = _split_frontmatter(md_path.read_text(encoding="utf-8"))
        if not has_frontmatter:
            failures.append(f"{md_path.name}: no --- frontmatter block, so its grants cannot be checked")
            continue
        rewritten, prefixed, unknown = rewrite_frontmatter(frontmatter, plugin_name, shipped)
        failures.extend(f"{md_path.name}: Agent(...) names {name!r}" for name in unknown)
        if rewritten != frontmatter:
            rewrites[md_path] = rewritten + "\n" + body
            prefixed_total += prefixed

    if failures:
        print(
            f"error: Agent(...) grants cannot be prefixed for the {plugin_name} plugin:\n  "
            + "\n  ".join(failures),
            file=sys.stderr,
        )
        return 1

    for md_path, text in rewrites.items():
        md_path.write_text(text, encoding="utf-8")
    print(f"prefixed {prefixed_total} Agent() grant name(s) across {len(rewrites)} file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
