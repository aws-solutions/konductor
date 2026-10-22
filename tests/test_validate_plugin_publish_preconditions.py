# SPDX-License-Identifier: Apache-2.0
"""Regression tests for scripts/validate-plugin-publish-preconditions.sh.

Exercises all four fail-closed gates the script runs before
release.yml's publish-claude-plugin job pushes a candidate branch:

1. The checked-out commit must match --expected-ref (by SHA, since
   release.yml checks out a release tag -- detached HEAD, no branch name).
2. The candidate branch must not equal a protected ref name.
3. The candidate branch must not already exist on the remote.
4. The release tag must not already exist on the remote.

Checks 3 and 4 are tested against a disposable local bare repo via
--remote-url, so these tests never touch the real GitHub remote. The
script's `ls-remote --exit-code` branch handling (0 = collision, 2 = clear,
anything else = infra error, fails closed) is covered by pointing
--remote-url at a path that is not a git repo at all, which reproduces the
same nonzero/non-2 exit git produces against an unreachable network host.

Run:  cd tests && pytest test_validate_plugin_publish_preconditions.py -v
"""

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "validate-plugin-publish-preconditions.sh"


@pytest.fixture
def git_checkout(tmp_path):
    """A real git checkout with one commit, used as the script's cwd so
    `git rev-parse` calls inside it resolve against this fixture's history,
    not this test file's own repo."""
    checkout = tmp_path / "checkout"
    checkout.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=checkout, check=True)
    subprocess.run(["git", "config", "user.email", "a@b.com"], cwd=checkout, check=True)
    subprocess.run(["git", "config", "user.name", "tester"], cwd=checkout, check=True)
    (checkout / "f.txt").write_text("x\n", encoding="utf-8")
    subprocess.run(["git", "add", "f.txt"], cwd=checkout, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=checkout, check=True)
    return checkout


@pytest.fixture
def bare_remote(tmp_path):
    """A disposable bare repo this test suite fully controls, so collision
    checks can be exercised deterministically without touching the real
    GitHub remote."""
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
    return remote


def _run(checkout: Path, *args: str, env: dict | None = None) -> subprocess.CompletedProcess[str]:
    import os

    full_env = dict(os.environ)
    full_env["GH_TOKEN"] = "dummy-token-not-a-real-credential"
    if env:
        full_env.update(env)
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        cwd=checkout,
        env=full_env,
        capture_output=True,
        text=True,
    )


def test_happy_path_passes_all_four_checks(git_checkout, bare_remote):
    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=git_checkout, check=True, capture_output=True, text=True
    ).stdout.strip()

    result = _run(
        git_checkout,
        "--repo", "x/y",
        "--expected-ref", head_sha,
        "--candidate-branch", "plugin-candidate/v1.0.4-1-1",
        "--tag", "claude-plugin-v1.0.4",
        "--remote-url", str(bare_remote),
    )
    assert result.returncode == 0, result.stderr
    assert "All plugin-publish preconditions passed" in result.stdout


def test_expected_ref_mismatch_fails_closed(git_checkout, bare_remote):
    subprocess.run(["git", "branch", "other"], cwd=git_checkout, check=True)
    (git_checkout / "g.txt").write_text("y\n", encoding="utf-8")
    subprocess.run(["git", "add", "g.txt"], cwd=git_checkout, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "second"], cwd=git_checkout, check=True)

    result = _run(
        git_checkout,
        "--repo", "x/y",
        "--expected-ref", "other",
        "--candidate-branch", "plugin-candidate/v1.0.4-1-1",
        "--tag", "claude-plugin-v1.0.4",
        "--remote-url", str(bare_remote),
    )
    assert result.returncode != 0
    assert "does not match expected ref" in result.stderr


def test_unresolvable_expected_ref_fails_closed(git_checkout, bare_remote):
    result = _run(
        git_checkout,
        "--repo", "x/y",
        "--expected-ref", "totally-bogus-ref-xyz",
        "--candidate-branch", "plugin-candidate/v1.0.4-1-1",
        "--tag", "claude-plugin-v1.0.4",
        "--remote-url", str(bare_remote),
    )
    assert result.returncode != 0
    assert "does not resolve" in result.stderr


@pytest.mark.parametrize("protected", ["main", "mainline", "release/plugins"])
def test_protected_candidate_branch_name_is_rejected(git_checkout, bare_remote, protected):
    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=git_checkout, check=True, capture_output=True, text=True
    ).stdout.strip()
    result = _run(
        git_checkout,
        "--repo", "x/y",
        "--expected-ref", head_sha,
        "--candidate-branch", protected,
        "--tag", "claude-plugin-v1.0.4",
        "--remote-url", str(bare_remote),
    )
    assert result.returncode != 0
    assert "protected ref name" in result.stderr


def test_invalid_candidate_branch_ref_name_is_rejected(git_checkout, bare_remote):
    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=git_checkout, check=True, capture_output=True, text=True
    ).stdout.strip()
    result = _run(
        git_checkout,
        "--repo", "x/y",
        "--expected-ref", head_sha,
        "--candidate-branch", "..invalid..",
        "--tag", "claude-plugin-v1.0.4",
        "--remote-url", str(bare_remote),
    )
    assert result.returncode != 0
    assert "not a valid git ref name" in result.stderr


def test_existing_candidate_branch_collision_is_rejected(git_checkout, bare_remote):
    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=git_checkout, check=True, capture_output=True, text=True
    ).stdout.strip()
    # Pre-create the candidate branch on the remote to force a real collision.
    subprocess.run(
        ["git", "push", str(bare_remote), "HEAD:refs/heads/plugin-candidate/v1.0.4-1-1"],
        cwd=git_checkout,
        check=True,
        capture_output=True,
    )
    result = _run(
        git_checkout,
        "--repo", "x/y",
        "--expected-ref", head_sha,
        "--candidate-branch", "plugin-candidate/v1.0.4-1-1",
        "--tag", "claude-plugin-v1.0.4",
        "--remote-url", str(bare_remote),
    )
    assert result.returncode != 0
    assert "already exists on the remote" in result.stderr


def test_existing_tag_collision_is_rejected(git_checkout, bare_remote):
    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=git_checkout, check=True, capture_output=True, text=True
    ).stdout.strip()
    subprocess.run(
        ["git", "tag", "-a", "claude-plugin-v1.0.4", "-m", "t"], cwd=git_checkout, check=True
    )
    subprocess.run(
        ["git", "push", str(bare_remote), "refs/tags/claude-plugin-v1.0.4"],
        cwd=git_checkout,
        check=True,
        capture_output=True,
    )
    result = _run(
        git_checkout,
        "--repo", "x/y",
        "--expected-ref", head_sha,
        "--candidate-branch", "plugin-candidate/v1.0.4-2-1",
        "--tag", "claude-plugin-v1.0.4",
        "--remote-url", str(bare_remote),
    )
    assert result.returncode != 0
    assert "tag" in result.stderr
    assert "already exists" in result.stderr


def test_unreachable_remote_fails_closed_not_open(git_checkout, tmp_path):
    """A nonexistent local path makes `git ls-remote` fail the same way an
    unreachable network host would (nonzero, non-2 exit) -- the script must
    treat that as a blocking error, not as 'no collision found'."""
    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=git_checkout, check=True, capture_output=True, text=True
    ).stdout.strip()
    unreachable = tmp_path / "does-not-exist.git"
    result = _run(
        git_checkout,
        "--repo", "x/y",
        "--expected-ref", head_sha,
        "--candidate-branch", "plugin-candidate/v1.0.4-1-1",
        "--tag", "claude-plugin-v1.0.4",
        "--remote-url", str(unreachable),
    )
    assert result.returncode != 0
    assert "Failing closed" in result.stderr


def test_missing_gh_token_fails_closed(git_checkout, bare_remote):
    import os

    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=git_checkout, check=True, capture_output=True, text=True
    ).stdout.strip()
    env = dict(os.environ)
    env.pop("GH_TOKEN", None)
    result = subprocess.run(
        [
            "bash", str(SCRIPT),
            "--repo", "x/y",
            "--expected-ref", head_sha,
            "--candidate-branch", "plugin-candidate/v1.0.4-1-1",
            "--tag", "claude-plugin-v1.0.4",
            "--remote-url", str(bare_remote),
        ],
        cwd=git_checkout,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "GH_TOKEN is not set" in result.stderr


def test_missing_required_argument_fails_with_usage_error(git_checkout):
    result = _run(git_checkout, "--repo", "x/y")
    assert result.returncode != 0
    assert "required" in result.stderr
