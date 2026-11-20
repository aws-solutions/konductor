# SPDX-License-Identifier: Apache-2.0
"""k-verify Step 5 runs no CDK command that executes the app or reads an account until the user
confirms the app is trusted, and the user guide says the same."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOP = (ROOT / "agent-sops" / "k-verify.sop.md").read_text()
GUIDE = (ROOT / "docs" / "user-guide" / "sop-workflows" / "planning-and-analysis.md").read_text()

GATED_COMMANDS = ("`cdk synth", "`cdk ls`", "`cdk diff`")
MUST_RUN = re.compile(r"\bMUST (?!NOT\b)(?:\w+ )?run\b")
CONFIRMED_BRANCH = "When the user confirms,"


def section(text, heading):
    """Body of the Markdown section under `heading`, up to the next heading of the same or a higher
    level. Headings inside fenced code blocks (report templates) do not end the section."""
    level = len(heading.split(" ", 1)[0])
    lines = text.splitlines()
    start = lines.index(heading) + 1
    in_fence = False
    for end in range(start, len(lines)):
        line = lines[end]
        if line.startswith("```"):
            in_fence = not in_fence
        elif not in_fence and re.match(rf"#{{1,{level}}} ", line):
            return "\n".join(lines[start:end])
    return "\n".join(lines[start:])


def bullets(text):
    """Top-level list items, with wrapped continuation lines joined into one line."""
    items = []
    for line in text.splitlines():
        if line.startswith("- "):
            items.append(line[2:])
        elif items and line.startswith("  "):
            items[-1] += " " + line.strip()
    return items


def step_5():
    return section(SOP, "### 5. CDK Verification (if applicable)")


def k_verify_guide():
    return section(GUIDE, "## `k-verify`")


def names_gated_command(text):
    return any(command in text for command in GATED_COMMANDS)


def test_not_without_confirmation_rule_names_all_three_commands():
    rules = [b for b in bullets(step_5()) if "MUST NOT run" in b]
    assert len(rules) == 1, rules
    for command in GATED_COMMANDS:
        assert command in rules[0], command
    assert "until the user confirms that the CDK app is trusted" in rules[0]
    assert "`cdk diff` also reads the deployed stack" in rules[0]


def test_no_must_run_line_names_a_cdk_command_outside_the_confirmed_branch():
    offending = [
        b for b in bullets(step_5())
        if MUST_RUN.search(b) and names_gated_command(b) and not b.startswith(CONFIRMED_BRANCH)
    ]
    assert offending == []


def test_confirmed_branch_runs_ls_and_synth_and_limits_diff():
    confirmed = [b for b in bullets(step_5()) if b.startswith(CONFIRMED_BRANCH)]
    assert len(confirmed) == 1, confirmed
    assert "You MUST run `cdk ls` and `cdk synth --strict`" in confirmed[0]
    assert "You MUST run `cdk diff` only when the user also asks" in confirmed[0]
    assert "only with the credentials the user names" in confirmed[0]


def test_confirmed_branch_without_credentials_disables_lookups():
    confirmed = next(b for b in bullets(step_5()) if b.startswith(CONFIRMED_BRANCH))
    without_credentials = next(s for s in confirmed.split(". ") if "has not named credentials" in s)
    assert "`--no-lookups`" in without_credentials
    assert "not run (needs a context lookup)" in without_credentials


def test_cdk_ls_is_not_described_as_an_account_aware_check():
    assert "account-aware" not in step_5()


def test_self_trust_exemption_is_narrow():
    text = step_5()
    assert "A CDK app you created in this session, or one the user says they own, counts as confirmed." in text
    assert "Editing a checkout under review does not make it trusted" in text


def test_step_5_reports_unrun_commands_without_confirmation():
    text = step_5()
    assert "Without confirmation, You MUST validate an existing `cdk.out/` template if one is present" in text
    assert "list `cdk synth`, `cdk ls` and `cdk diff` as not run, with the reason, in the verification report" in text
    assert "You MUST NOT deploy, bootstrap or create a change set." in text


def test_step_5_no_longer_requires_the_unconditional_command_chain():
    text = step_5()
    assert "You MUST run these commands in order" not in text
    assert "1. `cdk ls`" not in text


def test_evidence_report_has_a_cdk_section_for_unrun_commands():
    report = section(SOP, "### 7. Collect Evidence")
    assert "### CDK (if applicable)" in report
    assert "- Not run: [each of `cdk synth`, `cdk ls` and `cdk diff` not run, with the reason]" in report


def test_user_guide_flowchart_gates_the_cdk_step():
    text = k_verify_guide()
    assert "cdk ls → cdk diff → cdk synth" not in text
    assert "once you confirm<br/>the app is trusted" in text


def test_user_guide_gate_sentence_names_all_three_commands():
    gate = [b for b in bullets(k_verify_guide()) if b.startswith("**CDK commands wait for your confirmation; build, test and lint do not.**")]
    assert len(gate) == 1, gate
    sentence = next(s for s in gate[0].split(". ") if "until you confirm" in s)
    for command in GATED_COMMANDS:
        assert command in sentence, command
    assert "Editing a checkout under review does not make it trusted" in gate[0]
