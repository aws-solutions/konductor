# SPDX-License-Identifier: Apache-2.0
"""Regression guard: `skills/persistent-memory/SKILL.md` in this package
must never name the pre-rename `.asdlc/` root. Every path must use
`.konductor/`.

A single stray directive naming the old root -- missed while every other
reference in the file converged -- is the exact class of bug this pins
against, and it is silent: the skill keeps working for anyone whose state
is already canonical, and misdirects only the reader following that one
line.

The check covers `.asdlc` anywhere in the file, not just the `/memory/`
subdirectory. This package has no legacy handling of any kind -- it has
never shipped, so no consumer can hold pre-rename state -- which means
there is no legitimate reason for the string to appear at all. An earlier
narrower form of this guard was scoped to the `/memory/` suffix to avoid
colliding with existence-only legacy detection elsewhere in the package;
that detection is gone, so the narrow scope would now let a stray
reference through.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILL_MD = REPO_ROOT / "skills" / "persistent-memory" / "SKILL.md"

_LEGACY_ROOT_PATTERN = re.compile(r"\.asdlc")


def test_skill_body_has_no_legacy_root_references():
    """No path in the skill body may name the pre-rename `.asdlc/` root."""
    text = SKILL_MD.read_text()
    hits = _LEGACY_ROOT_PATTERN.findall(text)
    assert not hits, (
        f"found {len(hits)} '.asdlc' reference(s) in {SKILL_MD} -- this "
        f"package has no legacy paths; every path must use '.konductor/'"
    )


def test_skill_body_names_the_canonical_memory_directory():
    """Sanity check that the assertion above isn't vacuous: the file must
    actually reference the canonical `.konductor/memory/` path somewhere."""
    text = SKILL_MD.read_text()
    assert ".konductor/memory/" in text, (
        f"expected {SKILL_MD} to reference the canonical '.konductor/memory/' "
        "path at least once"
    )
