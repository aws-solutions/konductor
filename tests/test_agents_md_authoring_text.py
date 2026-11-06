# SPDX-License-Identifier: Apache-2.0
"""Pins the wording of the agents-md-authoring skill."""

import re
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent / "skills" / "agents-md-authoring" / "SKILL.md"
TEXT = " ".join(SKILL.read_text(encoding="utf-8").split())


def test_workspace_skill_glob_matches_skill_files():
    assert "`.kiro/skills/ws-*/SKILL.md`" in TEXT
    assert "skills/**/ws-*.md" not in TEXT


def test_workspace_placeholder_is_the_state_directory():
    assert "workspace state directory (`.konductor`)" in TEXT
    assert "project root (e.g., `.konductor`)" not in TEXT


def test_workflow_bullet_uses_public_terms():
    assert "git and pull request conventions" in TEXT
    assert not re.search(r"\bCR\b", TEXT)
