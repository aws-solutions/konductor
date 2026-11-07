# SPDX-License-Identifier: Apache-2.0
"""Pins the memory trust model in the rule and skill text.

Project memory at `.konductor/memory/` ranks with the project's agent
instruction files whether or not git tracks it, so no rule may carry a git,
`ls` or name check for it, and no brief may carry a memory line. The one read
check is the validator's `--check-path`, which refuses symlinked or misplaced paths.
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
    "context/k-orchestrator-shared.md",
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
        "symlink",
        "--check-path",
        "[origin:agent]",
        "agent instruction files",
    ):
        assert needle in rule, f"rule 11 is missing {needle!r}"


def _rule_11_exemption_sentence() -> str:
    rule = _rule_11()
    start = rule.index("This does not cover")
    end = rule.index(". ", start)
    return rule[start:end]


def test_rule_11_exemption_list_is_flat():
    """The memory item is a bare phrase; the file names and the check live in
    their own sentence (reviewer request on the rule's readability)."""
    exemptions = _rule_11_exemption_sentence()
    assert "the project's memory files," in exemptions, exemptions
    assert "--check-path" not in exemptions, exemptions
    assert ".konductor/memory/" not in exemptions, exemptions


def test_rule_11_memory_has_its_own_sentence():
    rule = _rule_11()
    start = rule.index("The project's memory files are ")
    sentence = rule[start : rule.index(". ", start)]
    assert "--check-path" in sentence, sentence
    assert ".konductor/memory/MEMORY.md" in sentence, sentence
    assert "symlink" in sentence, sentence


def test_reading_memory_runs_the_validator_path_check():
    skill = (REPO_ROOT / "skills/persistent-memory/SKILL.md").read_text()
    reading = _section(skill, "## Reading Memory")
    assert "--check-path" in reading, reading
    assert "exits 0" in reading, reading
    assert "the path it prints" in reading, reading
    # Without a shell nothing can tell a symlink from a file, so the fallback
    # fails closed instead of loading the files as data.
    assert "use both as data" not in reading, reading
    assert "do not load memory" in reading, reading


def test_orchestrator_direct_work_allows_the_memory_path_check():
    """The orchestrators may run only the shell commands the Direct Work table
    names, so the table must name the validator's read-only `--check-path`;
    otherwise an orchestrator either breaks its read-only rule to load memory
    or skips memory and can never write it."""
    rules = (REPO_ROOT / "context" / "k-orchestrator-routing-rules.md").read_text()
    direct_work = _section(rules, "### Orchestrator Direct Work")
    rows = [line for line in direct_work.splitlines() if "--check-path" in line]
    assert len(rows) == 1, direct_work
    row = rows[0]
    for needle in (
        "`persistent-memory` path check",
        ".konductor/memory/MEMORY.md",
        "`USER.md`",
        "lookup fence",
        "reads no stdin and writes nothing",
        "do not load a file whose check exits 1",
    ):
        assert needle in row, f"Direct Work memory row is missing {needle!r}: {row}"


def test_agents_md_context_loading_uses_the_checked_read():
    """The session-start load must go through `--check-path`; a glob reads
    through a symlink and pulls in files rule 11 never names."""
    loading = _section((REPO_ROOT / "AGENTS.md").read_text(), "## Context Loading (MUST follow at session start)")
    assert "--check-path" in loading, loading
    assert "MEMORY.md" in loading, loading
    assert "USER.md" in loading, loading
    assert "memory/*.md" not in loading, loading
    assert "If you have no shell to run the check, skip memory and say so." in loading, loading


def test_unreleased_changelog_does_not_tie_memory_trust_to_untracked():
    text = (REPO_ROOT / "CHANGELOG.md").read_text()
    unreleased = _section(text, "## [Unreleased]")
    for line in unreleased.splitlines():
        assert not ("untracked" in line and ".konductor" in line), line
    assert not re.search(r"untracked\s+`?\.konductor", unreleased)
    assert "Upgrade note" in unreleased, unreleased


def test_agents_md_memory_section_says_tracking_does_not_matter():
    memory = " ".join(_section((REPO_ROOT / "AGENTS.md").read_text(), "## Memory").split())
    assert "whether or not git tracks" in memory, memory
    assert "untracked" not in memory, memory
    # Rule 11 reserves "content" for untrusted text; memory is an instruction file.
    assert "project content" not in memory, memory
    assert "agent instructions" in memory, memory


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
