# SPDX-License-Identifier: Apache-2.0
"""Every `Agent(...)` grant in agents/*.agent-spec.json must name an agent this
package ships. A name that doesn't match one can never resolve in a plugin
install, so the delegation fails silently."""

import json
import os
import re
from pathlib import Path

import pytest

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


SPAWN_POLICY_RS = (
    Path(__file__).resolve().parent.parent
    / "cli/konductor-rs/src/cli/synth/spawn_policy.rs"
)


def _rust_str_array(source, const_name):
    match = re.search(rf"const {const_name}: \[&str; \d+\] =\s*\[([^\]]*)\]", source)
    assert match, f"{const_name} not found in {SPAWN_POLICY_RS}"
    names = re.findall(r'"([^"]+)"', match.group(1))
    assert names, f"{const_name} is empty in {SPAWN_POLICY_RS}"
    return set(names)


# `*` and `@builtin` include `subagent` on Kiro v2; the v2 transformer handles
# wildcards, so they are not spec-level spawn grants here.
KIRO_SPAWN_TOOLS = _rust_str_array(SPAWN_POLICY_RS.read_text(), "KIRO_SPAWN_TOOL_IDS")
CLAUDE_SPAWN_TOOLS = _rust_str_array(SPAWN_POLICY_RS.read_text(), "CLAUDE_SPAWN_TOOLS")


def _is_empty_target_list(settings):
    """`{"availableAgents": [], "trustedAgents": []}` leaves the Kiro CLI v2 `subagent`
    tool nothing to spawn; it is the block the specialists carry, not a grant."""
    return isinstance(settings, dict) and settings.get("availableAgents") == [] and settings.get("trustedAgents") == []


def _spawn_grants(spec):
    client = spec.get("clientConfig", {})
    kiro = client.get("kiroCli", {})
    grants = []
    for tool in kiro.get("tools", []):
        if tool in KIRO_SPAWN_TOOLS or tool.split("/")[0] in KIRO_SPAWN_TOOLS:
            grants.append(f"kiroCli.tools has {tool}")
    for tool in kiro.get("allowedTools", []):
        if tool in KIRO_SPAWN_TOOLS or tool.split("/")[0] in KIRO_SPAWN_TOOLS:
            grants.append(f"kiroCli.allowedTools has {tool}")
    for key, settings in kiro.get("toolsSettings", {}).items():
        if key in KIRO_SPAWN_TOOLS and not _is_empty_target_list(settings):
            grants.append(f"kiroCli.toolsSettings has {key}")
    for tool in client.get("claudeCli", {}).get("tools") or []:
        if tool.split("(")[0].strip() in CLAUDE_SPAWN_TOOLS:
            grants.append(f"claudeCli.tools has {tool}")
    return grants


def test_specialists_hold_no_spawn_grant():
    failures = []
    for spec_path in sorted(AGENTS_DIR.glob("*.agent-spec.json")):
        spec = json.loads(spec_path.read_text())
        if spec["name"].startswith("konductor"):
            continue
        failures.extend(f"{spec_path.name}: {grant}" for grant in _spawn_grants(spec))

    assert not failures, "specialists must not spawn agents:\n" + "\n".join(failures)


def test_specialists_carry_an_empty_kiro_v2_subagent_target_list():
    """Kiro CLI v2's `@builtin` includes `subagent`, and the v2 output keeps it; the empty
    lists give the tool no agent to spawn until the v2 tool list drops it."""
    failures = []
    for spec_path in sorted(AGENTS_DIR.glob("*.agent-spec.json")):
        spec = json.loads(spec_path.read_text())
        if spec["name"].startswith("konductor"):
            continue
        kiro = spec.get("clientConfig", {}).get("kiroCli", {})
        if "@builtin" not in kiro.get("tools", []):
            continue
        if not _is_empty_target_list(kiro.get("toolsSettings", {}).get("subagent")):
            failures.append(spec_path.name)

    assert not failures, "specialists with @builtin need an empty toolsSettings.subagent:\n" + "\n".join(failures)


def _generated_specialists(generated):
    """The dist/ cases skip until `make synth` has run; with KONDUCTOR_REQUIRE_FULL_BIN=1
    they fail instead, as tests/test_welcome_message_sops.py does."""
    out_dir = AGENTS_DIR.parent / generated
    if not out_dir.is_dir():
        reason = f"{generated} not found; run 'make synth' first"
        if os.environ.get("KONDUCTOR_REQUIRE_FULL_BIN") == "1":
            pytest.fail(reason)
        pytest.skip(reason)
    files = sorted(p for p in out_dir.glob("k-*.json") if not p.name.startswith("konductor"))
    assert files, f"no specialist output under {out_dir}"
    return [(p.name, json.loads(p.read_text())) for p in files]


def test_synth_kiro_v2_specialists_keep_the_empty_subagent_target_list():
    failures = [
        name
        for name, agent in _generated_specialists("dist/kiro-cli-v2/agents")
        if not _is_empty_target_list(agent.get("toolsSettings", {}).get("subagent"))
    ]
    assert not failures, "v2 output without an empty toolsSettings.subagent:\n" + "\n".join(failures)


def test_synth_kiro_v3_specialists_have_no_subagent_rule():
    failures = [
        name
        for name, agent in _generated_specialists("dist/kiro-v3/agents")
        if any(rule.get("capability") == "subagent" for rule in agent.get("permissions", {}).get("rules", []))
        or "toolsSettings" in agent
    ]
    assert not failures, "v3 output with a subagent rule or a toolsSettings block:\n" + "\n".join(failures)


def test_spawn_grants_ignores_an_empty_subagent_target_list():
    spec = {
        "clientConfig": {
            "kiroCli": {
                "tools": ["@builtin"],
                "toolsSettings": {"subagent": {"availableAgents": [], "trustedAgents": []}},
            }
        }
    }
    assert _spawn_grants(spec) == []
    spec["clientConfig"]["kiroCli"]["toolsSettings"]["subagent"]["availableAgents"] = ["k-developer"]
    assert _spawn_grants(spec) == ["kiroCli.toolsSettings has subagent"]


def test_spawn_grants_catches_every_alias():
    spec = {
        "clientConfig": {
            "kiroCli": {
                "tools": ["@builtin", "subagent", "use_subagent", "agent_crew", "subagent/k-developer", "*"],
                "allowedTools": ["fs_read", "use_subagent"],
                "toolsSettings": {"subagent": {}},
            },
            "claudeCli": {"tools": ["Read", "Agent", "Task", "Workflow", "Agent(k-developer)"]},
        }
    }
    assert _spawn_grants(spec) == [
        "kiroCli.tools has subagent",
        "kiroCli.tools has use_subagent",
        "kiroCli.tools has agent_crew",
        "kiroCli.tools has subagent/k-developer",
        "kiroCli.allowedTools has use_subagent",
        "kiroCli.toolsSettings has subagent",
        "claudeCli.tools has Agent",
        "claudeCli.tools has Task",
        "claudeCli.tools has Workflow",
        "claudeCli.tools has Agent(k-developer)",
    ]


def test_spawn_policy_vocabulary_is_read_from_the_rust_module():
    assert KIRO_SPAWN_TOOLS == {"subagent", "use_subagent", "agent_crew"}
    assert CLAUDE_SPAWN_TOOLS == {"Agent", "Task", "Workflow"}


def test_spawn_grants_ignores_ordinary_tools():
    spec = {
        "clientConfig": {
            "kiroCli": {"tools": ["@builtin", "@aws-mcp", "*"], "toolsSettings": {"shell": {}}},
            "claudeCli": {"tools": ["Read", "Bash", "mcp__aws-mcp__*"]},
        }
    }
    assert _spawn_grants(spec) == []
