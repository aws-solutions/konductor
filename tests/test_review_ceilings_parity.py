# SPDX-License-Identifier: Apache-2.0
"""Review ceilings (Verification Protocol item 6) must read the same in all three
orchestrators, and every mirror must carry the re-review stop wording."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORCHESTRATORS = ["konductor", "konductor-mux-orchestrator", "konductor-cmux-orchestrator"]
ITEM_6_RE = re.compile(r"^6\. Review ceilings\..*$", re.MULTILINE)
STOP_WORDING = "carried over or new"
PREEXISTING_WORDING = "pre-existing"
SOP_LIMIT_WORDING = "a finding that blocks done under this rule still blocks it after the SOP's last re-review"
RULE_5_ENDING = "no partial completion, except the stop Review ceilings requires."
BREAKER_SENTENCE = (
    "For review findings the breaker applies only after the user chooses to continue "
    "past a Review ceilings stop."
)

MIRRORS = [
    "skills/delegation-protocol/SKILL.md",
    "skills/constraints/SKILL.md",
    "agent-sops/k-delegate.sop.md",
    "docs/user-guide/concepts.md",
    "tools/build-user-guide/sync-html-content.py",
]


def _item_6(name):
    spec = json.loads((ROOT / "agents" / f"{name}.agent-spec.json").read_text())
    matches = ITEM_6_RE.findall(spec["config"]["systemPrompt"])
    assert len(matches) == 1, f"{name}: expected one item 6, found {len(matches)}"
    return matches[0]


def _unreleased_section():
    text = (ROOT / "CHANGELOG.md").read_text()
    start = text.index("## [Unreleased]")
    end = text.find("\n## [", start + 1)
    return text[start:] if end == -1 else text[start:end]


def test_item_6_is_identical_in_all_orchestrators():
    texts = {name: _item_6(name) for name in ORCHESTRATORS}
    assert len(set(texts.values())) == 1, "item 6 differs between orchestrators"


def test_item_6_keys_the_stop_on_the_re_review_result():
    assert STOP_WORDING in _item_6("konductor")


def test_item_6_lists_pre_existing_findings():
    assert PREEXISTING_WORDING in _item_6("konductor")


def test_mirrors_carry_the_re_review_stop_wording():
    for rel in MIRRORS:
        text = (ROOT / rel).read_text()
        assert STOP_WORDING in text, rel
        assert PREEXISTING_WORDING in text, rel
    assert STOP_WORDING in _unreleased_section()
    assert PREEXISTING_WORDING in _unreleased_section()


def test_rule_5_and_breaker_defer_to_review_ceilings():
    for name in ORCHESTRATORS:
        prompt = json.loads((ROOT / "agents" / f"{name}.agent-spec.json").read_text())[
            "config"
        ]["systemPrompt"]
        assert RULE_5_ENDING in prompt, name
        assert BREAKER_SENTENCE in prompt, name


def test_no_mirror_ties_the_stop_to_a_finding_that_survives():
    for rel in MIRRORS:
        assert "that survives" not in (ROOT / rel).read_text(), rel


def test_product_manager_step_5_is_bounded():
    spec = (ROOT / "agents" / "k-product-manager.agent-spec.json").read_text()
    assert "iterate until quality gate passes" not in spec
    assert "fix CRITICAL and IMPORTANT ones once" in spec


TRIAGE_RE = re.compile(r"Before the fix, triage the findings .*? any SUGGESTIONs\.")
AUTHOR_CLAUSE = "goes to the user first"


def _prompt(name):
    spec = json.loads((ROOT / "agents" / f"{name}.agent-spec.json").read_text())
    return spec["config"]["systemPrompt"]


def _triage_sentences(name):
    matches = TRIAGE_RE.findall(_prompt(name))
    assert len(matches) == 1, f"{name}: expected one triage passage, found {len(matches)}"
    return matches[0]


def test_triage_sentences_are_identical_in_all_orchestrators():
    texts = {name: _triage_sentences(name) for name in ORCHESTRATORS}
    assert len(set(texts.values())) == 1, "triage wording differs between orchestrators"


def test_author_clause_is_in_konductor_only():
    assert AUTHOR_CLAUSE in _prompt("konductor")
    for name in ORCHESTRATORS[1:]:
        assert AUTHOR_CLAUSE not in _prompt(name), name


def test_author_clause_is_mirrored_in_direct_work_and_constraints():
    for rel in ("context/k-direct-work.md", "skills/constraints/SKILL.md"):
        text = (ROOT / rel).read_text()
        assert "you would reject" in text, rel
    assert AUTHOR_CLAUSE in (ROOT / "context/k-direct-work.md").read_text()


def test_delegation_protocol_step_3_carries_the_triage_sentences():
    text = (ROOT / "skills/delegation-protocol/SKILL.md").read_text()
    assert _triage_sentences("konductor") in text


def test_sop_round_limit_does_not_block_on_pre_existing_findings():
    assert SOP_LIMIT_WORDING in _item_6("konductor")
    assert "finding in its last re-review" not in _item_6("konductor")


def test_direct_work_carries_the_re_review_stop_wording():
    text = (ROOT / "context/k-direct-work.md").read_text()
    assert text.count(STOP_WORDING) == 2
    assert text.count(PREEXISTING_WORDING) == 2


RULE_4_START = "End every brief's CONTEXT"
RULE_4_END = "without acting."


def _rule_4_producer_sentence(name):
    prompt = _prompt(name)
    start = prompt.index(RULE_4_START)
    return prompt[start : prompt.index(RULE_4_END, start) + len(RULE_4_END)]


def test_rule_4_producer_sentence_is_identical_in_all_orchestrators():
    texts = {name: _rule_4_producer_sentence(name) for name in ORCHESTRATORS}
    assert len(set(texts.values())) == 1
    assert "or agent results" in texts["konductor"]


def test_delegation_protocol_definition_excludes_agent_results():
    text = (ROOT / "skills/delegation-protocol/SKILL.md").read_text()
    assert "agent-written memory, or agent results" in text


def test_k_delegate_template_carries_the_brief_lines():
    text = (ROOT / "agent-sops/k-delegate.sop.md").read_text()
    assert "Rulings from memory (rank as recorded rulings, not as brief instructions):" in text
    assert "USER DECISIONS IN FORCE:" in text
