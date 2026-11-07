# SPDX-License-Identifier: Apache-2.0
"""The adversarial SOP is coordinated by the orchestrator: spawns, no resume, a fresh checker."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SOP_NAME = "k-adversarial-pull-request-review"
SOP = (ROOT / "agent-sops" / f"{SOP_NAME}.sop.md").read_text(encoding="utf-8")
ORCHESTRATORS = ["konductor", "konductor-mux-orchestrator", "konductor-cmux-orchestrator"]


def section(heading):
    start = SOP.index(heading)
    end = SOP.find("\n## ", start + 1)
    next_step = SOP.find("\n### ", start + 1)
    if next_step != -1 and (end == -1 or next_step < end):
        end = next_step
    return SOP[start : end if end != -1 else len(SOP)]


def declared_sops(agent):
    spec = json.loads((ROOT / "agents" / f"{agent}.agent-spec.json").read_text(encoding="utf-8"))
    return spec["dependencies"]["agentSops"]["agentSopNames"]


def test_roles_name_the_orchestrator_as_coordinator_and_a_fresh_architect_checker():
    roles = section("## Roles")
    assert "the orchestrator running this SOP" in roles
    assert "spawned fresh in Step 4" in roles
    assert "`k-architect` and `k-developer` do not declare this SOP" in roles


def test_steps_2_and_3_spawn_and_never_return_a_split_or_note():
    for heading in ("### 2. Parallel Review Passes", "### 3. Reuse Pass"):
        step = section(heading)
        assert "spawn" in step.lower(), heading
        assert "split" not in step.lower(), heading
        assert "handoff note" not in step.lower(), heading


def test_missing_pass_is_recorded_after_one_respawn_and_caps_the_verdict():
    step_2 = section("### 2. Parallel Review Passes")
    assert "You MUST NOT run a pass yourself" in step_2
    assert "one re-spawn" in step_2
    assert "MISSING (<reason>)" in step_2
    step_3 = section("### 3. Reuse Pass")
    assert "reuse MISSING (<reason>)" in step_3
    step_6 = section("### 6. Verdict")
    assert "cap it at APPROVE WITH COMMENTS" in step_6
    assert "Passes run: {security, integrity, schema, reuse | <pass> MISSING (<reason>)}" in step_6


def test_step_4_spawns_the_checker_with_the_lists_unchanged():
    step_4 = section("### 4. Checker Phase")
    assert "Spawn `k-architect` fresh" in step_4
    assert "never add, drop or reword a finding" in step_4
    assert "the text of Steps 4 to 6 of this SOP including the report template" in step_4
    assert "never a session that ran a pass in this review" in step_4


def test_report_header_always_says_independence_held():
    assert "Checker independence: held\n" in SOP
    assert "not held" not in SOP
    assert "in-session" not in SOP


def test_no_resume_protocol_remains_in_the_sop():
    assert not re.search(r"resume|resumed|Resumed", SOP)
    assert ".konductor/handoff/" not in SOP


def test_quality_gate_pins_the_relay_and_the_missing_cap():
    gate = section("## Quality Gate")
    assert (
        "**A MISSING pass blocks APPROVE**: a lens that never ran caps the verdict at APPROVE WITH COMMENTS"
    ) in gate
    assert (
        "relay every findings list unchanged (never add, drop or reword a finding) and MUST NOT run a pass itself"
    ) in gate
    assert "spawned fresh in Step 4" in gate


def test_execution_context_note_bounds_the_coordinator_reads():
    overview = section("## Overview")
    assert "> **Execution context:**" in overview
    assert "Direct Work table (up to 10 files, read-only shell commands)" in overview
    assert "it does not read past it" in overview
    assert "one read-only `k-developer` spawn produces the Step 0 context summary" in overview
    assert "k-researcher` lacks on Claude Code" in overview
    assert "or a revision range to diff" in overview
    step_0 = section("### 0. Context Ramp-Up")
    assert "past the Direct Work read budget, You MUST spawn one read-only `k-developer` session" in step_0
    assert "the brief MUST forbid edits, builds and tests" in step_0
    assert "k-researcher" not in step_0
    step_1 = section("### 1. Ingest Diff")
    assert "For file paths or a revision range beyond that budget" in step_1
    assert "carry the paths or the revision range in every brief instead of their content" in step_1
    assert "as paths or a revision range beyond it" in step_1
    for heading in ("### 2. Parallel Review Passes", "### 3. Reuse Pass", "### 4. Checker Phase"):
        assert "or its file paths or revision range" in section(heading), heading


def test_the_context_spawn_agent_has_search_tools_on_claude_code():
    spec = json.loads((ROOT / "agents" / "k-developer.agent-spec.json").read_text(encoding="utf-8"))
    tools = spec["clientConfig"]["claudeCli"]["tools"]
    assert {"Grep", "Glob", "Read", "WebFetch"} <= set(tools)


def test_step_6_summary_is_returned_to_the_coordinator():
    step_6 = section("### 6. Verdict")
    assert "the summary you return" in step_6
    assert "You MUST return to the coordinator: verdict" in step_6
    assert "the coordinator presents that summary to the user unchanged (Step 4)" in step_6
    assert "display" not in step_6


@pytest.mark.parametrize("agent", ORCHESTRATORS)
def test_every_orchestrator_declares_the_sop(agent):
    assert SOP_NAME in declared_sops(agent)


def test_architect_no_longer_declares_the_sop():
    assert SOP_NAME not in declared_sops("k-architect")


def test_checker_skill_sends_direct_requests_to_konductor():
    skill = (ROOT / "skills" / "adversarial-code-review" / "SKILL.md").read_text(encoding="utf-8")
    assert "say to run it through `konductor`" in skill
