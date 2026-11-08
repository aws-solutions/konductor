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
        assert "Before you say \"I can't\"" not in text, rel
        assert "wins over routing a note" not in text, rel


def test_every_skill_direct_work_names_is_declared_by_konductor():
    direct = (ROOT / "context" / "k-direct-work.md").read_text()
    on_disk = {p.name for p in (ROOT / "skills").iterdir() if p.is_dir()}
    named = {n for n in re.findall(r"`([a-z][a-z0-9-]+)`", direct) if n in on_disk}
    assert {
        "backend-development",
        "frontend-development",
        "design-evaluation",
        "plan-review",
        "design-impact-review",
        "infra-validation",
    } <= named
    spec = _spec("konductor")
    kiro = set(spec["dependencies"]["skills"]["skillNames"])
    claude = set(spec["clientConfig"]["claudeCli"]["skills"])
    assert named <= kiro, sorted(named - kiro)
    assert named <= claude, sorted(named - claude)


def _direct_work():
    return (ROOT / "context" / "k-direct-work.md").read_text(encoding="utf-8")


def test_konductor_commits_only_when_the_user_asks():
    text = _direct_work()
    assert "Commit only when the user asks, as `k-developer` does." in text
    assert "run commands, commit" not in text
    developer = json.loads((ROOT / "agents" / "k-developer.agent-spec.json").read_text(encoding="utf-8"))
    assert "Commit with a conventional commit message when the user asks" in developer["config"]["systemPrompt"]
    for rel in ("docs/user-guide/agents.md", "tools/build-user-guide/html_sop_edits.py"):
        body = (ROOT / rel).read_text(encoding="utf-8")
        assert "it commits when you ask" in body, rel


def test_bundle_reference_block_counts_konductor_skills_as_24():
    for rel in ("docs/index.html", "docs/site/user-guide.html"):
        body = (ROOT / rel).read_text(encoding="utf-8")
        assert "konductor skills (24)" in body, rel
        assert "konductor skills (22)" not in body, rel
        assert "Kiro CLI has the other 23 plus humanize-writing" in body, rel


def test_maker_side_checks_have_triggers_in_direct_work():
    text = _direct_work()
    assert "or one that deviates from a design doc, load `design-impact-review`" in text
    assert "after an infrastructure change (CDK, CloudFormation), load `infra-validation`" in text
    assert "git-workflow" not in text


def test_stack_skills_load_only_when_the_project_uses_the_stack():
    text = _direct_work()
    assert "when the project uses the skill's stack" in text
    assert "under the same stack condition" in text
    assert "review against the codebase's conventions" in text


def test_posture_bearing_documents_always_get_the_gate_review():
    assert "always gets the gate review" in _direct_work()


def test_spawned_writer_worktrees_are_merged_before_the_gate():
    direct = _direct_work()
    assert "integrated tree" in direct
    assert "commit its part on its worktree branch" in direct
    protocol = (ROOT / "skills" / "delegation-protocol" / "SKILL.md").read_text(encoding="utf-8")
    assert "integration tree" in protocol
    assert "commits its part on its worktree branch" in protocol


def test_an_undeclared_sop_runs_in_the_specialist_that_declares_it():
    direct = _direct_work()
    spawn_sentence = next(s for s in direct.split(". ") if "spawn a specialist in two cases only" in s)
    assert "an SOP you do not declare" in spawn_sentence
    assert "do not read its installed copy" in spawn_sentence
    assert "the `k-architect` design check your 2-Strike Circuit Breaker names" in spawn_sentence
    assert "k-code-review-workflow" not in direct
    spec = _spec("konductor")
    assert "k-code-review-workflow" not in spec["dependencies"]["agentSops"]["agentSopNames"]
    assert "spawn `k-architect` once" in spec["config"]["systemPrompt"]


ROUTING_SENTENCE = "route it to that specialist instead of doing it yourself"


def test_routing_rules_carry_the_specialist_skill_routing_sentence():
    text = (ROOT / "context" / "k-orchestrator-routing-rules.md").read_text(encoding="utf-8")
    assert ROUTING_SENTENCE in text


def test_direct_work_never_routes_a_listed_skill_away():
    text = _direct_work()
    assert ROUTING_SENTENCE not in text
    assert "Load a skill yourself when your skill tool lists it" in text
    assert "A skill you can load is never a reason to delegate" in text


def _shared():
    return (ROOT / "context" / SHARED).read_text(encoding="utf-8")


def test_shared_file_carries_the_capability_owner_table():
    text = _shared()
    assert "## Capability routing" in text
    rows = {line.split("|")[1].strip(): line for line in text.splitlines() if line.startswith("| ")}
    sharepoint = next(r for k, r in rows.items() if k.startswith("SharePoint"))
    slack = next(r for k, r in rows.items() if k.startswith("Slack"))
    pdfs = next(r for k, r in rows.items() if k.startswith("PDFs"))
    browser = next(r for k, r in rows.items() if k.startswith("Browser automation"))
    assert "`k-researcher`" in sharepoint and "`k-researcher`" in slack
    assert "`k-media-analyzer`" in pdfs
    assert "`k-browser`" in browser


def test_shape_files_do_not_carry_the_owner_table():
    for rel in ("k-direct-work.md", "k-orchestrator-routing-rules.md"):
        text = (ROOT / "context" / rel).read_text(encoding="utf-8")
        assert "| SharePoint" not in text, rel


def test_direct_work_treats_a_skill_miss_as_the_signal_to_spawn():
    direct = (ROOT / "context" / "k-direct-work.md").read_text(encoding="utf-8")
    assert "that miss is the answer" in direct
    assert direct.index(SOP_CLAUSE) < direct.index("spawn a specialist in two cases only")
