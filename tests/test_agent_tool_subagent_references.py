# SPDX-License-Identifier: Apache-2.0
"""Every `Agent(...)` grant in agents/*.agent-spec.json must name an agent this
package ships. A name that doesn't match one can never resolve in a plugin
install, so the delegation fails silently."""

import json
import re
from pathlib import Path

AGENTS_DIR = Path(__file__).resolve().parent.parent / "agents"

AGENT_TOOL_RE = re.compile(r"^Agent\((.*)\)$")


def _shipped_agent_names():
    names = set()
    for spec_path in AGENTS_DIR.glob("*.agent-spec.json"):
        spec = json.loads(spec_path.read_text())
        names.add(spec.get("name", spec_path.name.removesuffix(".agent-spec.json")))
    return names


def _agent_tool_entries(spec):
    tools = spec.get("clientConfig", {}).get("claudeCli", {}).get("tools") or []
    names = []
    for tool in tools:
        match = AGENT_TOOL_RE.match(tool)
        if match:
            names.extend(part.strip() for part in match.group(1).split(","))
    return names


def test_agent_tool_references_resolve_to_a_shipped_agent():
    shipped = _shipped_agent_names()
    assert shipped, f"no agent specs found in {AGENTS_DIR}"

    failures = []
    for spec_path in sorted(AGENTS_DIR.glob("*.agent-spec.json")):
        spec = json.loads(spec_path.read_text())
        for name in _agent_tool_entries(spec):
            if name not in shipped:
                failures.append(f"{spec_path.name}: Agent(...) names {name!r}")

    assert not failures, "Agent(...) grants that match no shipped agent:\n" + "\n".join(failures)


def test_agent_tool_entries_splits_comma_separated_names():
    spec = {"clientConfig": {"claudeCli": {"tools": ["Read", "Agent(k-developer, k-quality-assurance)"]}}}
    assert _agent_tool_entries(spec) == ["k-developer", "k-quality-assurance"]


def test_agent_tool_entries_ignores_specs_without_an_agent_grant():
    spec = {"clientConfig": {"claudeCli": {"tools": ["Read", "Write"]}}}
    assert _agent_tool_entries(spec) == []


def test_specialists_hold_no_spawn_grant():
    failures = []
    for spec_path in sorted(AGENTS_DIR.glob("k-*.agent-spec.json")):
        spec = json.loads(spec_path.read_text())
        client = spec.get("clientConfig", {})
        kiro = client.get("kiroCli", {})
        if "subagent" in kiro.get("tools", []):
            failures.append(f"{spec_path.name}: kiroCli.tools has subagent")
        if "subagent" in kiro.get("toolsSettings", {}):
            failures.append(f"{spec_path.name}: kiroCli.toolsSettings has subagent")
        if _agent_tool_entries(spec):
            failures.append(f"{spec_path.name}: claudeCli.tools has Agent(...)")

    assert not failures, "specialists must not spawn agents:\n" + "\n".join(failures)
