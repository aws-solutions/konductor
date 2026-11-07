# SPDX-License-Identifier: Apache-2.0
"""The agents guide's spawn block keeps each runtime's facts in its own bullet."""
from pathlib import Path

AGENTS_MD = (
    Path(__file__).resolve().parent.parent / "docs" / "user-guide" / "agents.md"
).read_text()


def bullet(start, end):
    return AGENTS_MD.split(start, 1)[1].split(end, 1)[0]


def test_kiro_cli_bullet_carries_the_re_probe_step():
    kiro = bullet("- Kiro CLI:", "- Claude Code:")
    assert "kiro-cli 2.35.0" in kiro
    assert "run `/tools`" in kiro


def test_claude_code_bullet_is_claude_only():
    claude = bullet("- Claude Code:", "- Kiro CLI v2")
    assert "run `/tools`" not in claude
    assert "kiro-cli" not in claude
