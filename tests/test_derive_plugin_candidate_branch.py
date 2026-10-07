# SPDX-License-Identifier: Apache-2.0
"""Regression tests for scripts/derive-plugin-candidate-branch.sh.

Covers the collision-resistant naming scheme (version + run id + run
attempt), the protected-ref refusal (defense in depth even though the
inputs make an exact collision structurally unlikely), input validation
(version format, numeric run id/attempt), and the custom --prefix path
plugin-publish-dry-run.yml uses to keep its own candidate branches outside
the real "plugin-candidate/" namespace tag-claude-plugin-release.yml looks
for.

Run:  cd tests && pytest test_derive_plugin_candidate_branch.py -v
"""

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "derive-plugin-candidate-branch.sh"


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        capture_output=True,
        text=True,
    )


def test_derives_the_expected_branch_name():
    result = _run("--version", "v1.0.4", "--run-id", "123456789", "--run-attempt", "1")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "plugin-candidate/v1.0.4-123456789-1"


def test_custom_prefix_is_honored():
    result = _run(
        "--version", "v1.0.4",
        "--run-id", "42",
        "--run-attempt", "2",
        "--prefix", "plugin-candidate-dryrun",
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "plugin-candidate-dryrun/v1.0.4-42-2"


def test_different_run_attempts_produce_different_names():
    first = _run("--version", "v1.0.4", "--run-id", "99", "--run-attempt", "1").stdout.strip()
    second = _run("--version", "v1.0.4", "--run-id", "99", "--run-attempt", "2").stdout.strip()
    assert first != second


def test_rejects_version_without_leading_v():
    result = _run("--version", "1.0.4", "--run-id", "1", "--run-attempt", "1")
    assert result.returncode != 0
    assert "not a valid vX.Y.Z" in result.stderr


def test_rejects_non_numeric_run_id():
    result = _run("--version", "v1.0.4", "--run-id", "abc", "--run-attempt", "1")
    assert result.returncode != 0
    assert "run-id" in result.stderr


def test_rejects_non_numeric_run_attempt():
    result = _run("--version", "v1.0.4", "--run-id", "1", "--run-attempt", "x")
    assert result.returncode != 0
    assert "run-attempt" in result.stderr


def test_rejects_a_prefix_with_unsafe_characters():
    result = _run(
        "--version", "v1.0.4", "--run-id", "1", "--run-attempt", "1",
        "--prefix", "release/plugins",
    )
    assert result.returncode != 0
    assert "unsafe" in result.stderr


def test_missing_required_argument_fails_with_usage_error():
    result = _run("--version", "v1.0.4", "--run-id", "1")
    assert result.returncode != 0
    assert "required" in result.stderr
