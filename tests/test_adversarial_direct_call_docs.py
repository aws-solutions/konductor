# SPDX-License-Identifier: Apache-2.0
"""The code-review guide documents the direct k-architect path and the generator carve-out."""
from pathlib import Path

GUIDE = " ".join(
    (
        Path(__file__).resolve().parent.parent
        / "docs"
        / "user-guide"
        / "sop-workflows"
        / "code-review.md"
    )
    .read_text()
    .split()
)


def test_direct_call_subsection_names_both_resume_steps():
    assert "### Running it from k-architect directly" in GUIDE
    assert "Resume `k-adversarial-pull-request-review` at Step 3" in GUIDE
    assert "at Step 4" in GUIDE


def test_generator_carve_out_matches_the_sop():
    assert "only when the user asks for an in-session run" in GUIDE
    assert "never runs a generator pass" not in GUIDE
