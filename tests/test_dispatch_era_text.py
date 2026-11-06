# SPDX-License-Identifier: Apache-2.0
"""Skills and SOPs read correctly when konductor does the work itself in auto mode."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _read(rel):
    return " ".join((ROOT / rel).read_text(encoding="utf-8").split())


def test_delegation_protocol_names_the_shared_owner_table_and_coordinator_mode():
    text = _read("skills/delegation-protocol/SKILL.md")
    assert "quick-reference summary loaded at startup" not in text
    assert "read by `konductor` in `coordinator` mode" in text


def test_sdlc_navigator_routes_through_the_orchestrator():
    text = _read("skills/sdlc-navigator/SKILL.md")
    assert "spawn the next agent as a subagent" not in text
    assert "ask the orchestrator to route the next phase to that agent" in text


def test_pre_planning_analysis_states_the_auto_mode_behavior():
    text = _read("skills/pre-planning-analysis/SKILL.md")
    assert "spawns the named agent only as `k-direct-work.md` allows" in text


def test_kiro_spec_workflow_orchestrator_does_not_load_the_skills():
    assert "does not look these skills up" in _read("agent-sops/kiro-spec-workflow.sop.md")
