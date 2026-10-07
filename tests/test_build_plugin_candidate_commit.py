# SPDX-License-Identifier: Apache-2.0
"""Regression tests for scripts/build-plugin-candidate-commit.sh.

Covers the fix for the PR #28 defect: a prior revision built the candidate
branch with `git init` in a fresh, throwaway directory, so it shared no
history with `release/plugins` (itself a copy of `main`) and `gh pr
create` had no common ancestor to diff against.

This script instead checks out the candidate branch directly on top of
`<remote>/<base-branch>`'s current tip, clears every previously tracked
path, and overlays an already-assembled flat artifact directory before
committing -- so the candidate always:

(a) shares a merge base with the base branch;
(b) contains only the artifact's own files, with no leftovers from the
    base branch's prior tree;
(c) is built with no push and no write to the base branch itself -- the
    script only ever runs `git fetch`/`git checkout -b`/`git commit`
    against a disposable local clone, never `git push`;
(d) is exercised identically by both release.yml's publish-claude-plugin
    job and plugin-publish-dry-run.yml's dry-run job, since both now call
    this one script instead of each inlining their own `git init`.

Run:  cd tests && pytest test_build_plugin_candidate_commit.py -v
"""

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "build-plugin-candidate-commit.sh"
WORKFLOW_RELEASE = REPO_ROOT / ".github" / "workflows" / "release.yml"
WORKFLOW_DRY_RUN = REPO_ROOT / ".github" / "workflows" / "plugin-publish-dry-run.yml"


def _git(*args: str, cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=check, capture_output=True, text=True
    )


@pytest.fixture
def remote(tmp_path):
    """A disposable bare repo standing in for the real GitHub remote, with
    `main` and `release/plugins` both pointing at the same initial commit
    -- release/plugins starts as a copy of main, as it does in the real
    repository (see generated/claude-plugin/README.md)."""
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)

    seed = tmp_path / "seed"
    seed.mkdir()
    _git("init", "-q", cwd=seed)
    _git("config", "user.email", "a@b.com", cwd=seed)
    _git("config", "user.name", "tester", cwd=seed)
    (seed / "README.md").write_text("# repo\n", encoding="utf-8")
    (seed / "app-source.py").write_text("print('not part of the plugin artifact')\n", encoding="utf-8")
    _git("add", "-A", cwd=seed)
    _git("commit", "-q", "-m", "init", cwd=seed)
    _git("push", "-q", str(bare), "HEAD:refs/heads/main", cwd=seed)
    _git("push", "-q", str(bare), "HEAD:refs/heads/release/plugins", cwd=seed)
    return bare


@pytest.fixture
def checkout(remote, tmp_path):
    """A fresh clone of `remote`, standing in for the checkout a workflow's
    `actions/checkout` step would produce. Starts on `main`, same as
    release.yml's publish-claude-plugin job after its own checkout."""
    work = tmp_path / "checkout"
    _git("clone", "-q", str(remote), str(work), cwd=tmp_path)
    _git("checkout", "-q", "main", cwd=work)
    _git("config", "user.email", "a@b.com", cwd=work)
    _git("config", "user.name", "tester", cwd=work)
    return work


@pytest.fixture
def assembled(tmp_path):
    """A synthetic flat plugin tree, standing in for
    scripts/assemble-claude-plugin-branch.sh's real --out directory."""
    out = tmp_path / "assembled"
    (out / "agents").mkdir(parents=True)
    (out / ".claude-plugin").mkdir()
    (out / "agents" / "k-architect.md").write_text("agent\n", encoding="utf-8")
    (out / ".claude-plugin" / "plugin.json").write_text('{"name": "konductor"}\n', encoding="utf-8")
    (out / "README.md").write_text("# plugin\n", encoding="utf-8")
    return out


def _run(checkout: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), "--repo-root", str(checkout), *args],
        capture_output=True,
        text=True,
    )


def test_candidate_shares_merge_base_with_release_plugins(checkout, assembled, remote):
    """(a) The candidate branch's history must connect to release/plugins
    -- the exact property missing from a `git init` candidate, which is
    why PR #28's `gh pr create` step had no common ancestor to diff
    against."""
    result = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "plugin-candidate/v1.0.0-1-1",
        "--assemble-dir", str(assembled),
        "--commit-message", "test candidate",
    )
    assert result.returncode == 0, result.stderr

    base_tip = _git("rev-parse", "origin/release/plugins", cwd=checkout).stdout.strip()
    merge_base = _git(
        "merge-base", "plugin-candidate/v1.0.0-1-1", "origin/release/plugins", cwd=checkout
    ).stdout.strip()
    assert merge_base == base_tip, (
        "candidate branch has no merge base with release/plugins' tip -- "
        "gh pr create would fail with 'No common ancestor'"
    )


def test_candidate_tree_contains_only_the_assembled_artifact(checkout, assembled, remote):
    """(b) The candidate's tree must be exactly the assembled artifact's
    contents -- no leftovers from release/plugins' own prior tree (e.g.
    README.md/app-source.py from the seed commit), so a merge of this
    candidate leaves release/plugins an artifact-only tree."""
    result = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "plugin-candidate/v1.0.0-1-1",
        "--assemble-dir", str(assembled),
        "--commit-message", "test candidate",
    )
    assert result.returncode == 0, result.stderr

    tracked = set(
        _git("ls-tree", "-r", "--name-only", "plugin-candidate/v1.0.0-1-1", cwd=checkout)
        .stdout.strip()
        .splitlines()
    )
    expected = {
        "agents/k-architect.md",
        ".claude-plugin/plugin.json",
        "README.md",
    }
    assert tracked == expected, (
        f"candidate tree does not match the assembled artifact exactly: "
        f"tracked={tracked}, expected={expected}"
    )
    # The base branch's own prior-tree file must specifically be gone --
    # the exact leftover this check guards against.
    assert "app-source.py" not in tracked


def test_script_never_pushes_or_writes_the_base_branch(checkout, assembled, remote):
    """(c) The script only builds a local commit; it must never push
    anything, and the base branch's own ref on the remote must be
    untouched by it. The caller (the workflow) does its own, separate
    `git push` of the candidate branch only, by name."""
    base_tip_before = _git("rev-parse", "release/plugins", cwd=remote).stdout.strip()

    result = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "plugin-candidate/v1.0.0-1-1",
        "--assemble-dir", str(assembled),
        "--commit-message", "test candidate",
    )
    assert result.returncode == 0, result.stderr

    # Nothing new reached the remote -- the script's own fetch is read-only,
    # and it never ran `git push`.
    remote_branches = _git("branch", cwd=remote).stdout
    assert "plugin-candidate" not in remote_branches

    base_tip_after = _git("rev-parse", "release/plugins", cwd=remote).stdout.strip()
    assert base_tip_after == base_tip_before


def test_dry_run_and_release_workflows_both_call_this_script(remote):
    """(d) Both the real publish job and the dry-run rehearsal must build
    their candidate commit through this one script, not through
    independent `git init` paths that could drift apart again."""
    release_text = WORKFLOW_RELEASE.read_text(encoding="utf-8")
    dry_run_text = WORKFLOW_DRY_RUN.read_text(encoding="utf-8")

    assert "scripts/build-plugin-candidate-commit.sh" in release_text
    assert "scripts/build-plugin-candidate-commit.sh" in dry_run_text
    assert "git init" not in release_text
    assert "git init" not in dry_run_text


def test_refuses_to_target_a_protected_ref_as_the_candidate(checkout, assembled, remote):
    """A protected-ref candidate name other than --base-branch itself (e.g.
    'main') must still be rejected by the defense-in-depth check -- the
    --candidate-branch == --base-branch case is covered separately below."""
    result = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "main",
        "--assemble-dir", str(assembled),
        "--commit-message", "test candidate",
    )
    assert result.returncode != 0
    assert "protected ref name" in result.stderr


def test_refuses_a_candidate_branch_equal_to_the_base_branch(checkout, assembled, remote):
    result = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "release/plugins",
        "--assemble-dir", str(assembled),
        "--commit-message", "test candidate",
    )
    assert result.returncode != 0
    assert "must not equal" in result.stderr


def test_refuses_an_already_existing_local_candidate_branch(checkout, assembled, remote):
    first = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "plugin-candidate/v1.0.0-1-1",
        "--assemble-dir", str(assembled),
        "--commit-message", "first",
    )
    assert first.returncode == 0, first.stderr

    _git("checkout", "-q", "main", cwd=checkout)
    second = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "plugin-candidate/v1.0.0-1-1",
        "--assemble-dir", str(assembled),
        "--commit-message", "second",
    )
    assert second.returncode != 0
    assert "already exists" in second.stderr


def test_identical_artifact_content_is_a_no_op(checkout, assembled, remote, tmp_path):
    """When release/plugins already contains exactly the assembled
    artifact's content (the state right after a previous candidate PR
    merged), building a new candidate from the same artifact must not
    fail or produce an empty commit -- it's a legitimate (if unlikely)
    outcome, not an error."""
    # Simulate the post-merge state: push the assembled artifact directly
    # onto release/plugins in a side clone, so the fixture's `checkout`
    # (and this test) never do that themselves -- the script and the real
    # workflows never write to the base branch, only this test setup does,
    # to construct the "already matches" precondition.
    merged_clone = tmp_path / "merged-clone"
    _git("clone", "-q", str(remote), str(merged_clone), cwd=tmp_path)
    _git("checkout", "-q", "release/plugins", cwd=merged_clone)
    _git("config", "user.email", "a@b.com", cwd=merged_clone)
    _git("config", "user.name", "tester", cwd=merged_clone)
    _git("rm", "-rq", ".", cwd=merged_clone)
    subprocess.run(["cp", "-a", f"{assembled}/.", str(merged_clone)], check=True)
    _git("add", "-A", cwd=merged_clone)
    _git("commit", "-q", "-m", "simulated merge", cwd=merged_clone)
    _git("push", "-q", "origin", "release/plugins", cwd=merged_clone)

    result = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "plugin-candidate/v1.0.0-1-1",
        "--assemble-dir", str(assembled),
        "--commit-message", "test candidate",
    )
    assert result.returncode == 0, result.stderr
    assert "nothing to commit" in result.stdout


def test_missing_assemble_dir_fails_closed(checkout, remote, tmp_path):
    result = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "plugin-candidate/v1.0.0-1-1",
        "--assemble-dir", str(tmp_path / "does-not-exist"),
        "--commit-message", "test",
    )
    assert result.returncode != 0
    assert "does not exist" in result.stderr


def test_missing_required_argument_fails_with_usage_error(checkout):
    result = _run(checkout, "--base-branch", "release/plugins")
    assert result.returncode != 0
    assert "required" in result.stderr
