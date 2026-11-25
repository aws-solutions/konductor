# SPDX-License-Identifier: Apache-2.0
"""k-full-sdlc Step 8 runs the adversarial pass that k-code-review-workflow's Step 6 note asks
for, and never records a PENDING ADVERSARIAL PASS report as APPROVED."""
from pathlib import Path

SOP = (Path(__file__).resolve().parent.parent / "agent-sops" / "k-full-sdlc.sop.md").read_text()


def step_8():
    return SOP.split("### 8. Code Review and Pull Request", 1)[1].split("### 9. Testing", 1)[0]


def test_step_8_runs_the_adversarial_pass_from_the_note():
    text = step_8()
    assert "ends with a note asking you to run `k-adversarial-pull-request-review`" in text
    assert "You MUST run that SOP from the note before writing the feature's `status.md`" in text
    assert "`Verdict:` and `Adversarial pass:` lines set as the note says" in text


def test_step_8_records_a_pending_verdict_as_blocked():
    text = step_8()
    assert "`PENDING ADVERSARIAL PASS` when its `status.md` is written is BLOCKED, not APPROVED" in text
    assert "from the review report or the adversarial report" in text


def test_step_8_maps_open_findings_after_the_fix_cycles_to_blocked():
    text = step_8()
    assert "APPROVED when neither report leaves a CRITICAL or IMPORTANT finding open" in text
    assert "BLOCKED when either does after the fix cycles" in text


def test_step_8_no_longer_claims_a_diff_only_degrade():
    assert "degrades to diff-only" not in SOP
    assert "diff-only degrade" not in SOP
