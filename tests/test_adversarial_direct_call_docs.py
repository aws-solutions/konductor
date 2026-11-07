# SPDX-License-Identifier: Apache-2.0
"""The code-review guide documents the orchestrated adversarial flow and no manual resume steps."""
import re
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs" / "user-guide"
GUIDE_PATH = DOCS / "sop-workflows" / "code-review.md"
GUIDE = " ".join(GUIDE_PATH.read_text(encoding="utf-8").split())
ADVERSARIAL = GUIDE[GUIDE.index("## `k-adversarial-pull-request-review`") :]
USE_CASE = " ".join((DOCS / "use-cases" / "review-code-and-tests.md").read_text(encoding="utf-8").split())


def test_the_orchestrators_own_the_sop_and_konductor_is_the_prompt_target():
    assert "**Only the three orchestrators declare this SOP**" in ADVERSARIAL
    assert "kiro-cli chat --agent konductor" in ADVERSARIAL
    assert "Run the k-adversarial-pull-request-review SOP on the diff for my current branch." in ADVERSARIAL
    assert "they tell you to run it through `konductor`" in ADVERSARIAL


def test_the_guide_says_what_each_spawn_receives():
    assert "What each spawn receives" in ADVERSARIAL
    assert "Step 0 context summary" in ADVERSARIAL
    assert "`<pass> MISSING (<reason>)`" in ADVERSARIAL


def test_the_guide_bounds_the_coordinator_reads():
    assert "gathers context itself within its read budget" in ADVERSARIAL
    assert "one read-only `k-developer` spawn writes the context summary" in ADVERSARIAL
    assert "k-researcher" not in ADVERSARIAL
    assert "Five spawns (six when a context spawn is needed), one report." in ADVERSARIAL
    assert "matches a row in their SOP trigger table" in ADVERSARIAL


def test_the_use_case_page_does_not_hand_count_the_declared_sops():
    assert "ten SOPs" not in USE_CASE
    assert "Routing through `konductor` does not fix it" not in USE_CASE
    assert "**Through `konductor`, step 6 runs.**" in USE_CASE


def test_no_manual_resume_steps_remain():
    assert "### Running it from k-architect directly" not in GUIDE
    assert "session 5" not in GUIDE
    assert "Paste" not in ADVERSARIAL
    assert not re.search(r"\bresumes? at Step\b", GUIDE, re.IGNORECASE)
    assert "in-session" not in GUIDE


def test_the_roster_row_names_the_orchestrators_and_the_checker():
    assert "| `agent-sops/k-adversarial-pull-request-review.sop.md` | the orchestrators (`k-architect` is the checker) |" in GUIDE
