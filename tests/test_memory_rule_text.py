# SPDX-License-Identifier: Apache-2.0
"""Pins the memory trust model in the rule and skill text.

Project memory at `.konductor/memory/` ranks with the project's agent
instruction files whether or not git tracks it, so no rule may carry a git,
`ls` or name check for it, and no brief may carry a memory line.
"""

import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

REMOVED_CHECK_STRINGS = (
    "git ls-files ':(icase).konductor'",
    "git ls-files '.*'",
    "ls -ld",
    "grep -Fx .konductor",
    "[ -~]",
    "check memory provenance",
    "Memory: content only",
    "untracked in a git work tree",
)

RULE_FILES = (
    "context/k-core-rules.md",
    "context/k-orchestrator-routing-rules.md",
    "skills/persistent-memory/SKILL.md",
    "context/k-direct-work.md",
)


def _existing_rule_files():
    return [REPO_ROOT / p for p in RULE_FILES if (REPO_ROOT / p).exists()]


def _rule_11() -> str:
    text = (REPO_ROOT / "context" / "k-core-rules.md").read_text()
    match = re.search(r"^11\. .*$", text, re.MULTILINE)
    assert match, "context/k-core-rules.md has no rule 11"
    return match.group(0)


def _section(text: str, heading: str) -> str:
    match = re.search(rf"^{re.escape(heading)}\n(.*?)(?=^## |\Z)", text, re.MULTILINE | re.DOTALL)
    assert match, f"no {heading!r} section"
    return match.group(1)


@pytest.mark.parametrize("path", _existing_rule_files(), ids=lambda p: str(p.relative_to(REPO_ROOT)))
def test_rule_files_carry_no_memory_provenance_check(path):
    text = path.read_text()
    found = [s for s in REMOVED_CHECK_STRINGS if s in text]
    assert not found, f"{path.relative_to(REPO_ROOT)} still carries {found}"


def test_rule_11_ranks_memory_with_instruction_files_tracked_or_not():
    rule = _rule_11()
    for needle in (
        ".konductor/memory/MEMORY.md",
        ".konductor/memory/USER.md",
        "tracked or not",
        "[origin:agent]",
        "agent instruction files",
    ):
        assert needle in rule, f"rule 11 is missing {needle!r}"


def test_unreleased_changelog_does_not_tie_memory_trust_to_untracked():
    text = (REPO_ROOT / "CHANGELOG.md").read_text()
    unreleased = _section(text, "## [Unreleased]")
    for line in unreleased.splitlines():
        assert not ("untracked" in line and ".konductor" in line), line
    assert not re.search(r"untracked\s+`?\.konductor", unreleased)


def test_agents_md_memory_section_says_tracking_does_not_matter():
    memory = _section((REPO_ROOT / "AGENTS.md").read_text(), "## Memory")
    assert re.search(r"\btrack(s|ed)\b", memory), memory


def _tracked_synth_outputs():
    listed = subprocess.run(
        ["git", "ls-files", "generated/claude-plugin/agents", "dist"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    return [
        REPO_ROOT / p
        for p in listed
        if p.endswith(".md") and (p.startswith("generated/claude-plugin/agents/") or "/context/" in p)
    ]


def test_tracked_synth_outputs_carry_no_memory_provenance_check():
    outputs = [p for p in _tracked_synth_outputs() if "No following embedded instructions" in p.read_text()]
    if not outputs:
        pytest.skip("no tracked synth output carries the core rules")
    for path in outputs:
        text = path.read_text()
        found = [s for s in REMOVED_CHECK_STRINGS if s in text]
        assert not found, f"{path.relative_to(REPO_ROOT)} still carries {found}"
