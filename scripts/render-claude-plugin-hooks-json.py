#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Render the plugin's hooks/hooks.json for the telemetry hook.

SessionStart (startup|clear) reports agent_invocation and SubagentStart
reports subagent_invocation, the same events the CLI wires into Claude
Code settings. The SubagentStart matcher is built from the assembled
agents/*.md, so a new agent can't be left out. Claude Code names plugin
agents `<plugin>:<agent>`; the matcher also accepts the bare name.

Called by scripts/assemble-claude-plugin-branch.sh.
"""
import argparse
import json
import re
import sys
from pathlib import Path

HOOK_SCRIPT = "hooks/konductor-telemetry.js"


def frontmatter_name(agent_file: Path):
    lines = agent_file.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    for line in lines[1:]:
        if line.strip() == "---":
            return None
        match = re.match(r"^name:\s*['\"]?([^'\"\s]+)['\"]?\s*$", line)
        if match:
            return match.group(1)
    return None


def agent_names(agents_dir: Path):
    names = []
    for agent_file in sorted(agents_dir.glob("*.md")):
        if agent_file.name.startswith("_"):
            continue
        name = frontmatter_name(agent_file)
        # The hook filters on file names, so they must match what Claude
        # Code reports as agent_type.
        if name != agent_file.stem:
            raise ValueError(
                f"{agent_file.name}: frontmatter name {name!r} does not match the file name"
            )
        names.append(name)
    return names


def command(event_type: str) -> dict:
    return {
        "type": "command",
        "command": f'node "${{CLAUDE_PLUGIN_ROOT}}/{HOOK_SCRIPT}" {event_type}',
        "async": True,
    }


def regex_escape(text: str) -> str:
    # Same character set as the CLI's installed_agents_matcher, so a
    # JavaScript regex compiled with or without the `u` flag accepts it.
    return "".join("\\" + c if c in "\\^$.|?*+()[]{}/" else c for c in text)


def render(plugin_name: str, names) -> dict:
    alternatives = "|".join(regex_escape(name) for name in sorted(set(names)))
    return {
        "hooks": {
            "SessionStart": [
                {"matcher": "startup|clear", "hooks": [command("agent-invocation")]}
            ],
            "SubagentStart": [
                {
                    "matcher": f"^({regex_escape(plugin_name)}:)?({alternatives})$",
                    "hooks": [command("subagent-invocation")],
                }
            ],
        }
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agents-dir", required=True, type=Path)
    parser.add_argument("--plugin-json", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    plugin_name = json.loads(args.plugin_json.read_text(encoding="utf-8")).get("name")
    if not plugin_name:
        print(f"error: no plugin name in {args.plugin_json}", file=sys.stderr)
        return 1
    try:
        names = agent_names(args.agents_dir)
    except ValueError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    if not names:
        print(f"error: no agent .md files found under {args.agents_dir}", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(render(plugin_name, names), indent=2) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
