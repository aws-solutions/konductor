# SPDX-License-Identifier: Apache-2.0
"""k-test-coverage-review recommends k-developer for missing tests; it does not hand off."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _text(relative_path):
    return " ".join((ROOT / relative_path).read_text(encoding="utf-8").split())


SOP = _text("agent-sops/k-test-coverage-review.sop.md")


def test_step_7_is_a_recommendation_for_the_caller():
    assert "recommendation for the caller, not a handoff note" in SOP
    assert "writing tests is outside this SOP's task" in SOP
    assert "return a handoff note naming `k-developer`" not in SOP
    assert "offer to spawn" not in SOP


def test_guide_pages_use_the_recommendation_wording():
    guide = _text("docs/user-guide/sop-workflows/testing-and-specs.md")
    assert "may recommend that k-developer<br/>implement the missing tests" in guide
    assert "note naming k-developer" not in guide
