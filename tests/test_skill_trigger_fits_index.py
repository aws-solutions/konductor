# SPDX-License-Identifier: Apache-2.0
"""Each listed skill's 'Use ...' sentence must fit the Kiro skill index cut (160 chars)."""

import re
from pathlib import Path

import pytest
import yaml

SKILLS = [
    "persistent-memory",
    "delegation-protocol",
    "app-discovery",
    "claude-teams-behavior",
    "pre-planning-analysis",
]
TRIGGER_MAX_CHARS = 160
ROOT = Path(__file__).resolve().parent.parent


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


@pytest.mark.parametrize("skill", SKILLS)
def test_use_sentence_fits_the_index(skill):
    raw = (ROOT / "skills" / skill / "SKILL.md").read_text(encoding="utf-8")
    description = yaml.safe_load(raw.split("---")[1])["description"]
    description = description.replace("\u2014", " - ").replace("\u2013", "-")
    collapsed = re.sub(r"\s+", " ", description).strip()
    use = [s for s in split_sentences(collapsed) if s.startswith(("Use ", "MUST USE"))]
    assert use, f"{skill}: no 'Use ...' sentence"
    assert len(use[0]) + 1 < TRIGGER_MAX_CHARS


def test_pre_planning_analysis_trigger_leads_with_the_vague_request_case():
    raw = (ROOT / "skills" / "pre-planning-analysis" / "SKILL.md").read_text(encoding="utf-8")
    description = yaml.safe_load(raw.split("---")[1])["description"]
    assert description.startswith("Use when a request is vague")
