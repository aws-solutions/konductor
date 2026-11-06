# SPDX-License-Identifier: Apache-2.0
"""The code-review guide documents the orchestrated adversarial flow and no manual resume steps."""
import re
from pathlib import Path

GUIDE_PATH = Path(__file__).resolve().parent.parent / "docs" / "user-guide" / "sop-workflows" / "code-review.md"
GUIDE = " ".join(GUIDE_PATH.read_text(encoding="utf-8").split())
ADVERSARIAL = GUIDE[GUIDE.index("## `k-adversarial-pull-request-review`") :]


def test_the_orchestrators_own_the_sop_and_konductor_is_the_prompt_target():
    assert "**Only the three orchestrators declare this SOP.**" in ADVERSARIAL
    assert "kiro-cli chat --agent konductor" in ADVERSARIAL
    assert "Run the k-adversarial-pull-request-review SOP on the diff for my current branch." in ADVERSARIAL
    assert "they tell you to run it through `konductor`" in ADVERSARIAL


def test_the_guide_says_what_each_spawn_receives():
    assert "What each spawn receives" in ADVERSARIAL
    assert "Step 0 context summary" in ADVERSARIAL
    assert "`<pass> MISSING (<reason>)`" in ADVERSARIAL


def test_no_manual_resume_steps_remain():
    assert "### Running it from k-architect directly" not in GUIDE
    assert "session 5" not in GUIDE
    assert "Paste" not in ADVERSARIAL
    assert not re.search(r"\bresumes? at Step\b", GUIDE, re.IGNORECASE)
    assert "in-session" not in GUIDE


def test_the_roster_row_names_the_orchestrators_and_the_checker():
    assert "| `agent-sops/k-adversarial-pull-request-review.sop.md` | the orchestrators (`k-architect` is the checker) |" in GUIDE
