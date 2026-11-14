# SPDX-License-Identifier: Apache-2.0
"""Every skill's 'Use ...' sentence must fit the Kiro skill index cut (160 chars)."""

import re
from pathlib import Path

import pytest
import yaml

TRIGGER_MAX_CHARS = 160
ROOT = Path(__file__).resolve().parent.parent
SKILLS = sorted(p.parent.name for p in (ROOT / "skills").glob("*/SKILL.md"))


def split_sentences(text):
    sentences, start = [], 0
    for i, c in enumerate(text):
        if c not in ".!?" or i + 2 >= len(text):
            continue
        nxt = text[i + 2]
        if text[i + 1] == " " and (nxt.isupper() or nxt in "\"'`"):
            sentences.append(text[start : i + 1])
            start = i + 2
    if start < len(text):
        sentences.append(text[start:])
    return sentences


def use_sentence(skill):
    raw = (ROOT / "skills" / skill / "SKILL.md").read_text(encoding="utf-8")
    description = yaml.safe_load(raw.split("---")[1])["description"]
    description = description.replace("\u2014", " - ").replace("\u2013", "-")
    collapsed = re.sub(r"\s+", " ", description).strip()
    use = [s for s in split_sentences(collapsed) if s.startswith(("Use ", "MUST USE"))]
    assert use, f"{skill}: no 'Use ...' sentence"
    return use[0]


def test_every_skill_is_checked():
    assert len(SKILLS) > 50


@pytest.mark.parametrize("skill", SKILLS)
def test_use_sentence_fits_the_index(skill):
    use = use_sentence(skill)
    assert len(use) <= TRIGGER_MAX_CHARS, f"{skill}: {len(use)} chars: {use}"


def test_kiro_design_generation_trigger_names_the_system_design_input():
    assert "system design" in use_sentence("kiro-design-generation")


def test_code_review_trigger_names_the_pr_lifecycle():
    use = use_sentence("code-review")
    assert "PR" in use
    assert "creat" in use or "submit" in use


def test_workspace_skills_trigger_names_the_unexpected_outcome_case():
    assert "unexpected outcome" in use_sentence("workspace-skills")


def test_pre_planning_analysis_trigger_leads_with_the_vague_request_case():
    raw = (ROOT / "skills" / "pre-planning-analysis" / "SKILL.md").read_text(encoding="utf-8")
    description = yaml.safe_load(raw.split("---")[1])["description"]
    assert description.startswith("Use when a request is vague")
