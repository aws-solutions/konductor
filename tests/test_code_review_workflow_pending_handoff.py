# SPDX-License-Identifier: Apache-2.0
"""k-code-review-workflow step 6 names a provisional verdict and a per-run handoff path."""
from pathlib import Path

SOP = (
    Path(__file__).resolve().parent.parent / "agent-sops" / "k-code-review-workflow.sop.md"
).read_text()


def section(start, end):
    return SOP.split(start, 1)[1].split(end, 1)[0]


def test_step_6_requires_a_pending_verdict():
    assert "`Verdict: PENDING ADVERSARIAL PASS`" in section("### 6.", "### 7.")


def test_step_7_names_the_pending_state_as_provisional():
    assert "`PENDING ADVERSARIAL PASS` only while the pending section exists" in section("### 7.", "\n**Expected Output:** Report file")


def test_handoff_path_is_unique_per_run():
    assert ".konductor/handoff/k-developer-code-review-<output_file stem>.md" in SOP
    assert "k-developer-code-review.md" not in SOP


def test_resume_stops_on_parameter_mismatch():
    assert "stop and report the mismatch instead of merging" in section("### 6.", "### 7.")
