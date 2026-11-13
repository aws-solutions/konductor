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
    validator; the write line lives in its own fence."""
    writing = RAW.split("## Writing Memory")[1].split("## Configuration")[0]
    fences = re.findall(r"```bash\n(.*?)```", writing, flags=re.DOTALL)
    lookup = fences[0]
    assert 'VALIDATOR=""' in lookup, lookup
    assert "memory-validator.sh not found" in lookup, lookup
    assert '| bash "$VALIDATOR"' not in lookup, lookup
    step_1 = writing.split("1. ")[1].split("2. ")[0]
    assert "its lookup fence only" in step_1, step_1


def test_write_fence_takes_its_target_from_a_variable():
    """A write line hard-coded to MEMORY.md replaces MEMORY.md with USER.md
    content when the agent updates USER.md, and an unset `$PROPOSED_CONTENT`
    used to empty the file with exit 0."""
    writing = RAW.split("## Writing Memory")[1].split("## Configuration")[0]
    write = re.findall(r"```bash\n(.*?)```", writing, flags=re.DOTALL)[1]
    lines = [line for line in write.strip().splitlines() if not line.lstrip().startswith("#")]
    assert len(lines) == 2, write
    assignment, write_line = lines
    assert assignment.startswith('TARGET=".konductor/memory/MEMORY.md"'), assignment
    assert "# or .konductor/memory/USER.md" in assignment, assignment
    assert write_line.strip() == 'printf \'%s\' "$PROPOSED_CONTENT" | bash "$VALIDATOR" "$TARGET"', write_line
    assert 'bash "$VALIDATOR" ".konductor/memory/MEMORY.md"' not in RAW
    writing_text = " ".join(writing.split())
    assert "in one shell call" in writing_text, writing_text
    assert "`--clear`" in writing_text, writing_text
    assert "`--clear <target>`" not in writing_text, writing_text
    assert "replaces the file with an empty one and exits 0" not in writing_text


def test_removing_the_last_entry_names_the_clear_flag():
    """Deleting the only entry pipes empty content, which the validator
    refuses without `--clear`; the Remove an entry step should say so."""
    remove = RAW.split("### Remove an entry")[1].split("### ")[0]
    assert "`--clear`" in remove, remove


def test_clear_command_redirects_stdin():
    """The validator reads stdin even with `--clear`, so the inline command
    must give it empty input instead of waiting on an open terminal."""
    remove = RAW.split("### Remove an entry")[1].split("### ")[0]
    assert '`bash "$VALIDATOR" --clear "$TARGET" < /dev/null`' in remove, remove


def test_failed_write_steps_do_not_point_at_clear():
    """Retrying an empty-content refusal with `--clear` while the variable is
    still unset empties the file with exit 0, so only Remove an entry names it."""
    writing = RAW.split("## Writing Memory")[1].split("### Add an entry")[0]
    assert "--clear" not in writing, writing
    step_5 = " ".join(writing.split("5. ")[1].split())
    assert "rebuild `$PROPOSED_CONTENT` and run the lookup and the write in one shell call" in step_5, step_5
    sections = RAW.split("### ")
    assert [s.split("\n")[0] for s in sections if "--clear" in s] == ["Remove an entry"]


def test_gitignore_bootstrap_targets_the_git_root():
    """The validator writes memory at the git root, so a cwd-relative
    `>> .gitignore` run from a subdirectory ignores nothing."""
    assert 'ROOT="$(git --no-pager -c core.fsmonitor= rev-parse --show-toplevel 2>/dev/null || pwd -P)"' in RAW
    assert '[ -L "$ROOT/.gitignore" ]' in RAW
    assert "grep -qxF '.konductor/memory/' \"$ROOT/.gitignore\"" in RAW
    assert ">> \"$ROOT/.gitignore\"" in RAW
    assert ">> .gitignore" not in RAW


def test_gitignore_bootstrap_never_glues_onto_the_last_line():
    """Appending to a `.gitignore` with no trailing newline turns
    `node_modules/` into `node_modules/.konductor/memory/`, which ignores
    neither path."""
    assert '[ -z "$(tail -c1 "$ROOT/.gitignore")" ] || printf \'\\n\'' in RAW
    assert "printf '.konductor/memory/\\n'" in RAW
    assert "adds a newline first when the file does not end in one" in TEXT
