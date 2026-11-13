# SPDX-License-Identifier: Apache-2.0
"""The Kiro spec skills and the kiro-spec-workflow SOP describe the spec format Kiro writes."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESIGN_SECTIONS = [
    "Overview",
    "Architecture",
    "Components and Interfaces",
    "Data Models",
    "Correctness Properties",
    "Error Handling",
    "Testing Strategy",
]


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_task_skill_example_has_a_dependency_graph_whose_waves_cover_every_leaf_task():
    text = _read("skills/kiro-task-generation/SKILL.md")
    example = text.split("````markdown", 1)[1].split("````", 1)[0]
    assert "## Task Dependency Graph" in example
    assert "```mermaid\nflowchart TD" in example
    ids = re.findall(r"^ *- \[ \]\*? (\d+(?:\.\d+)?)\.? ", example, re.M)
    parents = {i.split(".")[0] for i in ids if "." in i}
    leaves = sorted(i for i in ids if i not in parents)
    waves = json.loads(example.split("```json\n", 1)[1].split("```", 1)[0])["waves"]
    assert sorted(t for w in waves for t in w["tasks"]) == leaves
    assert [w["id"] for w in waves] == list(range(len(waves)))


def test_task_skill_marks_optional_tasks_and_checkpoints():
    text = _read("skills/kiro-task-generation/SKILL.md")
    assert "- [ ]*" in text
    assert "Checkpoint - " in text
    assert "**Validates: Requirements" in text
    assert "Tasks are ONLY coding tasks" not in text


def test_design_skill_lists_kiros_seven_sections_in_order():
    text = " ".join(_read("skills/kiro-design-generation/SKILL.md").split())
    assert "these 7 `##` sections in this order" in text
    assert ": " + ", ".join(DESIGN_SECTIONS) + "." in text
    assert "*For any*" in text
    assert "exactly these 6 sections" not in text


def test_requirements_skill_has_a_glossary_story_source_and_bugfix_sections():
    text = _read("skills/kiro-requirements-generation/SKILL.md")
    assert "## Glossary" in text
    assert "**Source:** [Story ID]" in text
    assert "1. WHEN [event], THE [system] SHALL [response]" in text
    for heading in (
        "### Current Behavior (Defect)",
        "### Expected Behavior (Correct)",
        "### Unchanged Behavior (Regression Prevention)",
    ):
        assert heading in text
    assert "SHALL CONTINUE TO" in text


def test_sop_takes_spec_type_and_workflow_and_writes_the_spec_config():
    text = _read("agent-sops/kiro-spec-workflow.sop.md")
    assert "- **spec_type** (optional, default `feature`)" in text
    assert "- **workflow** (optional, default `requirements-first`)" in text
    assert "`.config.kiro`" in text
    assert "/spec new {feature_name}" in text
    assert "present a traceability summary" not in text


def _step(text, number):
    return text.split(f"### {number}. ", 1)[1].split("\n### ", 1)[0]


def test_sop_leaves_the_spec_config_to_the_first_generation_delegate():
    text = _read("agent-sops/kiro-spec-workflow.sop.md")
    assert "You do not write it" in _step(text, 0)
    assert "write spec_dir/.config.kiro" in _step(text, 1)
    assert "write spec_dir/.config.kiro" in _step(text, 2)


def test_sop_offers_the_native_path_and_kiro_execution_only_when_standalone():
    text = _read("agent-sops/kiro-spec-workflow.sop.md")
    for number in (0, 4):
        step = _step(text, number)
        assert "standalone" in step
        assert "`.kiro/specs/{feature_name}/`" in step
    assert "/spec run {feature_name}" in _step(text, 4)
    assert "owns execution" in _step(text, 4)


def test_orchestrator_tables_count_the_sops_five_steps():
    steps = re.findall(r"^### (\d+)\. ", _read("agent-sops/kiro-spec-workflow.sop.md"), re.M)
    assert len(steps) == 5
    direct = _read("context/k-direct-work.md")
    assert re.search(r"^\| `kiro-spec-workflow` +\| 5 +\|", direct, re.M)
    routing = _read("context/k-orchestrator-routing-rules.md")
    assert re.search(r"\| `kiro-spec-workflow` +\| 5 +\|", routing)


def test_task_skill_waves_wait_only_for_required_leaves():
    text = " ".join(_read("skills/kiro-task-generation/SKILL.md").split())
    assert "every **required** leaf it uses" in text
    assert "An optional leaf sits in an earlier wave than the next checkpoint" in text


def test_requirements_skill_has_a_bugfix_checklist():
    text = _read("skills/kiro-requirements-generation/SKILL.md")
    assert "Before presenting a bugfix spec's bugfix.md, verify:" in text
    assert "its story IDs are authoritative" in text
