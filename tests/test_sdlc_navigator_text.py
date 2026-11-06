# SPDX-License-Identifier: Apache-2.0
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent / "skills" / "sdlc-navigator" / "SKILL.md"


def test_agent_table_lists_the_orchestrator():
    rows = [l for l in SKILL.read_text().splitlines() if l.startswith("| `konductor`")]
    assert rows and "Orchestrator" in rows[0] and "Routing" in rows[0]


def test_invocation_lists_claude_code():
    text = SKILL.read_text()
    claude = "- Claude Code: `claude --agent k-architect`"
    assert claude in text
    assert text.index(claude) > text.index("- Kiro IDE: `@k-architect`")
