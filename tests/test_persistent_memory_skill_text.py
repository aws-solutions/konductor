# SPDX-License-Identifier: Apache-2.0
"""Pins the wording of the persistent-memory skill."""

from pathlib import Path

import yaml

SKILL = Path(__file__).resolve().parent.parent / "skills" / "persistent-memory" / "SKILL.md"
RAW = SKILL.read_text(encoding="utf-8")
TEXT = " ".join(RAW.split())


def test_description_leads_with_how_users_ask():
    description = yaml.safe_load(RAW.split("---")[1])["description"]
    assert description.startswith('Use when the user says "remember this", "save this" or "forget that"')


def test_headings_carry_no_section_numbers():
    assert not [line for line in RAW.splitlines() if line.startswith("#") and "§" in line]


def test_memory_files_heading_and_share_note():
    assert "## Memory Files" in RAW
    assert "Scratchpad" not in RAW
    assert "remove that line to share memory" in TEXT


def test_scan_before_create_does_not_read_a_skipped_file():
    """A file the session-start check skipped is not in context; reading it
    for the overlap check would bypass the checked read."""
    scan = TEXT.split("## Scan-Before-Create")[1].split("## Provenance Markers")[0]
    assert "through the checked read in Reading Memory" in scan
    assert "A file skipped at session start" in scan
    assert "is not read for the overlap check either" in scan
    assert "Read them directly" not in scan


def test_gitignore_bootstrap_targets_the_git_root():
    """The validator writes memory at the git root, so a cwd-relative
    `>> .gitignore` run from a subdirectory ignores nothing."""
    assert 'ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"' in RAW
    assert '[ -L "$ROOT/.gitignore" ]' in RAW
    assert "grep -qxF '.konductor/memory/' \"$ROOT/.gitignore\"" in RAW
    assert ">> \"$ROOT/.gitignore\"" in RAW
    assert ">> .gitignore" not in RAW
