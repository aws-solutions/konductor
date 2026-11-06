# SPDX-License-Identifier: Apache-2.0
"""The adversarial pass skills are coordinator-only and use public terms."""
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
PASSES = ["integrity", "schema", "security"]


def read(name):
    return (ROOT / "skills" / f"adversarial-code-review-pass-{name}" / "SKILL.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("name", PASSES)
def test_passes_are_coordinator_only(name):
    text = read(name)
    description = yaml.safe_load(text.split("---")[1])["description"]
    assert "May also be run directly" not in text
    assert "user-requested in-session mode" in text
    assert "Use only when a split from the adversarial-code-review coordinator names it" in description


@pytest.mark.parametrize("name", PASSES)
def test_checker_handoff_uses_public_terms(name):
    text = read(name)
    assert "reaches the CR" not in text
    assert "posted to the PR" in text
    assert not re.search(r"\bCR\b", text)
    assert "CrCheckout" not in text
