# SPDX-License-Identifier: Apache-2.0
"""The adversarial SOP's in-session carve-out is stated consistently in Steps 2, 3 and the Quality Gate."""
from pathlib import Path

SOP = (
    Path(__file__).resolve().parent.parent
    / "agent-sops"
    / "k-adversarial-pull-request-review.sop.md"
).read_text()


def test_step_2_ban_has_user_requested_exception():
    assert "Unless the user explicitly asks for an in-session run, you MUST NOT run a generator pass yourself." in SOP
    assert "- You MUST NOT run a generator pass yourself." not in SOP


def test_step_3_allows_in_session_reuse_pass_in_that_mode():
    assert "except in the user-requested in-session mode of Step 2" in SOP


def test_quality_gate_records_independence_waiver_in_header():
    assert "Checker independence: not held (in-session run requested by user)" in SOP
