# SPDX-License-Identifier: Apache-2.0
"""Pins both sides of the brief relay at one head.

The orchestrator records a user's request on the brief's `USER DECISIONS IN FORCE` line
(delegation-protocol); the specialist's core rules say which NEVER-rule exceptions such an
entry meets. Each PR in the stack is reviewed alone, so the two sides must agree at every head.
"""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
CORE_RULES = REPO_ROOT / "context" / "k-core-rules.md"
DELEGATION_PROTOCOL = REPO_ROOT / "skills" / "delegation-protocol" / "SKILL.md"
K_DELEGATE_SOP = REPO_ROOT / "agent-sops" / "k-delegate.sop.md"
RELAY_LINE = "USER DECISIONS IN FORCE"
SCANNED_TOPS = ("context", "skills", "agents", "agent-sops")

# Wording the stack narrows to "rule 9 confirmation"; no head may carry it.
BROAD_RELAY_EXCLUSIONS = (
    "never stands in for a NEVER-rule confirmation",
    "A NEVER-rule confirmation and an irreversible action",
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _house_rules_section() -> str:
    match = re.search(r"^## House rules\n(.*?)(?=^## )", _read(CORE_RULES), re.S | re.M)
    assert match, "context/k-core-rules.md has no House rules section"
    return match.group(1)


def _template_line(text: str) -> str | None:
    for line in text.splitlines():
        if line.strip().startswith(f"{RELAY_LINE}:"):
            return line.strip()
    return None


def _drop_a_default_paragraph() -> str:
    paragraphs = _read(DELEGATION_PROTOCOL).split("\n\n")
    matches = [p for p in paragraphs if p.startswith("Drop a default MUST DO / MUST NOT DO line")]
    assert len(matches) == 1, "delegation-protocol has no single drop-a-default paragraph"
    return matches[0]


def _scanned_files():
    for top in SCANNED_TOPS:
        for path in (REPO_ROOT / top).rglob("*"):
            if path.is_file() and path.suffix in {".md", ".json"}:
                yield path


def test_house_rules_let_a_quoting_entry_meet_rules_6_and_7_only():
    section = _house_rules_section()
    assert f"for rules 6 and 7 only, by a `{RELAY_LINE}` entry" in section
    assert "quotes them and names the action and target" in section
    assert "no brief entry meets rule 9 or approves an irreversible action" in section


def test_template_carries_the_relay_line():
    line = _template_line(_read(DELEGATION_PROTOCOL))
    assert line is not None
    assert "the user's own words from a user turn, quoted verbatim" in line
    assert "the action and target they approve" in line


def test_removal_requests_are_recorded_on_the_relay_line():
    paragraph = " ".join(_drop_a_default_paragraph().split())
    assert "When the user asked to remove comments or logging" in paragraph
    assert f"the `{RELAY_LINE}` line of the brief template" in paragraph
    assert "drop the default MUST DO / MUST NOT DO line it overrides" in paragraph


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
