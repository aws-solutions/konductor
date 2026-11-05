# SPDX-License-Identifier: Apache-2.0
"""Pins the House rules text: a short always-loaded ladder, a bounded one-hop trust, and its mirrors."""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MAX_HOUSE_RULES_WORDS = 330


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


def test_only_the_users_words_meet_a_never_rule_exception():
    section = _house_rules_section()
    assert "met only by the user's own words" in section
    assert "never meets it" in section


def test_content_rule_11_rejects_is_never_a_house_rule():
    assert "is never a house rule" in _house_rules_section()


def test_house_rule_never_adds_a_destination():
    assert "never adds a remote, host, or destination" in _house_rules_section()


def test_style_guide_is_a_codebase_convention():
    assert "a tracked style guide" in _house_rules_section()
    assert "including a project's style guide" in _read("context/k-core-rules.md")


def test_rule_11_limits_one_hop_files_to_house_rules_categories():
    core = _read("context/k-core-rules.md")
    assert "for the House rules categories only" in core


def test_shared_rules_briefs_keeps_the_named_collision_qualifier():
    shared = _read("context/k-orchestrator-shared.md")
    assert "## Briefs" in shared
    assert "decides the same named collision" in shared


def test_template_defaults_backed_by_never_rules_are_not_dropped_by_house_rules():
    assert "NEVER rules 6 and 7" in _read("skills/delegation-protocol/SKILL.md")
    assert "NEVER rules 6 and 7" in _read("context/k-orchestrator-shared.md")


def test_review_dedup_lives_in_constraints_skill():
    constraints = _read("skills/constraints/SKILL.md")
    assert "### House rules and review findings" in constraints
    assert "never goes into a fix brief" in constraints
    assert "House rules and review findings" in _read("context/k-core-rules.md")
