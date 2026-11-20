# SPDX-License-Identifier: Apache-2.0
"""A model can start a SOP (Kiro CLI loads its `sop-<name>` skill copy), so a
confirmation flag the model could set by itself must not stand in for the
user's yes.

Every SOP that takes `scope_confirmed` says the value counts only when it comes
from the user. k-e2e-test-generation is also told not to stage, commit or push
without that yes, or to push the default branch. The orchestrator rules
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
    # symbolic-ref prints "origin/main"; strip the remote so it matches the branch name.
    assert "symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'" in step6
    gate = text.split("## Quality Gate", 1)[1]
    assert "committed or pushed without that confirmation" in gate


def test_orchestrators_never_supply_the_confirmation():
    routing = _read("context/k-orchestrator-routing-rules.md")
    assert "Never put a confirmation flag such as `scope_confirmed` on the command unless the user gave it." in routing
    direct = _read("context/k-direct-work.md")
    assert "never add a confirmation flag such as `scope_confirmed` the user did not give" in direct


def _step9_bullets():
    text = _read("agent-sops/k-full-sdlc.sop.md")
    step9 = text.split("### 9. Testing", 1)[1].split("### 10.", 1)[0]
    return step9


def test_step_9_starts_a_user_only_ui_pass_only_on_the_engineers_yes():
    step9 = _step9_bullets()
    # The question tells the engineer what the pass does, so the yes is informed.
    assert "stages, commits and pushes the generated tests to the feature's branch" in step9
    assert "`k-light-ui-testing` only runs prompts against the live app and commits nothing" in step9
    # No yes, no start; an unattended run has no yes.
    assert "Without that yes, or when the file cannot be read, You MUST NOT start either SOP" in step9
    assert "MUST NOT run its steps from memory" in step9
    assert "Pass `scope_confirmed=true` only for a yes the engineer gave in this run." in step9
    # The pass runs only after the yes, and the unattended default is gone.
    assert "Only after the engineer's yes above: if the feature has a web UI" in step9
    assert "the engineer's yes above cannot exist, so neither pass runs" in step9
    assert "default to `k-e2e-test-generation`" not in step9
    # Where the installed SOP is, per harness.
    assert "`sop-<name>/SKILL.md` in the skills directory that holds this SOP's own `sop-k-full-sdlc/SKILL.md`" in step9
    assert "directly under your home directory, your working directory or the project root" in step9
    assert "${CLAUDE_SKILL_DIR}" not in step9, "an undocumented variable must not carry the path"


def test_e2e_step_3_prompt_says_the_pass_commits_and_pushes():
    text = _read("agent-sops/k-e2e-test-generation.sop.md")
    step3 = text.split("### Step 3", 1)[1].split("### Step 4", 1)[0]
    assert "The tests will be committed and pushed to the current branch." in step3


def test_no_ui_sop_tells_an_unattended_caller_to_set_the_flag():
    for rel in ("agent-sops/k-e2e-test-generation.sop.md", "agent-sops/k-light-ui-testing.sop.md"):
        text = _read(rel)
        assert "unattended caller MUST set" not in text, rel
        assert "an unattended caller has no yes, so it MUST NOT start this SOP" in text, rel
