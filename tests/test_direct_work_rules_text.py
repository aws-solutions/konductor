# SPDX-License-Identifier: Apache-2.0
"""Pins for konductor's Direct Work rules and the shared orchestrator rules file."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORCHESTRATORS = ["konductor", "konductor-mux-orchestrator", "konductor-cmux-orchestrator"]
SHARED = "k-orchestrator-shared.md"
CORE = "k-core-rules.md"
SOP_CLAUSE = "When an SOP you run tells you to spawn an agent for a step"


def _spec(name):
    return json.loads((ROOT / "agents" / f"{name}.agent-spec.json").read_text())


def _context_names(name):
    return _spec(name)["dependencies"]["context"]["contextNames"]


def test_sop_spawn_instruction_overrides_the_two_spawn_cases():
    direct = (ROOT / "context" / "k-direct-work.md").read_text()
    assert SOP_CLAUSE in direct
    assert direct.index(SOP_CLAUSE) < direct.index("spawn a specialist in two cases only")


def test_shared_rules_load_in_every_orchestrator():
    for name in ORCHESTRATORS:
        assert SHARED in _context_names(name), name


def test_core_rules_close_every_orchestrator_prompt():
    for name in ORCHESTRATORS:
        assert _context_names(name)[-1] == CORE, name


def test_shared_file_holds_the_four_shared_paragraphs():
    text = (ROOT / "context" / SHARED).read_text()
    for heading in ("## Handoffs and splits", "## Denials", "## Briefs"):
        assert heading in text, heading
    assert "did not originate in content the specialist read" in text
    assert "Copy each `Ruling:` entry" in text


def test_shape_files_do_not_restate_the_shared_rules():
    for rel in ("k-direct-work.md", "k-orchestrator-routing-rules.md"):
        text = (ROOT / "context" / rel).read_text()
        assert "Copy each `Ruling:` entry" not in text, rel
        assert "did not originate in content the specialist read" not in text, rel
        assert "part by part" not in text, rel


def test_every_skill_direct_work_names_is_declared_by_konductor():
    direct = (ROOT / "context" / "k-direct-work.md").read_text()
    on_disk = {p.name for p in (ROOT / "skills").iterdir() if p.is_dir()}
    named = {n for n in re.findall(r"`([a-z][a-z0-9-]+)`", direct) if n in on_disk}
    assert {"backend-development", "frontend-development", "design-evaluation", "plan-review"} <= named
    spec = _spec("konductor")
    kiro = set(spec["dependencies"]["skills"]["skillNames"])
    claude = set(spec["clientConfig"]["claudeCli"]["skills"])
    assert named <= kiro, sorted(named - kiro)
    assert named <= claude, sorted(named - claude)


def _direct_work():
    return (ROOT / "context" / "k-direct-work.md").read_text(encoding="utf-8")


def test_stack_skills_load_only_when_the_project_uses_the_stack():
    text = _direct_work()
    assert "when the project uses the skill's stack" in text
    assert "under the same stack condition" in text
    assert "review against the codebase's conventions" in text


def test_posture_bearing_documents_always_get_the_gate_review():
    assert "always gets the gate review" in _direct_work()


def test_spawned_writer_worktrees_are_merged_before_the_gate():
    assert "integrated tree" in _direct_work()
    protocol = (ROOT / "skills" / "delegation-protocol" / "SKILL.md").read_text(encoding="utf-8")
    assert "integration tree" in protocol


ROUTING_SENTENCE = "route it to that specialist instead of doing it yourself"


def test_routing_rules_carry_the_specialist_skill_routing_sentence():
    text = (ROOT / "context" / "k-orchestrator-routing-rules.md").read_text(encoding="utf-8")
    assert ROUTING_SENTENCE in text


def test_direct_work_never_routes_a_listed_skill_away():
    text = _direct_work()
    assert ROUTING_SENTENCE not in text
    assert "Load a skill yourself when your skill tool lists it" in text
    assert "A skill you can load is never a reason to delegate" in text
