# SPDX-License-Identifier: Apache-2.0
"""Regression test: every skill under `skills/` that resolves the absolute
path of a bundled script it runs with `python3`/`bash` must try the skill's
own installed directory FIRST, before falling back to a source checkout
(`git rev-parse --show-toplevel`) or a global/project `.konductor` install.

Background: `${CLAUDE_SKILL_DIR}` is the one location that resolves
correctly for every install shape Claude Code supports -- a marketplace
plugin install, and a standalone `.claude/skills/` install -- because
Claude Code substitutes it to the skill's own directory before the model
ever sees the text (see docs/en/skills' "Available string substitutions").
A SKILL.md that resolves its script ONLY via `git rev-parse --show-toplevel`
(a source checkout) or `$HOME/.konductor/skills` (a global Kiro CLI install)
has no path that works in a plugin install at all, which is exactly the bug
this test pins shut for persistent-memory, legacy-to-agentic-estimate,
mux-dispatch, and cmux-dispatch.

Run:  cd tests && pytest test_skill_script_path_resolution.py -v
"""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"

# Skills whose SKILL.md resolves a bundled script's absolute path at
# runtime (as opposed to being pure prose/no bundled script).
SKILLS_WITH_SCRIPT_RESOLUTION = [
    "persistent-memory",
    "legacy-to-agentic-estimate",
    "mux-dispatch",
    "cmux-dispatch",
]

CLAUDE_SKILL_DIR_RE = re.compile(r"\$\{CLAUDE_SKILL_DIR\b")
GIT_TOPLEVEL_RE = re.compile(r"git rev-parse --show-toplevel")
HOME_KONDUCTOR_RE = re.compile(r"\$\{SKILLS_HOME:-\$HOME/\.konductor/skills\}")


@pytest.mark.parametrize("skill_name", SKILLS_WITH_SCRIPT_RESOLUTION)
def test_skill_md_tries_claude_skill_dir_before_git_toplevel_or_home_konductor(skill_name):
    skill_md = SKILLS_DIR / skill_name / "SKILL.md"
    assert skill_md.is_file(), f"missing {skill_md}"
    text = skill_md.read_text(encoding="utf-8")

    claude_skill_dir_pos = _first_match_pos(CLAUDE_SKILL_DIR_RE, text)
    assert claude_skill_dir_pos is not None, (
        f"{skill_md} never references ${{CLAUDE_SKILL_DIR}} -- it can only "
        "resolve its bundled script in a source checkout or a global Kiro "
        "CLI install, never in a Claude Code plugin install"
    )

    git_toplevel_pos = _first_match_pos(GIT_TOPLEVEL_RE, text)
    home_konductor_pos = _first_match_pos(HOME_KONDUCTOR_RE, text)

    for label, pos in (
        ("git rev-parse --show-toplevel", git_toplevel_pos),
        ("${SKILLS_HOME:-$HOME/.konductor/skills}", home_konductor_pos),
    ):
        if pos is None:
            continue
        assert claude_skill_dir_pos < pos, (
            f"{skill_md}: {label!r} appears before ${{CLAUDE_SKILL_DIR}} in "
            "the resolution order -- ${CLAUDE_SKILL_DIR} (the one location "
            "that resolves in a plugin install) must be tried first"
        )


def _first_match_pos(pattern, text):
    match = pattern.search(text)
    return match.start() if match else None


def test_fixture_without_claude_skill_dir_fails(tmp_path):
    """Sanity check on the test's own detection logic: a SKILL.md that only
    ever resolves via git-root or $HOME/.konductor must be caught."""
    skill_md = tmp_path / "SKILL.md"
    skill_md.write_text(
        'SCRIPT="$(git rev-parse --show-toplevel)/skills/x/scripts/run.sh"\n'
        '[ -f "$SCRIPT" ] || SCRIPT="${SKILLS_HOME:-$HOME/.konductor/skills}/x/scripts/run.sh"\n',
        encoding="utf-8",
    )
    text = skill_md.read_text(encoding="utf-8")
    assert _first_match_pos(CLAUDE_SKILL_DIR_RE, text) is None


def test_fixture_with_claude_skill_dir_first_passes():
    text = (
        'SCRIPT="${CLAUDE_SKILL_DIR:-}/scripts/run.sh"\n'
        '[ -f "$SCRIPT" ] || SCRIPT="$(git rev-parse --show-toplevel)/skills/x/scripts/run.sh"\n'
        '[ -f "$SCRIPT" ] || SCRIPT="${SKILLS_HOME:-$HOME/.konductor/skills}/x/scripts/run.sh"\n'
    )
    claude_pos = _first_match_pos(CLAUDE_SKILL_DIR_RE, text)
    git_pos = _first_match_pos(GIT_TOPLEVEL_RE, text)
    home_pos = _first_match_pos(HOME_KONDUCTOR_RE, text)
    assert claude_pos is not None
    assert claude_pos < git_pos
    assert claude_pos < home_pos
