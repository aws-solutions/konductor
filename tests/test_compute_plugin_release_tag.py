# SPDX-License-Identifier: Apache-2.0
"""Regression tests for scripts/compute-plugin-release-tag.sh.

Covers tag-claude-plugin-release.yml's exact tagging guards: merged=true,
base ref == release/plugins, head ref under the real "plugin-candidate/"
prefix (never the dry-run prefix), and version format. Exit code 10 means
"this PR doesn't qualify, skip without error" -- distinct from exit code 1
(malformed input, a real failure) so the workflow can tell the two apart.

Run:  cd tests && pytest test_compute_plugin_release_tag.py -v
"""

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "compute-plugin-release-tag.sh"


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        capture_output=True,
        text=True,
    )


def test_qualifying_merge_prints_the_expected_tag():
    result = _run(
        "--merged", "true",
        "--base-ref", "release/plugins",
        "--head-ref", "plugin-candidate/v1.0.4-123-1",
        "--version", "1.0.4",
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "claude-plugin-v1.0.4"


def test_closed_without_merge_is_skipped_not_errored():
    result = _run(
        "--merged", "false",
        "--base-ref", "release/plugins",
        "--head-ref", "plugin-candidate/v1.0.4-123-1",
        "--version", "1.0.4",
    )
    assert result.returncode == 10
    assert "merged" in result.stderr


def test_wrong_base_branch_is_skipped_not_errored():
    result = _run(
        "--merged", "true",
        "--base-ref", "main",
        "--head-ref", "plugin-candidate/v1.0.4-123-1",
        "--version", "1.0.4",
    )
    assert result.returncode == 10
    assert "merge base" in result.stderr


def test_dry_run_candidate_prefix_never_qualifies():
    result = _run(
        "--merged", "true",
        "--base-ref", "release/plugins",
        "--head-ref", "plugin-candidate-dryrun/v1.0.4-123-1",
        "--version", "1.0.4",
    )
    assert result.returncode == 10
    assert "candidate prefix" in result.stderr


def test_unrelated_head_branch_never_qualifies():
    result = _run(
        "--merged", "true",
        "--base-ref", "release/plugins",
        "--head-ref", "some-unrelated-feature-branch",
        "--version", "1.0.4",
    )
    assert result.returncode == 10


def test_malformed_version_fails_closed_as_a_real_error():
    result = _run(
        "--merged", "true",
        "--base-ref", "release/plugins",
        "--head-ref", "plugin-candidate/v1.0.4-123-1",
        "--version", "v1.0.4",
    )
    assert result.returncode == 1
    assert "FATAL" in result.stderr


def test_custom_base_branch_and_prefix_are_honored():
    result = _run(
        "--merged", "true",
        "--base-ref", "custom/base",
        "--head-ref", "custom-prefix/v2.0.0-1-1",
        "--version", "2.0.0",
        "--base-branch", "custom/base",
        "--candidate-prefix", "custom-prefix",
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "claude-plugin-v2.0.0"


def test_missing_required_argument_fails_with_usage_error():
    result = _run("--merged", "true", "--base-ref", "release/plugins")
    assert result.returncode == 1
    assert "required" in result.stderr
