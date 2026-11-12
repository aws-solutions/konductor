# SPDX-License-Identifier: Apache-2.0
"""Pins the delegation brief scope: MUST DO carries what the user asked plus the
constraints the specialist cannot infer, not an exhaustive requirements list.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROTOCOL = ROOT / "skills" / "delegation-protocol" / "SKILL.md"
DELEGATE_SOP = ROOT / "agent-sops" / "k-delegate.sop.md"
GUIDE_PAGES = (
    ROOT / "docs" / "user-guide" / "concepts.md",
    ROOT / "docs" / "user-guide" / "sop-workflows" / "planning-and-analysis.md",
)

TEMPLATE_LINE = (
    "- <What the user asked for, plus constraints the agent cannot infer from its skills, "
    "the code or CONTEXT>"
)
STEP_4_SENTENCE = (
    "List what the user asked for, plus the constraints the subagent cannot infer from its "
    "skills, the codebase or the CONTEXT you pass."
)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_protocol_and_sop_drop_the_exhaustive_wording():
    for path in (PROTOCOL, DELEGATE_SOP):
        text = read(path)
        assert "Exhaustive requirements" not in text, path
        assert "NOTHING implicit" not in text, path


def test_guide_pages_drop_nothing_implicit():
    for path in GUIDE_PAGES:
        assert "nothing implicit" not in read(path).lower(), path


def test_protocol_template_carries_the_user_asks_line():
    assert TEMPLATE_LINE in read(PROTOCOL)


def test_delegate_step_4_carries_the_new_sentence():
    assert STEP_4_SENTENCE in read(DELEGATE_SOP)
