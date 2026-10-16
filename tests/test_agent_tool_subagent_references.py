# SPDX-License-Identifier: Apache-2.0
"""Regression test: every `Agent(...)` tool-grant entry in this package's own
`agents/*.agent-spec.json` files must name agents that are actually shipped
in this plugin (another spec in this same `agents/` directory), and must
never carry an internal package-install prefix like
`ASDLCCoreAICapabilities-`.

Background: `clientConfig.claudeCli.tools` can grant `Agent(name1, name2)` to
let an agent delegate to specific sub-agents via Claude Code's `Agent` tool.
k-architect's spec once granted `Agent(ASDLCCoreAICapabilities-k-developer,
ASDLCCoreAICapabilities-k-quality-assurance)` -- a name that only resolves
inside the internal monorepo this package is mirrored from, never inside a
public marketplace plugin install, where the shipped agents are named
`k-developer` and `k-quality-assurance` with no package prefix (see
`konductor.agent-spec.json` and `k-quality-assurance.agent-spec.json`, which
already grant `Agent(...)` with bare names). A prefixed name in `Agent(...)`
can never resolve to an installed agent, so the delegation silently fails.

This package is consumed by downstream packages from the version set, not
from a sibling checkout, so this test is fully self-contained: it only
walks this package's own `agents/` directory.

Run:  cd tests && pytest test_agent_tool_subagent_references.py -v
"""

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = REPO_ROOT / "agents"

AGENT_TOOL_RE = re.compile(r"^Agent\((.*)\)$")

# Any hyphenated segment that looks like an internal package/registry
# install prefix on an agent name (e.g. "ASDLCCoreAICapabilities-k-developer",
# "local-ASDLCCoreAICapabilities-k-developer"). Shipped agent names in this
# package are always bare, e.g. "k-developer", "konductor-mux-orchestrator".
INTERNAL_PREFIX_RE = re.compile(r"ASDLCCoreAICapabilities")


def _load_json(path):
    return json.loads(path.read_text())


def _build_name_index(agents_dir):
    """Map agent name -> spec path, scanning every *.agent-spec.json in
    `agents_dir`."""
    index = {}
    for spec_path in sorted(agents_dir.glob("*.agent-spec.json")):
        spec = _load_json(spec_path)
        name = spec.get("name", spec_path.stem.replace(".agent-spec", ""))
        index[name] = spec_path
    return index


def _agent_tool_entries(spec):
    """Return every `Agent(...)` entry's inner, comma-split agent names from
    this spec's own clientConfig.claudeCli.tools list (empty list if the
    field is absent or has no Agent(...) entry)."""
    tools = spec.get("clientConfig", {}).get("claudeCli", {}).get("tools") or []
    names = []
    for tool in tools:
        match = AGENT_TOOL_RE.match(tool)
        if not match:
            continue
        names.extend(part.strip() for part in match.group(1).split(","))
    return names


def test_agent_tool_references_have_no_internal_package_prefix():
    specs = sorted(AGENTS_DIR.glob("*.agent-spec.json"))
    assert specs, f"no agent specs found in {AGENTS_DIR}"

    failures = []
    for spec_path in specs:
        spec = _load_json(spec_path)
        for name in _agent_tool_entries(spec):
            if INTERNAL_PREFIX_RE.search(name):
                failures.append(f"{spec_path.name}: Agent(...) names {name!r}")

    assert not failures, (
        "The following agent specs grant Agent(...) tool access to a name "
        "carrying an internal package-install prefix, which cannot resolve "
        "to a shipped agent in a public plugin install:\n" + "\n".join(failures)
    )


def test_agent_tool_references_resolve_to_a_shipped_agent():
    index = _build_name_index(AGENTS_DIR)
    specs = sorted(AGENTS_DIR.glob("*.agent-spec.json"))
    assert specs, f"no agent specs found in {AGENTS_DIR}"

    failures = []
    for spec_path in specs:
        spec = _load_json(spec_path)
        for name in _agent_tool_entries(spec):
            if name not in index:
                failures.append(f"{spec_path.name}: Agent(...) names {name!r}, not shipped in {AGENTS_DIR}")

    assert not failures, (
        "The following agent specs grant Agent(...) tool access to a name "
        "that does not match any agent shipped in this package's own "
        "agents/ directory:\n" + "\n".join(failures)
    )


def test_agent_tool_regex_extracts_comma_separated_names():
    spec = {
        "clientConfig": {
            "claudeCli": {
                "tools": ["Read", "Agent(k-developer, k-quality-assurance)"],
            }
        }
    }
    assert _agent_tool_entries(spec) == ["k-developer", "k-quality-assurance"]


def test_agent_tool_regex_ignores_specs_with_no_agent_entry():
    spec = {"clientConfig": {"claudeCli": {"tools": ["Read", "Write"]}}}
    assert _agent_tool_entries(spec) == []


def test_internal_prefix_detection(tmp_path):
    assert INTERNAL_PREFIX_RE.search("ASDLCCoreAICapabilities-k-developer")
    assert INTERNAL_PREFIX_RE.search("local-ASDLCCoreAICapabilities-k-developer")
    assert not INTERNAL_PREFIX_RE.search("k-developer")
