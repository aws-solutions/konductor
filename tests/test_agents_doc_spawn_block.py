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


def test_specialist_row_qualifies_kiro_v2_until_the_strip():
    row = next(line for line in AGENTS_MD.splitlines() if line.startswith("| every `k-*` specialist |"))
    assert row == (
        "| every `k-*` specialist | **nothing** in Kiro CLI v3 "
        "(v2: nothing once #149 lands, see the bullet above) | **nothing** |"
    )


def test_kiro_v2_bullet_says_the_empty_target_list_is_not_a_block():
    """A kiro-cli 2.36.0 v2 probe showed an empty `availableAgents` list allows every agent,
    so v2 is covered only once #149 drops `subagent` from the specialists' tool list."""
    v2 = bullet("- Kiro CLI v2", "\nThe block covers")
    assert "target list every specialist carries does not stop a spawn" in v2
    assert "v2 specialists lose the `subagent`\n  tool when #149 lands, and #124 merges together with #149." in v2
    assert "no agent to spawn" not in AGENTS_MD
    assert "not covered" not in AGENTS_MD
    assert "relies on the prompt rule" not in AGENTS_MD
