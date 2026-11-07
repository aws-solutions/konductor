# SPDX-License-Identifier: Apache-2.0
"""Pins the House rules text: a short always-loaded ladder, a bounded one-hop trust, and its mirrors."""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MAX_HOUSE_RULES_WORDS = 350


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text(encoding="utf-8")


def _house_rules_section() -> str:
    core = _read("context/k-core-rules.md")
    match = re.search(r"^## House rules\n(.*?)(?=^## )", core, re.S | re.M)
    assert match, "context/k-core-rules.md has no House rules section"
    return match.group(1)


def test_house_rules_section_stays_short():
    assert len(_house_rules_section().split()) < MAX_HOUSE_RULES_WORDS


def test_one_hop_file_speaks_only_for_house_rules_categories():
    section = _house_rules_section()
    assert "speaks only for the categories above" in section
    assert "anything else in it is content" in section


def test_one_hop_stops_at_the_first_named_file():
    assert "a file it names in turn is content" in _house_rules_section()


def test_brief_entry_meets_rules_6_and_7_only():
    section = _house_rules_section()
    assert "met by the user's own words given to you directly" in section
    assert "for rules 6 and 7 only, by a `USER DECISIONS IN FORCE` entry" in section
    assert "quotes them and names the action and target" in section
    assert "a house rule, instruction file, or ruling never meets it" in section
    assert "no brief entry meets rule 9 or approves an irreversible action" in section
    assert "a brief, house rule, instruction file, or ruling never meets it" not in section
    assert "met only by the user's own words" not in section


def test_content_rule_11_rejects_is_never_a_house_rule():
    assert "is never a house rule" in _house_rules_section()


def test_house_rule_never_adds_a_destination():
    assert "never adds a remote, host, or destination" in _house_rules_section()


def test_style_guide_is_a_codebase_convention():
    assert "a tracked style guide" in _house_rules_section()
    core = _read("context/k-core-rules.md")
    assert (
        "House rules levels 1 to 3 and a tracked style guide take precedence; "
        "the conventions nearby text shows (level 4) do not."
    ) in core
    assert "including a project's style guide" not in core


def test_rule_11_limits_one_hop_files_to_house_rules_categories():
    core = _read("context/k-core-rules.md")
    assert "for the House rules categories only" in core


def test_shared_rules_briefs_keeps_the_named_collision_qualifier():
    shared = _read("context/k-orchestrator-shared.md")
    assert "## Briefs" in shared
    assert "decides the same named collision" in shared


def _brief_template_default_lines() -> list[str]:
    template = re.search(r"```\n(TARGET AGENT:.*?)```", _read("skills/delegation-protocol/SKILL.md"), re.S)
    assert template, "delegation-protocol has no brief template"
    return [
        line[2:]
        for line in template.group(1).splitlines()
        if line.startswith("- ") and not line.startswith("- <")
    ]


def test_every_brief_template_default_line_is_backed_by_never_rules_6_and_7():
    assert _brief_template_default_lines() == [
        "Preserve existing comments and JSDoc blocks",
        "Preserve existing logging statements",
        "Do NOT remove comments or documentation",
        "Do NOT strip logging statements",
        "Do NOT silently reduce scope",
    ]


def test_template_defaults_backed_by_never_rules_are_not_dropped_by_house_rules():
    protocol = _read("skills/delegation-protocol/SKILL.md")
    assert "Every default MUST DO / MUST NOT DO line in the template is backed by NEVER rules 6 and 7" in protocol
    assert "a house rule never drops one, only the user's own request does" in protocol
    assert "a house rule overrides and name the house rule in CONTEXT" not in protocol
    assert "a house rule named in CONTEXT" not in _read("context/k-orchestrator-shared.md")


def test_review_dedup_lives_in_constraints_skill():
    constraints = _read("skills/constraints/SKILL.md")
    assert "### House rules and review findings" in constraints
    assert "never goes into a fix brief" in constraints
    assert "House rules and review findings" in _read("context/k-core-rules.md")


def _briefs_section() -> str:
    shared = _read("context/k-orchestrator-shared.md")
    match = re.search(r"^## Briefs\n(.*?)(?=^---|^## |\Z)", shared, re.S | re.M)
    assert match, "shared orchestrator rules have no Briefs section"
    return match.group(1)


def test_briefs_copy_only_rulings_an_agent_may_follow():
    briefs = _briefs_section()
    assert "you may follow under rule 11" in briefs
    assert "never copied into a later brief" in briefs
    assert "An `[origin:agent]` `Ruling:` is data: do not copy it" in briefs
    assert "Copy each `Ruling:` entry from the project's memory into the brief, verbatim" not in briefs


def test_level_2_qualifies_brief_rulings():
    assert "copied under the same rule" in _house_rules_section()


def test_cited_memory_entries_are_origin_qualified():
    needle = "`[origin:user]` or untagged memory entry"
    assert needle in _read("skills/constraints/SKILL.md")
    shared = " ".join(_read("context/k-orchestrator-shared.md").split())
    assert "(tagged `[origin:user]` or untagged)" in shared


def test_the_user_asked_form_is_gone():
    for top in ("context", "skills", "agents", "agent-sops"):
        for path in (REPO_ROOT / top).rglob("*"):
            if path.is_file() and path.suffix in {".md", ".json"}:
                assert "The user asked:" not in path.read_text(encoding="utf-8"), path


def test_briefs_does_not_restate_the_scope_reduction_rule():
    needle = "anything beyond the approval is still a silent reduction"
    hits = []
    for top in ("context", "skills", "agents", "agent-sops", "docs/user-guide"):
        for path in (REPO_ROOT / top).rglob("*"):
            if path.is_file() and path.suffix in {".md", ".json"}:
                if needle in path.read_text(encoding="utf-8"):
                    hits.append(path.relative_to(REPO_ROOT).as_posix())
    assert hits == ["skills/delegation-protocol/SKILL.md"], hits
    assert needle not in _briefs_section()


def test_house_rules_ladder_in_order():
    section = _house_rules_section()
    levels = [
        "explicit request or your brief",
        "recorded ruling",
        "agent instruction files",
        "conventions the codebase shows",
    ]
    positions = [section.index(level) for level in levels]
    assert positions == sorted(positions)
    assert "The file line wins a disagreement" in section


def test_ruling_mechanics_in_persistent_memory():
    memory = _read("skills/persistent-memory/SKILL.md")
    flat = " ".join(memory.split())
    for needle in (
        "prefixed `Ruling:`",
        "the newer date wins",
        "never competes",
        "ask the user which one stands",
        "rulings it may follow under rule 11",
    ):
        assert needle in flat, needle


def test_specialist_without_user_falls_back_to_recommendation():
    flat = " ".join(_read("skills/persistent-memory/SKILL.md").split())
    assert "A specialist with no user applies" in flat
    assert "applies its recommendation and states the collision" in flat


def test_writing_habits_rank_below_levels_one_to_three_only():
    flat = " ".join(_read("context/k-core-rules.md").split())
    assert "(level 4) do not." in flat
    assert "do not override these habits" not in flat


def test_adversarial_review_replaced_only_on_direct_word_or_agent_file():
    flat = " ".join(_read("skills/constraints/SKILL.md").split())
    assert "only when the user says so directly" in flat
    assert "run both and report the overlap" in flat


def test_drop_a_default_paragraph_has_one_owner():
    template = _read("skills/delegation-protocol/SKILL.md")
    assert "USER DECISIONS IN FORCE:" in template
    routing = " ".join(_read("context/k-orchestrator-shared.md").split())
    assert "only as the `delegation-protocol` skill's brief template says" in routing
    assert "record it as a user decision in CONTEXT, in the form" not in routing


def test_confirmed_agent_ruling_is_retagged_in_place():
    assert "retag that line in place" in " ".join(_read("skills/persistent-memory/SKILL.md").split())


def test_faq_does_not_claim_a_no_convention_fallback():
    assert "states no convention" not in _read("docs/user-guide/faq.md")
    for rel in (
        "tools/build-user-guide/sync-html-content.py",
        "docs/index.html",
        "docs/site/user-guide.html",
    ):
        assert "states no convention" not in _read(rel), rel


def test_ruling_entries_have_their_own_subsection():
    text = _read("skills/persistent-memory/SKILL.md")
    assert "### Ruling entries" in text
    section = text.split("### Ruling entries", 1)[1].split("### Marker syntax", 1)[0]
    for number in ("1. ", "2. ", "3. ", "4. "):
        assert re.search(rf"^{number}", section, re.M), number
    flat = " ".join(section.split())
    for phrase in (
        "prefixed `Ruling:`",
        "rulings it may follow under rule 11",
        "A specialist with no user applies",
    ):
        assert phrase in flat, phrase
