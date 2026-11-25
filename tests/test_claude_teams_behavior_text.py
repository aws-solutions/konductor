# SPDX-License-Identifier: Apache-2.0
"""claude-teams-behavior uses public terms and points at delegation-protocol for the worktree rule."""

import re
from pathlib import Path

TEXT = " ".join((Path(__file__).resolve().parent.parent / "skills" / "claude-teams-behavior" / "SKILL.md").read_text(encoding="utf-8").split())


def test_public_terms_only():
    assert not re.search(r"\bCR\b", TEXT)
    assert "The PR diff at review time" in TEXT


def test_worktree_rule_points_at_delegation_protocol():
    assert "The rule itself lives in `delegation-protocol` (Parallel Execution)" in TEXT
    assert "The rule: every write-agent dispatch prompt must explicitly name" not in TEXT
    assert "## Worktree Scoping" in TEXT
