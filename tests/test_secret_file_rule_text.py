# SPDX-License-Identifier: Apache-2.0
"""Rule 12 lets an SOP's credentials_file through; each SOP brief that hands it to a
specialist states that provenance, so the specialist does not refuse to read it."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

BRIEF_SENTENCE = (
    "`credentials_file` comes from the user through this SOP (supplied as its parameter, "
    "or built in Step 1 from the user's own username and password); core rule 12 treats it "
    "as user-named. Read only `test_url`, `user_name` and `password`; never echo the values."
)


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _rule_12_lines():
    return re.findall(r"^12\. \*\*No reading secret files\*\*.*$", _read("context/k-core-rules.md"), re.M)


def test_rule_12_is_one_line_with_the_credentials_file_carve_out():
    lines = _rule_12_lines()
    assert len(lines) == 1
    assert "counts as named by the user" in lines[0]
    assert "never echo their values" in lines[0]


def test_light_ui_testing_states_provenance_in_step_2_and_step_6_briefs():
    sop = _read("agent-sops/k-light-ui-testing.sop.md")
    assert sop.count(BRIEF_SENTENCE) == 2
    step_6 = sop.split("### Step 6:")[1].split("### Step 7:")[0]
    assert "**CONTEXT:**" in step_6
    assert BRIEF_SENTENCE in step_6


def test_e2e_test_generation_states_provenance_in_step_2_brief():
    sop = _read("agent-sops/k-e2e-test-generation.sop.md")
    assert sop.count(BRIEF_SENTENCE) == 1
    step_2 = sop.split("### Step 2:")[1].split("### Step 3:")[0]
    assert BRIEF_SENTENCE in step_2


def test_e2e_test_generation_steps_1_and_5_cite_rule_12():
    sop = _read("agent-sops/k-e2e-test-generation.sop.md")
    step_1 = sop.split("### Step 1:")[1].split("### Step 2:")[0]
    step_5 = sop.split("### Step 5:")[1].split("### Step 6:")[0]
    assert "says the user supplied `credentials_file` as an SOP parameter (core rule 12)" in step_1
    assert "counts as user-named under core rule 12" in step_5


def test_app_discovery_reads_only_the_named_keys():
    assert "never echo the values" in _read("skills/app-discovery/SKILL.md")


def test_orchestrator_files_point_to_rule_12_without_copying_the_carve_out():
    for rel in ("context/k-direct-work.md", "context/k-orchestrator-routing-rules.md"):
        text = _read(rel)
        assert "Core rule 12" in text, rel
        assert "counts as named by the user" not in text, rel
