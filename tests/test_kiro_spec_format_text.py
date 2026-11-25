# SPDX-License-Identifier: Apache-2.0
"""The Kiro spec skills and the kiro-spec-workflow SOP describe the spec format Kiro writes.

The wave checks run against the task skill's own example, and against any generated
specs pointed at by KIRO_EXAMPLE_SPECS: a directory holding one sub-directory per
example, each with a `.kiro/specs/<name>/` inside it. Without that variable the
generated-spec cases skip.
"""

import json
import os
import re
from pathlib import Path

import pytest

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
GENERATED_EXAMPLES = ("feature", "bugfix", "feature-design-first")


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _task_skill_example():
    text = _read("skills/kiro-task-generation/SKILL.md")
    return text.split("````markdown", 1)[1].split("````", 1)[0]


def _generated_spec(name):
    """The tasks.md directory of a generated example, or None when it is not there."""
    root = os.environ.get("KIRO_EXAMPLE_SPECS")
    if not root:
        return None
    specs = Path(root) / name / ".kiro" / "specs"
    if not specs.is_dir():
        return None
    return next((d for d in sorted(specs.iterdir()) if (d / "tasks.md").is_file()), None)


class Plan:
    """The leaves, flowchart edges and waves of one tasks.md."""

    def __init__(self, text):
        rows = re.findall(r"^( *)- \[ \](\*?) (\d+(?:\.\d+)?)\.? (.*)$", text, re.M)
        self.ids = [r[2] for r in rows]
        self.optional = {r[2] for r in rows if r[1] == "*"}
        self.titles = {r[2]: r[3] for r in rows}
        self.parents = {i.split(".")[0] for i in self.ids if "." in i}
        self.leaves = [i for i in self.ids if i not in self.parents]
        self.depends_on = {}
        for src, dst in re.findall(
            r"^ *T(\d+)(?:\[[^\]]*\])? *--> *T(\d+)(?:\[[^\]]*\])? *$", text, re.M
        ):
            self.depends_on.setdefault(dst, []).append(src)
        self.waves = json.loads(text.split("```json\n", 1)[1].split("```", 1)[0])["waves"]
        self.placed = {t: w["id"] for w in self.waves for t in w["tasks"]}

    def is_checkpoint(self, leaf):
        return "heckpoint" in self.titles.get(leaf, "")

    def leaves_of(self, top):
        if top in self.parents:
            return [i for i in self.ids if i.startswith(top + ".")]
        return [top] if top in self.leaves else []

    def required_predecessors(self, leaf, seen=()):
        """The required leaves `leaf` waits on, with any checkpoint swapped for its own."""
        if leaf in seen:
            return []
        top = leaf.split(".")[0]
        candidates = []
        for dep in self.depends_on.get(top, []):
            candidates += self.leaves_of(dep)
        if "." in leaf:
            index = int(leaf.split(".")[1])
            candidates += [
                s
                for s in self.leaves_of(top)
                if "." in s and int(s.split(".")[1]) < index
            ]
        out = []
        for candidate in candidates:
            if candidate in self.optional:
                continue
            if self.is_checkpoint(candidate):
                out += self.required_predecessors(candidate, seen + (leaf,))
            else:
                out.append(candidate)
        return out

    def optional_leaves_checked_by(self, checkpoint):
        out = []
        for dep in self.depends_on.get(checkpoint.split(".")[0], []):
            out += [l for l in self.leaves_of(dep) if l in self.optional]
        return out

    def expected_waves(self):
        """wave(t) = 1 + max(wave(p)) over t's required predecessors, 0 with none."""
        wave = {}
        for _ in range(len(self.leaves) + 2):
            for leaf in self.leaves:
                predecessors = self.required_predecessors(leaf)
                if any(p not in wave for p in predecessors):
                    continue
                at = 1 + max((wave[p] for p in predecessors), default=-1) if predecessors else 0
                if self.is_checkpoint(leaf):
                    checked = [wave[o] for o in self.optional_leaves_checked_by(leaf) if o in wave]
                    if checked:
                        at = max(at, max(checked) + 1)
                wave[leaf] = at
        return wave


def _check_waves(text, label):
    plan = Plan(text)
    assert "## Task Dependency Graph" in text, label
    assert "```mermaid\nflowchart TD" in text, label

    listed = sorted(t for w in plan.waves for t in w["tasks"])
    assert listed == sorted(plan.leaves), f"{label}: waves do not cover every leaf once"
    assert [w["id"] for w in plan.waves] == list(range(len(plan.waves))), label

    expected = plan.expected_waves()
    early = {l: (expected.get(l), plan.placed.get(l)) for l in plan.leaves
             if expected.get(l) is None or plan.placed[l] < expected[l]}
    assert not early, f"{label}: leaf -> (earliest wave the rule gives, wave listed): {early}"

    behind = {l: [p for p in plan.required_predecessors(l) if plan.placed[p] >= plan.placed[l]]
              for l in plan.leaves}
    behind = {l: ps for l, ps in behind.items() if ps}
    assert not behind, f"{label}: leaf -> required predecessors not in an earlier wave: {behind}"

    for wave in plan.waves:
        checkpoints = [t for t in wave["tasks"] if plan.is_checkpoint(t)]
        assert not checkpoints or len(wave["tasks"]) == 1, (
            f"{label}: checkpoint {checkpoints} shares wave {wave['id']}: {wave['tasks']}"
        )

    for leaf in plan.leaves:
        if not plan.is_checkpoint(leaf):
            continue
        for optional in plan.optional_leaves_checked_by(leaf):
            assert plan.placed[optional] < plan.placed[leaf], (
                f"{label}: optional {optional} is not before checkpoint {leaf}"
            )
    return plan


def _requirement_criteria(text):
    """Requirement number -> how many acceptance criteria it lists."""
    counts = {}
    for block in re.split(r"^### Requirement ", text, flags=re.M)[1:]:
        number = re.match(r"(\d+)", block)
        if not number:
            continue
        criteria = re.findall(r"^(\d+)\. ", block, re.M)
        counts[number.group(1)] = max((int(c) for c in criteria), default=0)
    return counts


def test_task_skill_example_places_every_leaf_no_earlier_than_the_rule_and_checkpoints_alone():
    _check_waves(_task_skill_example(), "task skill example")


def test_wave_check_fails_a_test_task_listed_before_the_code_it_tests_moved_later():
    example = _task_skill_example()
    graph = example.split("```json\n", 1)[1].split("```", 1)[0]
    moved = json.dumps({"waves": [
        {"id": 0, "tasks": ["1"]},
        {"id": 1, "tasks": ["2.1"]},
        {"id": 2, "tasks": ["2.2"]},
        {"id": 3, "tasks": ["3"]},
        {"id": 4, "tasks": ["4.2"]},
        {"id": 5, "tasks": ["4.1"]},
        {"id": 6, "tasks": ["5"]},
    ]})
    with pytest.raises(AssertionError, match=r"not in an earlier wave: \{'4\.2': \['4\.1'\]\}"):
        _check_waves(example.replace(graph, moved + "\n"), "4.1 moved to wave 5")


def test_task_skill_example_references_a_requirement_on_every_task_but_the_checkpoints():
    example = _task_skill_example()
    plan = Plan(example)
    blocks = re.split(r"^ *- \[ \]\*? \d+(?:\.\d+)?\.? ", example, flags=re.M)[1:]
    for leaf, block in zip(plan.ids, blocks):
        if leaf not in plan.leaves or plan.is_checkpoint(leaf):
            continue
        assert "_Requirements:" in block or "**Validates: Requirements" in block, leaf


def test_task_skill_gate_names_both_reference_lines_the_format_rules_use():
    gate = _read("skills/kiro-task-generation/SKILL.md").split("## Quality Gate", 1)[1]
    assert "**Validates: Requirements" in gate
    assert "_Requirements: X.Y_" in gate


def test_task_skill_marks_optional_tasks_and_checkpoints():
    text = _read("skills/kiro-task-generation/SKILL.md")
    assert "- [ ]*" in text
    assert "Checkpoint - " in text
    assert "**Validates: Requirements" in text


@pytest.mark.parametrize("name", GENERATED_EXAMPLES)
def test_generated_example_places_every_leaf_no_earlier_than_the_rule_and_checkpoints_alone(name):
    spec = _generated_spec(name)
    if spec is None:
        pytest.skip(f"no generated {name} spec: set KIRO_EXAMPLE_SPECS to a directory holding one")
    text = (spec / "tasks.md").read_text(encoding="utf-8")
    if "```json" not in text:
        pytest.skip(f"{name} tasks.md has no dependency graph, as a bugfix spec does not")
    _check_waves(text, f"generated {name}")


@pytest.mark.parametrize("name", GENERATED_EXAMPLES)
def test_generated_example_validates_lines_cite_requirements_that_exist(name):
    spec = _generated_spec(name)
    if spec is None:
        pytest.skip(f"no generated {name} spec: set KIRO_EXAMPLE_SPECS to a directory holding one")
    requirements = spec / "requirements.md"
    if not requirements.is_file():
        pytest.skip(f"{name} spec has no requirements.md, as a bugfix spec does not")
    counts = _requirement_criteria(requirements.read_text(encoding="utf-8"))
    cited = re.findall(
        r"\*\*Validates: Requirements ([\d., ]+)\*\*",
        (spec / "tasks.md").read_text(encoding="utf-8"),
    )
    assert cited, f"generated {name}: no Validates lines to check"
    for group in cited:
        for reference in re.findall(r"\d+\.\d+", group):
            number, criterion = reference.split(".")
            assert number in counts, f"generated {name}: requirement {number} does not exist"
            assert int(criterion) <= counts[number], (
                f"generated {name}: requirement {number} has no criterion {criterion}"
            )


def test_design_skill_lists_kiros_seven_sections_in_order():
    text = _read("skills/kiro-design-generation/SKILL.md")
    assert ": " + ", ".join(DESIGN_SECTIONS) + "." in " ".join(text.split())
    numbered = re.findall(r"^### (\d+)\. (.+)$", text, re.M)
    assert numbered == [(str(i + 1), s) for i, s in enumerate(DESIGN_SECTIONS)]
    assert "*For any*" in text


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


def test_requirements_skill_has_a_bugfix_checklist():
    text = _read("skills/kiro-requirements-generation/SKILL.md")
    assert "Before presenting a bugfix spec's bugfix.md, verify:" in text


def test_sop_takes_spec_type_and_workflow_and_writes_the_spec_config():
    text = _read("agent-sops/kiro-spec-workflow.sop.md")
    assert "- **spec_type** (optional, default `feature`)" in text
    assert "- **workflow** (optional, default `requirements-first`)" in text
    assert "`.config.kiro`" in text
    assert "/spec new {feature_name}" in text


def _step(text, number):
    return text.split(f"### {number}. ", 1)[1].split("\n### ", 1)[0]


def test_sop_leaves_the_spec_config_to_the_first_generation_delegate():
    text = _read("agent-sops/kiro-spec-workflow.sop.md")
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


def test_sop_waits_for_the_native_flow_and_checks_its_files_before_step_4():
    step = _step(_read("agent-sops/kiro-spec-workflow.sop.md"), 0)
    assert "resume at Step 4" in step
    for name in ("requirements.md", "bugfix.md", "design.md", "tasks.md", "`.config.kiro`"):
        assert name in step


def test_orchestrator_tables_count_the_sops_five_steps():
    steps = re.findall(r"^### (\d+)\. ", _read("agent-sops/kiro-spec-workflow.sop.md"), re.M)
    assert len(steps) == 5
    direct = _read("context/k-direct-work.md")
    assert re.search(r"^\| `kiro-spec-workflow` +\| 5 +\|", direct, re.M)
    routing = _read("context/k-orchestrator-routing-rules.md")
    assert re.search(r"\| `kiro-spec-workflow` +\| 5 +\|", routing)
