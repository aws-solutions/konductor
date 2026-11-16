# SPDX-License-Identifier: Apache-2.0
"""The constraints IMPORTANT tier header stays short and is followed by its bullets; the
review-ceilings summary sits under its own `### Review findings` heading."""

from pathlib import Path

TEXT = (Path(__file__).resolve().parent.parent / "skills/constraints/SKILL.md").read_text()
HEADER = "**IMPORTANT (fix before proceeding):**"
REVIEW_FINDINGS_HEADING = "### Review findings"
PINNED = [
    "carried over or new",
    "pre-existing",
    "code the task did not add or change",
    "in the task's own output",
    "still open",
    "Review ceilings, Verification Protocol item 6",
]


def test_important_header_is_short():
    lines = TEXT.splitlines()
    assert HEADER in lines
    assert all(len(l) <= 60 for l in lines if l.startswith("**IMPORTANT ("))


def test_important_header_is_followed_by_its_bullets():
    after = TEXT.split(HEADER + "\n", 1)[1].lstrip("\n")
    assert after.startswith("- "), after[:80]
    tier = after.split("\n\n", 1)[0]
    assert "review finding" not in tier.lower()


def test_ceilings_paragraph_sits_under_review_findings():
    assert TEXT.count(REVIEW_FINDINGS_HEADING) == 1
    assert TEXT.index("**SUGGESTION:**") < TEXT.index(REVIEW_FINDINGS_HEADING)
    after = TEXT.split(REVIEW_FINDINGS_HEADING + "\n", 1)[1].lstrip("\n")
    paragraph = after.split("\n\n", 1)[0]
    assert paragraph.startswith("A CRITICAL or IMPORTANT review finding gets one fix")
    for clause in PINNED:
        assert clause in paragraph, clause
