# SPDX-License-Identifier: Apache-2.0
"""Regression tests for scripts/lib/protected-branches.sh.

derive-plugin-candidate-branch.sh, build-plugin-candidate-commit.sh, and
validate-plugin-publish-preconditions.sh each source this file and call
`is_protected_branch` instead of carrying their own copy of the protected
ref list. These tests pin the helper's own return-code contract directly;
the three callers' own tests (test_derive_plugin_candidate_branch.py,
test_build_plugin_candidate_commit.py, test_validate_plugin_publish_preconditions.py)
cover that each one still rejects a protected candidate branch end to end.

Run:  cd tests && pytest test_protected_branches_lib.py -v
"""

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
LIB = REPO_ROOT / "scripts" / "lib" / "protected-branches.sh"


def _is_protected(name: str) -> bool:
    result = subprocess.run(
        [
            "bash",
            "-c",
            f'source "{LIB}" && is_protected_branch "$1"',
            "is_protected_branch_test",
            name,
        ],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def test_lib_exists():
    assert LIB.is_file(), f"missing shared library: {LIB}"


@pytest.mark.parametrize("branch", ["main", "mainline", "release/plugins"])
def test_protected_branches_return_protected(branch):
    assert _is_protected(branch), f"expected '{branch}' to be protected"


@pytest.mark.parametrize(
    "branch",
    [
        "release/plugins-x",
        "mainx",
        "plugin-candidate/v1.0.0-1-1",
    ],
)
def test_near_misses_are_not_protected(branch):
    assert not _is_protected(branch), f"expected '{branch}' to NOT be protected"
