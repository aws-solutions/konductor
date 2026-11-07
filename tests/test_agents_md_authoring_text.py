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


def test_template_loads_memory_through_the_checked_read():
    """A glob or an `@import` reads memory through a symlink and skips the
    persistent-memory skill's `--check-path` gate."""
    assert "--check-path" in TEXT
    assert "memory/*.md" not in TEXT
    assert "@.konductor/memory" not in TEXT


def test_template_tells_skill_less_agents_to_skip_memory():
    """Agents that load a generated AGENTS.md without the persistent-memory
    skill or a shell need an explicit fail-closed path, not a method they
    cannot run."""
    template = TEXT.split("## Context Loading (MUST follow at session start)")[1].split("```")[0]
    assert "If that skill or a shell is not available to you, skip memory and say so." in template, template
