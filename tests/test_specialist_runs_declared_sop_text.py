# SPDX-License-Identifier: Apache-2.0
"""Pins the receiving end of an SOP handoff: a specialist whose brief names an SOP it declares
reads the SOP's installed file and follows it. Without this, a brief such as "run
k-code-review-workflow" reaches a specialist that has no way to load the SOP (on Claude Code
the sop-* skills are user-invokable only, so the Skill tool refuses them)."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE_RULES = (ROOT / "context" / "k-core-rules.md").read_text(encoding="utf-8")
SENTENCE = (
    "An SOP your brief names that you declare is yours to run: read its installed file "
    "(`sop-<name>/SKILL.md` in your skills directory, `~/.claude/skills/` on Claude Code; "
    "`<name>.sop.md` on Kiro CLI) and follow its steps."
)


def _specialist_handoffs() -> str:
    match = re.search(r"^## Specialist handoffs\n(.*?)(?=^## )", CORE_RULES, re.S | re.M)
    assert match, "context/k-core-rules.md has no Specialist handoffs section"
    return match.group(1)


def test_specialist_runs_an_sop_its_brief_names_from_the_installed_file():
    assert SENTENCE in _specialist_handoffs()


def test_the_sentence_stays_short():
    assert len(SENTENCE.split()) <= 40
