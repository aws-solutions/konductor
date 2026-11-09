# SPDX-License-Identifier: Apache-2.0
"""k-code-review-workflow step 6 hands the adversarial review to the orchestrator; the verdict
comes from the findings, with the adversarial pass state on its own line."""
from pathlib import Path

SOP = (
    Path(__file__).resolve().parent.parent / "agent-sops" / "k-code-review-workflow.sop.md"
).read_text()

NOT_RUN = "Adversarial pass: not run (the orchestrator runs k-adversarial-pull-request-review on this diff)"


def section(start, end):
    return SOP.split(start, 1)[1].split(end, 1)[0]


def step_6():
    return section("### 6.", "### 7.")


def step_7():
    return section("### 7.", "\n**Expected Output:** Report file")


def test_step_6_ends_with_the_adversarial_note():
    assert "Run `k-adversarial-pull-request-review` on the Step 1 diff" in step_6()
    assert "resumed at step 6" not in SOP
    assert "hand off again" not in SOP
    assert "step to resume at" not in SOP
    assert ".konductor/handoff/" not in SOP


def test_note_names_the_adversarial_report_concretely():
    """A formula such as `<output_file stem>-adversarial.md` has two readings (file-system
    stem, word stem); a bench run picked the wrong one. The note states the rule and the
    concrete default so no reader has to derive the name."""
    note = step_6()
    assert "`code-review-report-adversarial.md`" in note
    assert "with `-adversarial` added before its extension" in note
    assert "stem" not in note
    mirror = Path(__file__).resolve().parent.parent / "docs/user-guide/sop-workflows/code-review.md"
    assert "code-review-report-adversarial.md" in mirror.read_text()


def test_step_6_never_runs_the_adversarial_review_itself():
    assert "You MUST NOT spawn `k-architect` or run the adversarial SOP yourself" in step_6()


def test_step_6_verdict_comes_from_the_findings():
    assert "verdict from the Step 5 list" in step_6()
    assert f"`{NOT_RUN}`" in step_6()
    assert "`Verdict: PENDING ADVERSARIAL PASS`" not in step_6()
    assert "`NEEDS FIXES` if any CRITICAL or IMPORTANT finding is open" in step_7()


def test_step_7_template_carries_both_lines():
    assert "Verdict: [NEEDS FIXES | READY FOR CR | PENDING ADVERSARIAL PASS]" in step_7()
    assert NOT_RUN in step_7()
    assert "complete (<path>)" in step_7()
    assert "skipped (frontend only)" in step_7()


def test_step_7_never_says_ready_while_not_run():
    assert "`READY FOR CR` when the adversarial pass is complete or skipped" in step_7()
    assert "`PENDING ADVERSARIAL PASS` while it has not run" in step_7()
    assert "`READY FOR CR` never appears while the pass has not run" in step_7()


def test_note_routes_the_write_back_by_the_direct_work_rules():
    """A read-only orchestrator cannot take an 'if you may write files' branch; the note
    names the writer it routes to instead, so the report is updated at every head."""
    note = step_6()
    assert "if you may write files" not in note
    assert (
        "update this report's two lines yourself or through the report's owner (`k-developer`), "
        "as your direct-work rules allow" in note
    )


def test_note_sets_the_verdict_once_the_pass_is_complete():
    note = step_6()
    assert "when the adversarial report's `Passes run:` line names no `MISSING` pass, replace this report's `Adversarial pass:` line" in note
    assert "when this report's `Verdict:` line reads `PENDING ADVERSARIAL PASS`, set it by the Step 7 rule" in note
    assert "`NEEDS FIXES` if the adversarial report lists any CRITICAL or IMPORTANT finding, otherwise `READY FOR CR`" in note
    assert "is open, in this report or in a completed adversarial report" in step_7()


def test_missing_pass_never_reads_ready_for_cr():
    """An all-MISSING adversarial report has zero findings; without this guard the note
    wrote READY FOR CR and k-full-sdlc step 8 recorded the feature APPROVED."""
    incomplete = "`Adversarial pass: incomplete (<path>; <passes> MISSING)`"
    note = step_6()
    assert f"when it names a `MISSING` pass, write {incomplete} and leave the verdict as it stands" in note
    assert "(`NEEDS FIXES` stays, `PENDING ADVERSARIAL PASS` stays)" in note
    assert "incomplete (<path>; <passes> MISSING)" in step_7()
    assert "`PENDING ADVERSARIAL PASS` while it has not run or is incomplete" in step_7()
    assert "`READY FOR CR` never appears while the pass has not run or a pass is MISSING" in step_7()
    sdlc = (Path(__file__).resolve().parent.parent / "agent-sops" / "k-full-sdlc.sop.md").read_text()
    assert "an `Adversarial pass: incomplete` line keeps it PENDING" in sdlc


def test_frontend_only_skips_with_its_own_state():
    assert "`Adversarial pass: skipped (frontend only)` and no note" in step_6()


def test_note_maps_cr_url_to_pr_url():
    assert "`pr_url` set to the `cr_url` value" in step_6()
    assert "as `diff_input`" in step_6()
