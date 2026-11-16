# SPDX-License-Identifier: Apache-2.0
"""The per-agent SOP rows of agents.md and the bundles' per-agent SOP figures match the specs.

`make guide-check` compares the roster table at the top of agents.md with the specs. The
per-agent sections further down the same page, the bundles' at-a-glance cards and the
"three orchestrators" rows are written by hand and kept the old counts when a SOP moved
from one agent to another.
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
AGENTS_DOC = (ROOT / "docs" / "user-guide" / "agents.md").read_text(encoding="utf-8")
BUNDLES = {
    name: (ROOT / "docs" / name).read_text(encoding="utf-8")
    for name in ("index.html", "site/user-guide.html")
}
ORCHESTRATORS = ["konductor", "konductor-mux-orchestrator", "konductor-cmux-orchestrator"]


def declared_sops(agent):
    spec = json.loads((ROOT / "agents" / f"{agent}.agent-spec.json").read_text(encoding="utf-8"))
    return spec["dependencies"]["agentSops"]["agentSopNames"]


def all_agents():
    return sorted(p.name.removesuffix(".agent-spec.json") for p in (ROOT / "agents").glob("*.agent-spec.json"))


def sop_rows_by_section():
    """Map each agent named in a `### ` heading to that section's `**SOPs**` row cell."""
    rows = {}
    sections = re.split(r"^### ", AGENTS_DOC, flags=re.MULTILINE)[1:]
    for section in sections:
        heading, _, body = section.partition("\n")
        agents = re.findall(r"`([\w-]+)`", heading)
        match = re.search(r"^\| \*\*SOPs\*\*(?: \((\d+)\))? \| (.*?) \|$", body, flags=re.MULTILINE)
        if not agents or not match:
            continue
        count = int(match.group(1)) if match.group(1) else None
        cell = re.split(r"\. | \u2014 ", match.group(2), maxsplit=1)[0]
        names = re.findall(r"`([\w-]+)`", cell)
        for agent in agents:
            rows[agent] = (count, names)
    return rows


SOP_ROWS = sop_rows_by_section()


@pytest.mark.parametrize("agent", all_agents())
def test_every_agent_section_lists_the_declared_sops(agent):
    assert agent in SOP_ROWS, f"agents.md has no `### `{agent}`` section with a **SOPs** row"
    count, names = SOP_ROWS[agent]
    want = declared_sops(agent)
    assert names == want, f"{agent}: agents.md lists {names}, the spec declares {want}"
    if count is not None:
        assert count == len(want), f"{agent}: agents.md says SOPs ({count}), the spec declares {len(want)}"


@pytest.mark.parametrize("agent", ORCHESTRATORS + ["k-architect"])
def test_agents_that_declare_many_sops_state_the_count(agent):
    count, _ = SOP_ROWS[agent]
    assert count == len(declared_sops(agent))


CARD = re.compile(r'k: \\"([\w-]+)\\", v: \\"[^\\]*? claude-sonnet-5\.5 · (\d+) skills · (\d+) SOPs?')


@pytest.mark.parametrize("bundle", sorted(BUNDLES))
def test_bundle_cards_state_the_declared_sop_counts(bundle):
    cards = {agent: int(sops) for agent, _skills, sops in CARD.findall(BUNDLES[bundle])}
    assert set(ORCHESTRATORS + ["k-architect", "k-developer", "k-quality-assurance"]) <= set(cards)
    wrong = {agent: (n, len(declared_sops(agent))) for agent, n in cards.items() if n != len(declared_sops(agent))}
    assert not wrong, f"{bundle} cards say (card, spec): {wrong}"


ORCHESTRATOR_ROW = re.compile(r'k: \\"(konductor|mux / cmux) SOPs \((\d+)\)\\", v: \\"([^\\]*)\\"')


@pytest.mark.parametrize("bundle", sorted(BUNDLES))
def test_bundle_orchestrator_rows_list_the_declared_sops(bundle):
    rows = {label: (int(n), v) for label, n, v in ORCHESTRATOR_ROW.findall(BUNDLES[bundle])}
    assert set(rows) == {"konductor", "mux / cmux"}
    for label, agent in (("konductor", "konductor"), ("mux / cmux", "konductor-mux-orchestrator")):
        count, cell = rows[label]
        names = re.split(r"\. | \u2014 ", cell, maxsplit=1)[0].split(", ")
        want = declared_sops(agent)
        assert names == want, f"{bundle} {label} SOPs row lists {names}, the spec declares {want}"
        assert count == len(want)
    assert declared_sops("konductor-mux-orchestrator") == declared_sops("konductor-cmux-orchestrator")
