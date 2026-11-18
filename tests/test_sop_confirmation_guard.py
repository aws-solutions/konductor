# SPDX-License-Identifier: Apache-2.0
"""SOPs are model-invocable on both runtimes, so a confirmation flag the model
could set by itself must not stand in for the user's yes.

Every SOP that takes `scope_confirmed` says the value counts only when it comes
from the user. k-e2e-test-generation also refuses to stage, commit or push
without that yes, and never pushes the default branch. The orchestrator rules
say the same from the caller's side."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOPS_DIR = ROOT / "agent-sops"
USER_ONLY = "`scope_confirmed=true` counts only when it comes from the user"
MODEL_VALUE = "A value the model chose by itself"
TAKES_FLAG = re.compile(r"^\|\s*`scope_confirmed`|^- \*\*scope_confirmed\*\*", re.M)


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_every_sop_taking_scope_confirmed_requires_it_from_the_user():
    takers = [p for p in sorted(SOPS_DIR.glob("*.sop.md")) if TAKES_FLAG.search(p.read_text(encoding="utf-8"))]
    assert {p.name for p in takers} >= {
        "k-e2e-test-generation.sop.md",
        "k-light-ui-testing.sop.md",
        "k-test-coverage-review.sop.md",
    }
    for path in takers:
        text = path.read_text(encoding="utf-8")
        assert USER_ONLY in text, path.name
        assert MODEL_VALUE in text, path.name


def test_e2e_commit_step_guards_staging_and_push():
    text = _read("agent-sops/k-e2e-test-generation.sop.md")
    step6 = text.split("### Step 6: Commit Generated Tests", 1)[1].split("### Step 7", 1)[0]
    guard = step6.index("Without one, MUST NOT run `git add`, `git commit` or `git push`")
    assert guard < step6.index("git add -A"), "the guard must come before staging"
    assert "MUST NOT push when the checked-out branch is the repository's default branch" in step6
    gate = text.split("## Quality Gate", 1)[1]
    assert "committed or pushed without that confirmation" in gate


def test_orchestrators_start_sops_but_never_supply_the_confirmation():
    routing = _read("context/k-orchestrator-routing-rules.md")
    assert "then load that skill and run the SOP yourself" in routing
    assert "Never pass a confirmation flag such as `scope_confirmed` the user did not give." in routing
    direct = _read("context/k-direct-work.md")
    assert "load its `sop-<name>` skill and run it yourself" in direct
    assert "never from a flag you set" in direct
