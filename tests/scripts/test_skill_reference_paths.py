# SPDX-License-Identifier: Apache-2.0
"""Every references/ path named in a skills/*/SKILL.md must exist.

A bare `references/x.md` resolves against the skill's own directory. A
`<skill>/references/x.md` resolves against skills/<skill>/, since skills
install side by side.

Run:  python3 -m pytest tests/scripts/test_skill_reference_paths.py -v
"""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SKILLS_DIR = REPO_ROOT / "skills"

REFERENCE_RE = re.compile(r"(?<![\w./-])((?:[\w.-]+/)?references/[\w./-]*\w)")

# (skill, path) pairs that name a file outside this repo.
NOT_LOCAL = {
    # An example of a file inside a remotely retrieved skill.
    ("find-aws-skills", "references/architecture.md"),
}


def _reference_paths():
    for skill_md in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        skill = skill_md.parent.name
        text = skill_md.read_text(encoding="utf-8")
        for path in sorted(set(REFERENCE_RE.findall(text))):
            if (skill, path) not in NOT_LOCAL:
                yield skill, path


def _resolve(skill, path):
    if path.startswith("references/"):
        return SKILLS_DIR / skill / path
    return SKILLS_DIR / path


REFERENCES = list(_reference_paths())


def test_reference_paths_are_found():
    assert REFERENCES, "no references/ paths found; the pattern is probably wrong"


@pytest.mark.parametrize("skill,path", REFERENCES, ids=[f"{s}:{p}" for s, p in REFERENCES])
def test_reference_path_exists(skill, path):
    assert _resolve(skill, path).is_file(), f"skills/{skill}/SKILL.md names {path}, which does not exist"


def test_not_local_entries_are_still_named():
    for skill, path in NOT_LOCAL:
        text = (SKILLS_DIR / skill / "SKILL.md").read_text(encoding="utf-8")
        assert path in text, f"stale NOT_LOCAL entry: {skill} no longer names {path}"
