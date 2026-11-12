# SPDX-License-Identifier: Apache-2.0
"""Pins the scope rule in design-evaluation's Quality Gate: on a single design
document for a small project, the three operations and cost items drop from
IMPORTANT to SUGGESTION, so a short design doc does not fail review on them.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "design-evaluation" / "SKILL.md"

SCOPE_CLAUSE = "report a missing item from this list as a SUGGESTION instead"
IMPORTANT_ITEMS = (
    "- Observability strategy (metrics, logs, traces) not defined",
    "- No runbook or operational playbook referenced",
    "- Cost estimates not validated against architecture",
)


def quality_gate() -> str:
    text = SKILL.read_text(encoding="utf-8")
    start = text.index("## Quality Gate")
    return text[start:]


def test_scope_clause_sits_between_important_and_suggestion():
    gate = quality_gate()
    clause = gate.index(SCOPE_CLAUSE)
    assert gate.index("**IMPORTANT") < clause < gate.index("**SUGGESTION:**")


def test_important_items_are_still_listed():
    gate = quality_gate()
    important = gate[gate.index("**IMPORTANT") : gate.index(SCOPE_CLAUSE)]
    for item in IMPORTANT_ITEMS:
        assert item in important
