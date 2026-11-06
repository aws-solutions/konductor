# SPDX-License-Identifier: Apache-2.0
"""The constraints IMPORTANT tier header stays short; the ceilings summary sits in a paragraph."""

from pathlib import Path

TEXT = (Path(__file__).resolve().parent.parent / "skills/constraints/SKILL.md").read_text()
HEADER = "**IMPORTANT (fix before proceeding):**"
PINNED = ["carried over or new", "pre-existing", "the first review did not report", "still open"]


def test_important_header_is_short():
    lines = TEXT.splitlines()
    assert HEADER in lines
    assert all(len(l) <= 60 for l in lines if l.startswith("**IMPORTANT ("))


def test_ceilings_paragraph_follows_the_header():
    after = TEXT.split(HEADER + "\n", 1)[1].lstrip("\n")
    paragraph = after.split("\n\n", 1)[0]
    assert paragraph.startswith("A review finding gets one fix")
    for clause in PINNED:
        assert clause in paragraph
