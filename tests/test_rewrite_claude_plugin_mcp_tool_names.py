# SPDX-License-Identifier: Apache-2.0
"""Regression tests for scripts/rewrite-claude-plugin-mcp-tool-names.py.

Confirms the plugin-scoped MCP tool-name rewrite:
- only touches servers named in --bundled-mcp-servers (aws-mcp today),
  leaving a bring-your-own server's grant (playwright-mcp) bare;
- only rewrites the YAML frontmatter block, never the agent's prompt body,
  even when the body happens to contain the same substring;
- reads the plugin name from the given plugin.json file, not a hardcoded
  "konductor" string;
- is idempotent (a second run over its own output is a no-op).

Run:  cd tests && pytest test_rewrite_claude_plugin_mcp_tool_names.py -v
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "rewrite-claude-plugin-mcp-tool-names.py"

AGENT_MD_TEMPLATE = """---
name: {name}
description: d
model: m
tools:
- Read
- Skill
- mcp__{server}__*
skills:
- example-skill
---

# {name}

This prose body mentions mcp__{server}__* too, but it must never be
rewritten -- only the frontmatter block above is in scope.
"""


def _write_plugin_json(path: Path, name: str) -> None:
    path.write_text(json.dumps({"name": name, "agents": []}), encoding="utf-8")


def _run(agents_dir: Path, plugin_json: Path, bundled_mcp_servers: str):
    argv = [
        sys.executable,
        str(SCRIPT),
        "--agents-dir",
        str(agents_dir),
        "--plugin-json",
        str(plugin_json),
        "--bundled-mcp-servers",
        bundled_mcp_servers,
    ]
    return subprocess.run(argv, capture_output=True, text=True)


def test_bundled_server_frontmatter_grant_is_rewritten_to_plugin_scoped_name(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "k-architect.md").write_text(
        AGENT_MD_TEMPLATE.format(name="k-architect", server="aws-mcp"), encoding="utf-8"
    )
    plugin_json = tmp_path / "plugin.json"
    _write_plugin_json(plugin_json, "konductor")

    result = _run(agents_dir, plugin_json, "aws-mcp")
    assert result.returncode == 0, result.stderr

    rewritten = (agents_dir / "k-architect.md").read_text(encoding="utf-8")
    assert "mcp__plugin_konductor_aws-mcp__*" in rewritten, rewritten
    assert "mcp__aws-mcp__*" not in rewritten.split("---", 2)[1], (
        "the bare grant must not remain in the frontmatter block, got:\n" + rewritten
    )


def test_byo_server_grant_is_left_bare(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "k-browser.md").write_text(
        AGENT_MD_TEMPLATE.format(name="k-browser", server="playwright-mcp"), encoding="utf-8"
    )
    plugin_json = tmp_path / "plugin.json"
    _write_plugin_json(plugin_json, "konductor")

    # aws-mcp is the only bundled server; playwright-mcp is BYO and must
    # stay bare even though the script ran.
    result = _run(agents_dir, plugin_json, "aws-mcp")
    assert result.returncode == 0, result.stderr

    unchanged = (agents_dir / "k-browser.md").read_text(encoding="utf-8")
    assert "mcp__playwright-mcp__*" in unchanged
    assert "mcp__plugin_konductor_playwright-mcp__*" not in unchanged


def test_prose_body_is_never_rewritten_even_though_it_contains_the_same_substring(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "k-architect.md").write_text(
        AGENT_MD_TEMPLATE.format(name="k-architect", server="aws-mcp"), encoding="utf-8"
    )
    plugin_json = tmp_path / "plugin.json"
    _write_plugin_json(plugin_json, "konductor")

    result = _run(agents_dir, plugin_json, "aws-mcp")
    assert result.returncode == 0, result.stderr

    rewritten = (agents_dir / "k-architect.md").read_text(encoding="utf-8")
    body = rewritten.split("---", 2)[2]
    assert "mcp__aws-mcp__*" in body, (
        "expected the prose body's mention to survive unrewritten, got:\n" + body
    )
    assert "mcp__plugin_konductor_aws-mcp__*" not in body


def test_plugin_name_comes_from_the_plugin_json_file_not_a_hardcoded_string(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "k-architect.md").write_text(
        AGENT_MD_TEMPLATE.format(name="k-architect", server="aws-mcp"), encoding="utf-8"
    )
    plugin_json = tmp_path / "plugin.json"
    _write_plugin_json(plugin_json, "totally-different-plugin-name")

    result = _run(agents_dir, plugin_json, "aws-mcp")
    assert result.returncode == 0, result.stderr

    rewritten = (agents_dir / "k-architect.md").read_text(encoding="utf-8")
    assert "mcp__plugin_totally-different-plugin-name_aws-mcp__*" in rewritten, rewritten
    assert "konductor" not in rewritten


def test_rewrite_is_idempotent(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "k-architect.md").write_text(
        AGENT_MD_TEMPLATE.format(name="k-architect", server="aws-mcp"), encoding="utf-8"
    )
    plugin_json = tmp_path / "plugin.json"
    _write_plugin_json(plugin_json, "konductor")

    first = _run(agents_dir, plugin_json, "aws-mcp")
    assert first.returncode == 0, first.stderr
    once = (agents_dir / "k-architect.md").read_text(encoding="utf-8")

    second = _run(agents_dir, plugin_json, "aws-mcp")
    assert second.returncode == 0, second.stderr
    twice = (agents_dir / "k-architect.md").read_text(encoding="utf-8")

    assert once == twice


def test_empty_bundled_mcp_servers_is_a_no_op(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    original = AGENT_MD_TEMPLATE.format(name="k-architect", server="aws-mcp")
    (agents_dir / "k-architect.md").write_text(original, encoding="utf-8")
    plugin_json = tmp_path / "plugin.json"
    _write_plugin_json(plugin_json, "konductor")

    result = _run(agents_dir, plugin_json, "")
    assert result.returncode == 0, result.stderr

    assert (agents_dir / "k-architect.md").read_text(encoding="utf-8") == original


# k-architect/k-developer's real grant is five explicit per-tool entries
# (mcp__aws-mcp__aws___search_documentation, etc.), not a mcp__aws-mcp__* wildcard --
# the panel's tool-narrowing decision (only the AWS knowledge tools are
# granted by default; the AWS-API-acting tools are opt-in). The rewrite is a
# plain `mcp__<server>__` prefix substring replace (see the script's own
# module docstring), so it is agnostic to what follows the prefix -- this
# test confirms that holds for a real per-tool suffix, not just the `*`
# wildcard every other test in this file exercises.
PER_TOOL_AGENT_MD_TEMPLATE = """---
name: {name}
description: d
model: m
tools:
- Read
- Skill
- mcp__{server}__aws___search_documentation
- mcp__{server}__aws___retrieve_skill
- mcp__{server}__aws___read_documentation
- mcp__{server}__aws___list_regions
- mcp__{server}__aws___get_regional_availability
skills:
- example-skill
---

# {name}
"""


def test_per_tool_grants_are_rewritten_not_just_wildcard_grants(tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "k-architect.md").write_text(
        PER_TOOL_AGENT_MD_TEMPLATE.format(name="k-architect", server="aws-mcp"), encoding="utf-8"
    )
    plugin_json = tmp_path / "plugin.json"
    _write_plugin_json(plugin_json, "konductor")

    result = _run(agents_dir, plugin_json, "aws-mcp")
    assert result.returncode == 0, result.stderr

    rewritten = (agents_dir / "k-architect.md").read_text(encoding="utf-8")
    for tool in [
        "aws___search_documentation",
        "aws___retrieve_skill",
        "aws___read_documentation",
        "aws___list_regions",
        "aws___get_regional_availability",
    ]:
        assert f"mcp__plugin_konductor_aws-mcp__{tool}" in rewritten, (
            f"expected {tool}'s per-tool grant to be rewritten to the plugin-scoped name, "
            f"got:\n{rewritten}"
        )
        assert f"mcp__aws-mcp__{tool}" not in rewritten.split("---", 2)[1], (
            f"expected {tool}'s bare grant not to survive in the frontmatter block, "
            f"got:\n{rewritten}"
        )
