# SPDX-License-Identifier: Apache-2.0
"""k-verify Step 5 runs no CDK command that executes the app or reads an account until the user
confirms the app is trusted, and the user guide says the same."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOP = (ROOT / "agent-sops" / "k-verify.sop.md").read_text()
GUIDE = (ROOT / "docs" / "user-guide" / "sop-workflows" / "planning-and-analysis.md").read_text()


def step_5():
    return SOP.split("### 5. CDK Verification (if applicable)", 1)[1].split("### 6. Manual Verification", 1)[0]


def k_verify_guide():
    return GUIDE.split("k-verify", 1)[1]


def test_step_5_waits_for_trust_confirmation():
    text = step_5()
    assert "You MUST NOT run `cdk synth`, `cdk ls` or `cdk diff` until the user confirms that the CDK app is trusted to execute in this environment" in text
    assert "A change you wrote yourself in this session counts as trusted; a checkout under review does not." in text


def test_step_5_runs_ls_and_synth_strict_and_diff_only_on_request():
    text = step_5()
    assert "When the user confirms, You MUST run `cdk ls` and `cdk synth --strict` and record each outcome." in text
    assert "You MUST run `cdk diff` only when the user also asks for a check against the deployed stack" in text
    assert "You MUST run `cdk diff` and any context lookup only with the credentials the user names." in text


def test_step_5_reports_unrun_commands_without_confirmation():
    text = step_5()
    assert "Without confirmation, You MUST validate an existing `cdk.out/` template if one is present, or read the stacks and constructs" in text
    assert "list `cdk synth`, `cdk ls` and `cdk diff` as not run, with the reason, in the verification report" in text
    assert "You MUST NOT deploy, bootstrap or create a change set." in text


def test_step_5_no_longer_requires_the_unconditional_command_chain():
    text = step_5()
    assert "You MUST run these commands in order" not in text
    assert "1. `cdk ls`" not in text


def test_evidence_report_has_a_cdk_section_for_unrun_commands():
    report = SOP.split("### 7. Collect Evidence", 1)[1]
    assert "### CDK (if applicable)" in report
    assert "- Not run: [each of `cdk synth`, `cdk ls` and `cdk diff` not run, with the reason]" in report


def test_user_guide_describes_the_trust_gate():
    text = k_verify_guide()
    assert "cdk ls → cdk diff → cdk synth" not in text
    assert "**CDK commands wait for your confirmation.**" in text
    assert "the SOP runs none of them\n  until you confirm the CDK app is trusted" in text
