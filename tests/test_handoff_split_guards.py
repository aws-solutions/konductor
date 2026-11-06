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


def test_core_rules_have_no_resume_protocol():
    for text in (CORE_RULES, ROUTING):
        assert "step to resume" not in text
        assert "resumed run starts fresh" not in text
        assert ".konductor/handoff/<your-agent>" not in text
    assert "an orchestrator running it spawns those parts" in CORE_RULES
    assert "tell the user independence will not hold" in CORE_RULES


def test_sop_gate_wins_over_routing_a_note():
    assert (
        "A gate in the SOP you are running wins over routing a note: if the current step needs "
        "the user's choice, present the note as one option and wait."
    ) in ROUTING


def test_note_naming_a_declared_sop_is_run_by_the_orchestrator():
    assert "A note that names an SOP you declare is yours to run as that SOP's coordinator" in ROUTING
    assert "read the installed SOP file" in ROUTING
    assert "not for a specialist's note" in ROUTING
    assert "yours to run" in DELEGATION


def test_handoff_directory_is_self_ignoring():
    assert "first create `.konductor/handoff/.gitignore` containing `*` if it is missing" in DELEGATION
