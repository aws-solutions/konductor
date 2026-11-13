# SPDX-License-Identifier: Apache-2.0
"""Every references/ path named in a skills/*/SKILL.md or skills/*/references/*.md must exist.

A bare `references/x.md` resolves against the skill's own directory. A
`<skill>/references/x.md` resolves against skills/<skill>/, since skills
install side by side.

Run:  python3 -m pytest tests/test_skill_reference_paths.py -v
"""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"

REFERENCE_RE = re.compile(r"(?<![\w./-])((?:[\w.-]+/)?references/[\w./-]*\w)")

# (skill, path) pairs that name a file outside this repo.
NOT_LOCAL = {
    # An example of a file inside a remotely retrieved skill.
    ("find-aws-skills", "references/architecture.md"),
    # Files inside the AWS MCP server's aws-cloudformation and aws-cdk skills.
    ("infra-validation", "references/validation-tool-selection.md"),
    ("infra-validation", "references/compliance-and-drift.md"),
    # Files inside the AWS MCP server's securing-s3-buckets and aws-iam skills.
    ("infra-validation", "references/audit-checklist.md"),
    ("infra-validation", "references/aws-iam-role-management.md"),
    ("policy-validation", "references/audit-checklist.md"),
    ("policy-validation", "references/aws-iam-role-management.md"),
    # Files inside the AWS MCP server's creating-secrets-using-best-practices and
    # setting-up-cloudtrail-multi-region skills.
    ("iam-policy-design", "references/create-secrets-using-best-practices.md"),
    ("iam-policy-design", "references/cloudtrail-multi-region-setup.md"),
    # A file inside the AWS MCP server's amazon-dynamodb skill.
    ("cost-estimation", "references/cost-model-schema.md"),
}


def _skill_files():
    for path in sorted([*SKILLS_DIR.glob("*/SKILL.md"), *SKILLS_DIR.glob("*/references/*.md")]):
        skill = path.relative_to(SKILLS_DIR).parts[0]
        yield skill, path


def _reference_paths():
    for skill, source in _skill_files():
        text = source.read_text(encoding="utf-8")
        for path in sorted(set(REFERENCE_RE.findall(text))):
            if (skill, path) not in NOT_LOCAL:
                yield source.relative_to(SKILLS_DIR).as_posix(), skill, path


def _resolve(skill, path):
    if path.startswith("references/"):
        return SKILLS_DIR / skill / path
    return SKILLS_DIR / path


REFERENCES = list(_reference_paths())


def test_reference_paths_are_found():
    assert REFERENCES, "no references/ paths found; the pattern is probably wrong"


@pytest.mark.parametrize("source,skill,path", REFERENCES, ids=[f"{s}:{p}" for s, _, p in REFERENCES])
def test_reference_path_exists(source, skill, path):
    assert _resolve(skill, path).is_file(), f"skills/{source} names {path}, which does not exist"


def test_reference_files_are_scanned():
    assert any("/references/" in source for source, _, _ in REFERENCES), "no references/*.md file was scanned"


def test_not_local_entries_are_still_named():
    for skill, path in NOT_LOCAL:
        text = (SKILLS_DIR / skill / "SKILL.md").read_text(encoding="utf-8")
        assert path in text, f"stale NOT_LOCAL entry: {skill} no longer names {path}"
