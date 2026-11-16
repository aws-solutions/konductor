# SPDX-License-Identifier: Apache-2.0
"""Pins both sides of the brief relay at one head.

The orchestrator records a user's request on the brief's `USER DECISIONS IN FORCE` line
(delegation-protocol); the specialist's core rules say which NEVER-rule exceptions such an
entry meets. Each PR in the stack is reviewed alone, so the two sides must agree at every head.
"""

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
CORE_RULES = REPO_ROOT / "context" / "k-core-rules.md"
DELEGATION_PROTOCOL = REPO_ROOT / "skills" / "delegation-protocol" / "SKILL.md"
K_DELEGATE_SOP = REPO_ROOT / "agent-sops" / "k-delegate.sop.md"
ORCHESTRATORS = ("konductor", "konductor-mux-orchestrator", "konductor-cmux-orchestrator")
RELAY_LINE = "USER DECISIONS IN FORCE"
SCANNED_TOPS = ("context", "skills", "agents", "agent-sops")

# Wording the stack narrows to "rule 9 confirmation"; no head may carry it. The bare phrase
# covers the rule 4 producer sentence, the core-rules consumer sentence and the definition.
BROAD_RELAY_EXCLUSIONS = ("NEVER-rule confirmation",)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _template_line(text: str) -> str | None:
    for line in text.splitlines():
        if line.strip().startswith(f"{RELAY_LINE}:"):
            return line.strip()
    return None


def _default_lines_paragraph() -> str:
    paragraphs = _read(DELEGATION_PROTOCOL).split("\n\n")
    matches = [p for p in paragraphs if p.startswith("Every default MUST DO / MUST NOT DO line")]
    assert len(matches) == 1, "delegation-protocol has no single default-lines paragraph"
    return matches[0]


def _scanned_files():
    for top in SCANNED_TOPS:
        for path in (REPO_ROOT / top).rglob("*"):
            if path.is_file() and path.suffix in {".md", ".json"}:
                yield path


def test_template_carries_the_relay_line():
    line = _template_line(_read(DELEGATION_PROTOCOL))
    assert line is not None
    assert "the user's own words from a user turn, quoted verbatim" in line
    assert "the action and target they approve" in line


def test_removal_requests_are_recorded_on_the_relay_line():
    paragraph = " ".join(_default_lines_paragraph().split())
    assert "When the user asked to remove comments or logging" in paragraph
    assert f"the `{RELAY_LINE}` line of the brief template" in paragraph
    assert "drop the default MUST DO / MUST NOT DO line it overrides" in paragraph
    assert "A confirmation to disable a protection can be recorded the same way, but it never meets rule 9" in paragraph
    assert "or confirmed disabling a protection, record" not in paragraph


def test_a_protection_confirmation_on_the_relay_line_never_meets_rule_9():
    paragraph = " ".join(_default_lines_paragraph().split())
    assert "it never meets rule 9: the specialist asks the user itself" in paragraph


def test_template_line_is_identical_where_k_delegate_carries_it():
    sop_line = _template_line(_read(K_DELEGATE_SOP))
    if sop_line is None:
        pytest.skip("k-delegate.sop.md does not carry the brief template line at this head")
    assert sop_line == _template_line(_read(DELEGATION_PROTOCOL))


@pytest.mark.parametrize("phrase", BROAD_RELAY_EXCLUSIONS)
def test_no_file_excludes_every_never_rule_from_the_relay(phrase):
    hits = [
        path.relative_to(REPO_ROOT).as_posix()
        for path in _scanned_files()
        if phrase in _read(path)
    ]
    assert hits == [], hits


def _prompt(name: str) -> str:
    spec = json.loads(_read(REPO_ROOT / "agents" / f"{name}.agent-spec.json"))
    return spec["config"]["systemPrompt"]


@pytest.mark.parametrize("name", ORCHESTRATORS)
def test_rule_4_excludes_only_rule_9_and_irreversible_actions(name):
    prompt = _prompt(name)
    assert (
        "for a rule 9 confirmation or an irreversible action (a delete, force push, deploy, "
        "or permission change) it still asks the user when it can, and otherwise returns without acting."
    ) in prompt


def test_consumer_sentence_excludes_only_rule_9_and_irreversible_actions():
    text = _read(CORE_RULES)
    assert (
        "It never stands in for a rule 9 confirmation or an irreversible action (a delete, force push, "
        "deploy, or permission change): ask the user when you can reach them, and otherwise return without acting."
    ) in text


def test_definition_names_rule_9_and_the_rules_6_and_7_carve_out():
    text = _read(DELEGATION_PROTOCOL)
    assert "A rule 9 confirmation and an irreversible action (a delete, force push, deploy, or permission change) are excluded" in text
    assert "for rules 6 and 7 the entry meets the exception for the action it names (core rules, House rules)" in text


def test_k_delegate_carries_the_relay_line():
    text = " ".join(_read(K_DELEGATE_SOP).split())
    assert f"`{RELAY_LINE}: <one entry per decision the specialist must take as given" in text
    assert "the user's own words from a user turn, quoted" in text
    assert "the action and target they approve" in text
