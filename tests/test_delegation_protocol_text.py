# SPDX-License-Identifier: Apache-2.0
"""Pins the delegation-protocol wording that keeps it short and free of internal terms."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "delegation-protocol" / "SKILL.md"


def flat():
    return re.sub(r"\s+", " ", SKILL.read_text(encoding="utf-8"))


def test_format_ownership_example_is_a_konductor_skill():
    assert "cloudscape-mock-ui" not in flat()
    assert "`kiro-task-generation`" in flat()
    assert (ROOT / "skills" / "kiro-task-generation" / "SKILL.md").exists()


def test_concurrency_limit_states_its_reason():
    text = flat()
    assert "at most 4 subagents at once: beyond that you lose track" in text
    assert "More than 4 concurrent subagents" in text


def test_specialist_paragraph_points_without_restating():
    text = flat()
    assert "apply the guards in your orchestrator context" in text
    assert "how to resume a named SOP step" in text
    assert "file lists are a prediction" not in text
    assert "check what each part actually touched" not in text


def test_description_sample_in_concepts_matches_the_skill():
    skill_line = SKILL.read_text(encoding="utf-8").splitlines()[2]
    concepts = (ROOT / "docs" / "user-guide" / "concepts.md").read_text(encoding="utf-8")
    assert skill_line.startswith("description: ")
    assert skill_line in concepts.splitlines()
