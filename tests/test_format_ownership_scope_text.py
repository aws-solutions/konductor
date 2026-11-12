# SPDX-License-Identifier: Apache-2.0
"""Pins the format ownership rule to output format only, so a brief's tool and scope
limits override a skill's lookup step.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROTOCOL = ROOT / "skills" / "delegation-protocol" / "SKILL.md"


def format_ownership_line() -> str:
    lines = [
        line
        for line in PROTOCOL.read_text(encoding="utf-8").splitlines()
        if "**Format ownership rule**" in line
    ]
    assert len(lines) == 1, lines
    return lines[0]


def test_rule_covers_output_format_only():
    assert "output format only" in format_ownership_line()


def test_brief_limits_override_skill_steps():
    assert "override any step in the agent's skills" in format_ownership_line()


def test_rule_no_longer_defers_to_skills_wholesale():
    line = format_ownership_line()
    assert "should not contradict the receiving agent's skills or system prompt" not in line
