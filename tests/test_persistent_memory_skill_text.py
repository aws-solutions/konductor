# SPDX-License-Identifier: Apache-2.0
"""Pins the wording of the persistent-memory skill."""

import re
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


def test_write_time_reread_runs_the_checked_read():
    """The validator refuses a symlinked target only on the write; a file that
    became a symlink after session start would be read into context by an
    unchecked re-read before that refusal."""
    writing = TEXT.split("## Writing Memory")[1].split("## Configuration")[0]
    step_1 = writing.split("1. ")[1].split("2. ")[0]
    assert "--check-path" in step_1, step_1
    assert "same check as Reading Memory" in step_1, step_1
    assert "neither read nor write" in step_1, step_1
    assert "Re-read the target file from disk." not in writing
    for recipe in ("### Add an entry", "### Update an entry", "### Remove an entry"):
        body = writing.split(recipe)[1].split("###")[0]
        assert "Checked re-read (step 1)" in body, body
    assert "Re-read file →" not in RAW


def test_reading_memory_points_at_writing_memory_for_the_validator_path():
    assert "Saving Memory" not in RAW
    reading = TEXT.split("## Reading Memory")[1].split("## Writing Memory")[0]
    assert "resolve `$VALIDATOR` as in Writing Memory step 3, its lookup fence only" in reading, reading
    assert "Writing Memory step 1" in reading, reading


def test_validator_lookup_fence_carries_no_write_line():
    """Reading Memory and step 1 paste the step 3 lookup to resolve the
    validator. With `$PROPOSED_CONTENT` unset, a write line in that same fence
    replaces the memory file with an empty one and exits 0."""
    writing = RAW.split("## Writing Memory")[1].split("## Configuration")[0]
    fences = re.findall(r"```bash\n(.*?)```", writing, flags=re.DOTALL)
    lookup, write = fences[0], fences[1]
    assert 'VALIDATOR=""' in lookup, lookup
    assert "memory-validator.sh not found" in lookup, lookup
    assert '| bash "$VALIDATOR"' not in lookup, lookup
    assert write.strip() == 'printf \'%s\' "$PROPOSED_CONTENT" | bash "$VALIDATOR" ".konductor/memory/MEMORY.md"', write
    step_1 = writing.split("1. ")[1].split("2. ")[0]
    assert "its lookup fence only" in step_1, step_1


def test_gitignore_bootstrap_targets_the_git_root():
    """The validator writes memory at the git root, so a cwd-relative
    `>> .gitignore` run from a subdirectory ignores nothing."""
    assert 'ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"' in RAW
    assert '[ -L "$ROOT/.gitignore" ]' in RAW
    assert "grep -qxF '.konductor/memory/' \"$ROOT/.gitignore\"" in RAW
    assert ">> \"$ROOT/.gitignore\"" in RAW
    assert ">> .gitignore" not in RAW
