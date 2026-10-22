# SPDX-License-Identifier: Apache-2.0
"""Tests for scripts/rewrite-claude-plugin-agent-grants.py and its call from
scripts/assemble-claude-plugin-branch.sh.

Claude Code names plugin agents "<plugin>:<agent>", so a bare Agent(k-developer)
grant leaves a plugin-only install with no subagents it can delegate to.

Run:  cd tests && pytest test_rewrite_claude_plugin_agent_grants.py -v
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "rewrite-claude-plugin-agent-grants.py"
ASSEMBLE = REPO_ROOT / "scripts" / "assemble-claude-plugin-branch.sh"
KONDUCTOR_BIN = REPO_ROOT / "build" / "cli" / "konductor"

AGENT_GRANT_RE = re.compile(r"\bAgent\(([^)]*)\)")

AGENT_MD = """---
name: {name}
description: d
tools:
- Read
- {grant}
---

# {name}

Delegate with Agent(k-developer) when needed.
"""


def _write_tree(tmp_path, plugin_name, agents):
    """agents maps an agent name to its Agent(...) grant line."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    for name, grant in agents.items():
        (agents_dir / f"{name}.md").write_text(AGENT_MD.format(name=name, grant=grant), encoding="utf-8")
    plugin_json = tmp_path / "plugin.json"
    plugin_json.write_text(
        json.dumps({"name": plugin_name, "agents": [f"./agents/{name}.md" for name in agents]}),
        encoding="utf-8",
    )
    return agents_dir, plugin_json


def _run(agents_dir, plugin_json):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--agents-dir", str(agents_dir), "--plugin-json", str(plugin_json)],
        capture_output=True,
        text=True,
    )


def _frontmatter(text):
    return text.split("---", 2)[1]


def test_prefixes_every_grant_name_with_the_plugin_name(tmp_path):
    agents_dir, plugin_json = _write_tree(
        tmp_path,
        "acme",
        {
            "lead": "Agent(k-developer, k-quality-assurance)",
            "k-developer": "Write",
            "k-quality-assurance": "Agent(k-developer)",
        },
    )

    result = _run(agents_dir, plugin_json)

    assert result.returncode == 0, result.stderr
    lead = (agents_dir / "lead.md").read_text(encoding="utf-8")
    assert "- Agent(acme:k-developer, acme:k-quality-assurance)" in _frontmatter(lead)
    assert "Agent(k-developer) when needed" in lead.split("---", 2)[2]
    qa = (agents_dir / "k-quality-assurance.md").read_text(encoding="utf-8")
    assert "- Agent(acme:k-developer)" in _frontmatter(qa)


def test_second_run_is_a_no_op(tmp_path):
    agents_dir, plugin_json = _write_tree(tmp_path, "acme", {"lead": "Agent(worker)", "worker": "Write"})
    assert _run(agents_dir, plugin_json).returncode == 0
    first = (agents_dir / "lead.md").read_text(encoding="utf-8")

    result = _run(agents_dir, plugin_json)

    assert result.returncode == 0, result.stderr
    assert (agents_dir / "lead.md").read_text(encoding="utf-8") == first


def test_unknown_agent_name_fails_and_leaves_files_untouched(tmp_path):
    agents_dir, plugin_json = _write_tree(
        tmp_path, "acme", {"lead": "Agent(worker, missing-agent)", "worker": "Agent(worker)"}
    )
    before = {path.name: path.read_text(encoding="utf-8") for path in agents_dir.glob("*.md")}

    result = _run(agents_dir, plugin_json)

    assert result.returncode != 0
    assert "missing-agent" in result.stderr
    after = {path.name: path.read_text(encoding="utf-8") for path in agents_dir.glob("*.md")}
    assert after == before


def test_name_qualified_with_another_plugin_fails(tmp_path):
    agents_dir, plugin_json = _write_tree(tmp_path, "acme", {"lead": "Agent(other:worker)", "worker": "Write"})

    result = _run(agents_dir, plugin_json)

    assert result.returncode != 0
    assert "other:worker" in result.stderr


@pytest.mark.skipif(not KONDUCTOR_BIN.is_file(), reason=f"{KONDUCTOR_BIN} not found; run 'make -C cli build' first")
def test_assembled_tree_grants_are_prefixed_and_name_shipped_agents(tmp_path):
    out = tmp_path / "claude-plugin-branch"
    env = dict(os.environ, KONDUCTOR_BIN=str(KONDUCTOR_BIN))
    result = subprocess.run(
        ["bash", str(ASSEMBLE), "--out", str(out)], cwd=REPO_ROOT, env=env, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr

    plugin = json.loads((out / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    shipped = {f"{plugin['name']}:{Path(path).stem}" for path in plugin["agents"]}
    names = []
    for agent_file in sorted((out / "agents").glob("*.md")):
        for match in AGENT_GRANT_RE.finditer(_frontmatter(agent_file.read_text(encoding="utf-8"))):
            names.extend((agent_file.name, part.strip()) for part in match.group(1).split(","))

    assert names, "expected at least one Agent(...) grant in the assembled agents"
    unresolved = [f"{file}: {name}" for file, name in names if name not in shipped]
    assert not unresolved, "Agent(...) grants not naming a shipped plugin agent:\n" + "\n".join(unresolved)


@pytest.mark.parametrize("after_fence", ["\n\n# k-architect\n", "\n# k-architect\n"])
def test_only_the_grant_changes_and_the_fence_spacing_is_kept(tmp_path, after_fence):
    agents_dir, plugin_json = _write_tree(tmp_path, "konductor", {"k-architect": "Agent(k-developer)", "k-developer": "Read"})
    original = "---\nname: k-architect\ndescription: d\ntools:\n- Agent(k-developer)\n---" + after_fence
    (agents_dir / "k-architect.md").write_text(original, encoding="utf-8")

    result = _run(agents_dir, plugin_json)

    assert result.returncode == 0, result.stderr
    expected = original.replace("Agent(k-developer)", "Agent(konductor:k-developer)")
    assert (agents_dir / "k-architect.md").read_text(encoding="utf-8") == expected


@pytest.mark.parametrize(
    "original",
    [
        "# lead\n\nno frontmatter, Agent(missing-agent)\n",
        "---\nname: lead\ntools:\n- Agent(missing-agent)\n",
    ],
    ids=["none", "unterminated"],
)
def test_agent_file_without_frontmatter_fails_before_writing(tmp_path, original):
    agents_dir, plugin_json = _write_tree(tmp_path, "acme", {"lead": "Read", "worker": "Agent(worker)"})
    (agents_dir / "lead.md").write_text(original, encoding="utf-8")
    before = {path.name: path.read_text(encoding="utf-8") for path in agents_dir.glob("*.md")}

    result = _run(agents_dir, plugin_json)

    assert result.returncode != 0
    assert "lead.md" in result.stderr
    assert {path.name: path.read_text(encoding="utf-8") for path in agents_dir.glob("*.md")} == before


def test_indented_fence_in_a_block_scalar_does_not_end_the_frontmatter(tmp_path):
    agents_dir, plugin_json = _write_tree(tmp_path, "acme", {"lead": "Read", "worker": "Read"})
    original = "---\nname: lead\ndescription: |\n  intro\n  ---\n  more\ntools:\n- Agent(worker)\n---\n# lead\n"
    (agents_dir / "lead.md").write_text(original, encoding="utf-8")

    result = _run(agents_dir, plugin_json)

    assert result.returncode == 0, result.stderr
    expected = original.replace("Agent(worker)", "Agent(acme:worker)")
    assert (agents_dir / "lead.md").read_text(encoding="utf-8") == expected
