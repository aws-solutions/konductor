# SPDX-License-Identifier: Apache-2.0
"""Skills and SOPs state the shipped behavior: konductor does the work itself. No orchestration
mode exists at this head, so no skill names one."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _read(rel):
    return " ".join((ROOT / rel).read_text(encoding="utf-8").split())


def test_delegation_protocol_names_the_shared_owner_table_without_a_mode():
    text = _read("skills/delegation-protocol/SKILL.md")
    assert "quick-reference summary loaded at startup" not in text
    assert "loaded at startup by the mux and cmux orchestrators. When any of them conflicts" in text
    assert (
        "`konductor` does these tasks itself and spawns only as `context/k-direct-work.md` says; "
        "the When to Spawn column names the owner when it does."
    ) in text


def test_no_skill_names_an_orchestration_mode():
    for rel in ("skills/delegation-protocol/SKILL.md", "skills/pre-planning-analysis/SKILL.md"):
        text = _read(rel)
        assert "`auto` mode" not in text, rel
        assert "`coordinator` mode" not in text, rel


def test_sdlc_navigator_routes_through_the_orchestrator():
    text = _read("skills/sdlc-navigator/SKILL.md")
    assert "spawn the next agent as a subagent" not in text
    assert "ask the orchestrator to route the next phase to that agent" in text


def test_pre_planning_analysis_states_the_shipped_behavior():
    text = _read("skills/pre-planning-analysis/SKILL.md")
    assert (
        "The acting agent does the phase itself and loads the skills the owner would; "
        "an orchestrator spawns the named agent only as its direct-work rules allow."
    ) in text
    assert "Route to: `" not in text
    assert text.count("Owner: ") == 6


def test_kiro_spec_workflow_orchestrator_does_not_load_the_skills():
    assert "does not look these skills up" in _read("agent-sops/kiro-spec-workflow.sop.md")
