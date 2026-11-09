# SPDX-License-Identifier: Apache-2.0
"""Review ceilings (Verification Protocol item 6) is stated once, byte-identical in the three
orchestrators. Orchestrator-only readers point at it; every other mirror carries the four
pinned clauses (stop, pre-existing, own output, still open), say that a pre-existing finding is not
put in the fix brief, and carry nothing that contradicts them."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORCHESTRATORS = ["konductor", "konductor-mux-orchestrator", "konductor-cmux-orchestrator"]
ITEM_6_RE = re.compile(r"^6\. Review ceilings\..*$", re.MULTILINE)
STOP_WORDING = "carried over or new"
PREEXISTING_WORDING = "pre-existing"
PREDATES_WORDING = "code the task did not add or change"
OWN_OUTPUT_WORDING = "in the task's own output"
OPEN_WORDING = "still open"
NOT_IN_FIX_BRIEF_WORDING = "not put in the fix brief"
FIX_CAUSED_QUALIFIER_WORDING = "code the task did not add or change, and the fix did not cause, is listed"
STOP_SCOPE_WORDING = "stop work on that artifact"
STOP_SCOPE_CHANGELOG_WORDING = "stops work on that artifact"
PASS_WORDING = "Pass: no CRITICAL or IMPORTANT in the task's own output"
UNSCOPED_OPEN_WORDING = "Any first-review CRITICAL or IMPORTANT finding still open"
OLD_FIRST_REVIEW_WORDING = "the first review did not report"
RE_REVIEW_SCOPE_WORDING = "every CRITICAL or IMPORTANT finding from the first review"
MIRROR_SCOPE_WORDING = (
    "every first-review CRITICAL or IMPORTANT finding plus what the fix changed and what depends on it"
)
SOP_LIMIT_WORDING = "An SOP's own fix scope and limit on fix rounds win"
SOP_LIMIT_POINTER_WORDING = "fix scope and round limit win"
OLD_SOP_LIMIT_WORDING = "limit on fix rounds wins"
POINTER_WORDING = "Review ceilings (Verification Protocol item 6"
RULE_5_ENDING = "no partial completion, except the stop Review ceilings requires."
BREAKER_SENTENCE = (
    "For review findings the breaker applies only after the user chooses to continue "
    "past a Review ceilings stop."
)

POINTER_FILES = [
    "skills/delegation-protocol/SKILL.md",
    "agent-sops/k-delegate.sop.md",
]

MIRRORS = [
    "skills/constraints/SKILL.md",
    "docs/user-guide/concepts.md",
    "tools/build-user-guide/sync-html-content.py",
]

SOP_LIMIT_MIRRORS = [
    "docs/user-guide/concepts.md",
    "tools/build-user-guide/sync-html-content.py",
]

ALL_COPIES = POINTER_FILES + MIRRORS + ["CHANGELOG.md", "skills/code-review/SKILL.md"]


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


def test_mirrors_carry_the_four_pinned_clauses():
    for rel in MIRRORS:
        text = (ROOT / rel).read_text()
        for wording in (STOP_WORDING, PREEXISTING_WORDING, PREDATES_WORDING, OWN_OUTPUT_WORDING, OPEN_WORDING):
            assert wording in text, (rel, wording)
        assert NOT_IN_FIX_BRIEF_WORDING in text, rel
        assert FIX_CAUSED_QUALIFIER_WORDING in text, rel
    unreleased = _unreleased_section()
    for wording in (STOP_WORDING, PREEXISTING_WORDING, PREDATES_WORDING, OWN_OUTPUT_WORDING, OPEN_WORDING):
        assert wording in unreleased, wording
    assert NOT_IN_FIX_BRIEF_WORDING in unreleased
    assert FIX_CAUSED_QUALIFIER_WORDING in unreleased
    assert STOP_SCOPE_CHANGELOG_WORDING in unreleased


def test_pre_existing_is_never_keyed_to_the_first_review_report():
    for name in ORCHESTRATORS:
        assert OLD_FIRST_REVIEW_WORDING not in _item_6(name), name
    for rel in ALL_COPIES:
        assert OLD_FIRST_REVIEW_WORDING not in (ROOT / rel).read_text(), rel


def test_orchestrator_only_readers_point_at_item_6():
    for rel in POINTER_FILES:
        text = (ROOT / rel).read_text()
        assert POINTER_WORDING in text, rel
        assert MIRROR_SCOPE_WORDING in text, rel
        assert SOP_LIMIT_POINTER_WORDING in text, rel
        assert OLD_SOP_LIMIT_WORDING not in text, rel
        assert "listed for the user as pre-existing" not in text, rel


def test_rule_5_and_breaker_defer_to_review_ceilings():
    for name in ORCHESTRATORS:
        prompt = json.loads((ROOT / "agents" / f"{name}.agent-spec.json").read_text())[
            "config"
        ]["systemPrompt"]
        assert RULE_5_ENDING in prompt, name
        assert BREAKER_SENTENCE in prompt, name


def test_no_mirror_ties_the_stop_to_a_finding_that_survives():
    for rel in POINTER_FILES + MIRRORS:
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


def test_sop_scope_and_round_limit_win_and_leave_nothing_dropped():
    item = _item_6("konductor")
    assert SOP_LIMIT_WORDING in item
    assert "a finding it leaves open is reported to the user as unresolved, never dropped" in item
    assert OLD_SOP_LIMIT_WORDING not in item
    assert "finding in its last re-review" not in item
    for rel in SOP_LIMIT_MIRRORS:
        assert SOP_LIMIT_WORDING in (ROOT / rel).read_text(), rel


def test_item_6_re_reviews_every_first_review_finding():
    assert RE_REVIEW_SCOPE_WORDING in _item_6("konductor")


def test_open_first_review_finding_in_the_tasks_own_output_blocks_done():
    item = _item_6("konductor")
    assert "Any first-review CRITICAL or IMPORTANT finding in the task's own output still open" in item
    assert UNSCOPED_OPEN_WORDING not in item


def test_re_review_finding_in_the_tasks_own_output_blocks_done():
    item = _item_6("konductor")
    assert (
        "any CRITICAL or IMPORTANT finding the re-review reports in the task's own output "
        "(what the task added or changed, including the fix), carried over or new, or caused by "
        "the fix in what depends on it, blocks done"
    ) in item
    assert "any such finding" not in item


def test_pass_clause_is_scoped_to_the_tasks_own_output_or_the_fix():
    item = _item_6("konductor")
    assert PASS_WORDING + " or caused by the fix." in item
    assert "Pass: no CRITICAL or IMPORTANT. " not in item


def test_stop_is_scoped_to_the_artifact_and_what_depends_on_it():
    item = _item_6("konductor")
    assert (
        "blocks done: " + STOP_SCOPE_WORDING + " and on what depends on it, finish or report "
        "the independent artifacts, and report the finding to the user as unresolved."
    ) in item
    assert "instead of proceeding" not in item


def test_pre_existing_means_code_the_task_did_not_touch():
    item = _item_6("konductor")
    assert (
        "A finding in code the task did not add or change (lines already on the base branch) "
        "and the fix did not cause is listed for the user as pre-existing; it is not put in the fix brief."
    ) in item
    assert "unchanged code that the fix did not cause" not in item


def test_code_review_skill_matches_review_ceilings():
    text = (ROOT / "skills/code-review/SKILL.md").read_text()
    assert "**Fix once**" in text
    assert "**Re-review once**" in text
    assert "Review ceilings" in text
    assert PREDATES_WORDING.replace("the task", "you") in text
    assert "every CRITICAL and IMPORTANT finding from step 2, plus what the fix changed and what depends on it" in text
    assert "review what the fix changed and what depends on it. If" not in text
    assert (
        "If a CRITICAL or IMPORTANT in your own changes, or one your fix caused in what depends on them, "
        "remains, stop and escalate"
    ) in text
    assert "If a CRITICAL or IMPORTANT remains" not in text
    assert "in your own changes remains" not in text
    assert "code you did not add or change, and your fix did not cause, is listed for the user as pre-existing, not fixed" in text
    assert "Max 2 cycles" not in text
    assert "More than 2 fix cycles" not in text
    assert "More than one fix cycle attempted without escalation" in text


def test_direct_work_refers_to_review_ceilings_once():
    text = (ROOT / "context/k-direct-work.md").read_text()
    assert text.count("Verification Protocol item 6") == 1
    assert STOP_WORDING not in text
    assert "list what item 6 calls pre-existing" in text
    # The pointer governs the scope; the mirror does not paraphrase it.
    assert "one re-check or re-review as item 6 scopes it" in text
    assert "re-review of what the fix changed and what depends on it" not in text


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
