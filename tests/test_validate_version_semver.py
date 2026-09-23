# SPDX-License-Identifier: Apache-2.0
"""Regression tests for scripts/validate-version-semver.sh.

`grep -qE '^X$'` anchors `^`/`$` to LINE boundaries, not the whole input.
Since callers derive the version via `$(cat VERSION)` -- which strips only
the trailing newline, not embedded ones -- a multi-line value whose first
line is valid semver (e.g. "0.1.0\ngarbage") would satisfy the structural
grep check on its first line alone. The script guards against this with a
`case "$VERSION" in *[!0-9.]*)` glob before the structural check: any
character outside `[0-9.]`, including an embedded newline, fails closed.

Run:  cd tests && pytest test_validate_version_semver.py
"""

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "validate-version-semver.sh"


def run_validator(version: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(SCRIPT), version],
        capture_output=True,
        text=True,
    )


def test_script_exists():
    assert SCRIPT.is_file(), f"missing script: {SCRIPT}"


def test_valid_semver_accepted():
    result = run_validator("0.1.0")
    assert result.returncode == 0, result.stderr


def test_plain_garbage_rejected():
    result = run_validator("garbage")
    assert result.returncode == 1
    assert "not a valid semver" in result.stderr


def test_multiline_with_valid_first_line_rejected():
    """The regression this file exists to pin: a first line that is valid
    semver must not let a trailing garbage line slip through."""
    result = run_validator("0.1.0\ngarbage")
    assert result.returncode == 1, (
        "multi-line VERSION content with a valid first line was accepted "
        f"(stdout={result.stdout!r} stderr={result.stderr!r})"
    )
    assert "not a valid semver" in result.stderr


def test_multiline_all_valid_lines_still_rejected():
    """Embedded newlines are rejected even when every line looks like
    semver on its own -- the case guard has no notion of "valid lines",
    only "valid whole string"."""
    result = run_validator("0.1.0\n0.2.0")
    assert result.returncode == 1
    assert "not a valid semver" in result.stderr


def test_missing_argument_fails_closed():
    result = subprocess.run(
        ["bash", str(SCRIPT)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "requires a version string argument" in result.stderr
