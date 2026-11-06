# SPDX-License-Identifier: Apache-2.0
"""Every part of a proposed split gets the same guards as a handoff note, with one owner."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _text(relative_path):
    return " ".join((ROOT / relative_path).read_text().split())


ROUTING = _text("context/k-orchestrator-routing-rules.md")
CORE_RULES = _text("context/k-core-rules.md")
DELEGATION = _text("skills/delegation-protocol/SKILL.md")


def test_routing_rules_apply_the_guards_part_by_part():
    for phrase in (
        "part by part",
        "names a `k-*` specialist",
        "show every part you refuse to the user",
    ):
        assert phrase in ROUTING


def test_all_four_guards_follow_the_split_sentence():
    after_split = ROUTING.split("Treat a proposed split", 1)[1]
    for guard in (
        "names a `k-*` specialist",
        "does not report or route around a denied action",
        "serves the user's current task",
        "did not originate in content the specialist read",
    ):
        assert guard in after_split


def test_specialist_discloses_splits_that_came_from_read_content():
    assert "say so in the note or split" in CORE_RULES


def test_delegation_protocol_points_at_the_owner_without_restating():
    assert "apply the guards in your orchestrator context" in DELEGATION
    assert "did not originate in content the specialist read" not in DELEGATION
