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
(d) is called by release.yml's publish-claude-plugin job instead of that
    job inlining its own `git init`.

Run:  cd tests && pytest test_build_plugin_candidate_commit.py -v
"""

import os
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "build-plugin-candidate-commit.sh"
WORKFLOW_RELEASE = REPO_ROOT / ".github" / "workflows" / "release.yml"


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


def _run(
    checkout: Path, *args: str, github_output: Path | None = None
) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    if github_output is not None:
        env["GITHUB_OUTPUT"] = str(github_output)
    else:
        # The real `GITHUB_OUTPUT` is only ever set inside a GitHub Actions
        # runner -- strip any leftover value so a test run outside that
        # env still exercises the "no GITHUB_OUTPUT set" path.
        env.pop("GITHUB_OUTPUT", None)
    return subprocess.run(
        ["bash", str(SCRIPT), "--repo-root", str(checkout), *args],
        capture_output=True,
        text=True,
        env=env,
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


def test_release_workflow_calls_this_script(remote):
    """(d) The real publish job must build its candidate commit through
    this one script, not through its own independent `git init` path."""
    release_text = WORKFLOW_RELEASE.read_text(encoding="utf-8")

    assert "scripts/build-plugin-candidate-commit.sh" in release_text
    assert "git init" not in release_text


def _load_publish_claude_plugin_job():
    with WORKFLOW_RELEASE.open(encoding="utf-8") as f:
        doc = yaml.safe_load(f)
    return doc["jobs"]["publish-claude-plugin"]


def _steps_by_name(job):
    return {step["name"]: step for step in job["steps"]}


def test_build_candidate_commit_step_exposes_a_committed_output_id():
    """F1: release.yml must read the script's `committed` output through a
    step id -- without one, `steps.<id>.outputs.committed` has nothing to
    resolve against and the push/draft-PR gates below are unreachable."""
    job = _load_publish_claude_plugin_job()
    steps = _steps_by_name(job)
    build_step = steps["Build the candidate commit on top of release/plugins' tip"]
    assert build_step.get("id"), (
        "the step running build-plugin-candidate-commit.sh must have an 'id' "
        "so later steps can read steps.<id>.outputs.committed"
    )


def test_push_and_pr_steps_are_gated_on_the_committed_output():
    """F1: the fix for PR #28's defect -- `gh pr create` failing with 'No
    commits between' and leaving a dangling pushed branch whenever the
    assembled tree already matches release/plugins' tip exactly. Both the
    push and the draft-PR step must only run when the candidate-commit step
    actually built a commit."""
    job = _load_publish_claude_plugin_job()
    steps = _steps_by_name(job)
    build_step = steps["Build the candidate commit on top of release/plugins' tip"]
    build_id = build_step["id"]
    expected_if = f"steps.{build_id}.outputs.committed == 'true'"

    push_step = steps["Push the candidate branch"]
    assert push_step.get("if") == expected_if

    pr_step = steps["Open a draft pull request into release/plugins"]
    assert pr_step.get("if") == expected_if


def test_job_reports_and_ends_green_when_there_is_nothing_to_publish():
    """F1: when build-plugin-candidate-commit.sh reports committed=false,
    the job must print a clear notice instead of silently skipping two
    steps with no explanation -- and must not fail (a no-op release is a
    legitimate outcome, not an error)."""
    job = _load_publish_claude_plugin_job()
    steps = job["steps"]
    build_index = next(
        i
        for i, s in enumerate(steps)
        if s["name"] == "Build the candidate commit on top of release/plugins' tip"
    )
    build_id = steps[build_index]["id"]
    no_op_steps = [
        s
        for i, s in enumerate(steps)
        if i > build_index
        and s.get("if") == f"steps.{build_id}.outputs.committed != 'true'"
    ]
    assert no_op_steps, (
        "expected a step gated on committed != 'true' that reports there is "
        "nothing new to publish, so the job ends green with a clear notice "
        "instead of silently skipping the push/draft-PR steps"
    )
    for step in no_op_steps:
        assert "exit 1" not in (step.get("run") or ""), (
            f"step '{step['name']}' must not fail the job on the no-op path"
        )


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
    # F1 fix: release.yml's publish step must be able to tell a no-op build
    # apart from a real commit without parsing prose -- the no-op case
    # prints this machine-readable line even when GITHUB_OUTPUT isn't set
    # (e.g. a developer running the script locally).
    assert "committed=false" in result.stdout


def test_commit_writes_committed_true_to_github_output(checkout, assembled, remote, tmp_path):
    """F1: when the script builds a real commit, it must report
    committed=true through $GITHUB_OUTPUT so release.yml's publish-
    claude-plugin job can gate its push/draft-PR steps on it -- the fix
    for PR #28's defect where those steps ran unconditionally even when
    build-plugin-candidate-commit.sh had nothing to commit."""
    github_output = tmp_path / "github_output.txt"
    github_output.write_text("", encoding="utf-8")
    result = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "plugin-candidate/v1.0.0-1-1",
        "--assemble-dir", str(assembled),
        "--commit-message", "test candidate",
        github_output=github_output,
    )
    assert result.returncode == 0, result.stderr
    assert "committed=true" in github_output.read_text(encoding="utf-8")
    assert "committed=true" in result.stdout


def test_no_op_writes_committed_false_to_github_output(checkout, assembled, remote, tmp_path):
    """F1: the no-op case (release/plugins already matches the assembled
    artifact exactly) must report committed=false through $GITHUB_OUTPUT,
    not just in prose on stdout, so the workflow's `if:` gate on the push
    and draft-PR steps actually works."""
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

    github_output = tmp_path / "github_output.txt"
    github_output.write_text("", encoding="utf-8")
    result = _run(
        checkout,
        "--base-branch", "release/plugins",
        "--candidate-branch", "plugin-candidate/v1.0.0-1-1",
        "--assemble-dir", str(assembled),
        "--commit-message", "test candidate",
        github_output=github_output,
    )
    assert result.returncode == 0, result.stderr
    assert "committed=false" in github_output.read_text(encoding="utf-8")
    assert "committed=true" not in github_output.read_text(encoding="utf-8")


def test_untracked_build_junk_in_checkout_never_reaches_the_candidate(
    checkout, assembled, remote, tmp_path
):
    """Regression test for the v1.1.0 candidate PR #56 defect: the script
    used to run `git rm -rq .` + `cp -a "$ASSEMBLE_DIR"/. .` + `git add -A`
    directly in the job's own checkout -- the same checkout `make -C cli
    build` and scripts/generate-claude-plugin.sh already ran in. `git rm
    -rq .` deletes the checked-out .gitignore along with everything else
    tracked, so `git add -A` then picks up whatever untracked build
    output is sitting there (cli/konductor-rs/target/, build/cli/
    konductor, dist/, generated/claude-plugin/), with no .gitignore left
    to exclude it.

    This reproduces that precisely: release/plugins tracks a .gitignore
    that would exclude these paths if it survived, and the checkout has
    the same untracked junk a real job leaves behind. The fix builds the
    candidate's tree directly from --assemble-dir and never reads the
    checkout's working directory at all, so the junk can never reach the
    candidate commit regardless of what happens to .gitignore."""
    base_with_gitignore = tmp_path / "base-with-gitignore"
    _git("clone", "-q", str(remote), str(base_with_gitignore), cwd=tmp_path)
    _git("checkout", "-q", "release/plugins", cwd=base_with_gitignore)
    _git("config", "user.email", "a@b.com", cwd=base_with_gitignore)
    _git("config", "user.name", "tester", cwd=base_with_gitignore)
    (base_with_gitignore / ".gitignore").write_text(
        "cli/konductor-rs/target/\nbuild/\ndist/\ngenerated/claude-plugin/\n",
        encoding="utf-8",
    )
    _git("add", "-A", cwd=base_with_gitignore)
    _git("commit", "-q", "-m", "track a .gitignore on release/plugins", cwd=base_with_gitignore)
    _git("push", "-q", "origin", "release/plugins", cwd=base_with_gitignore)

    junk_paths = [
        checkout / "cli" / "konductor-rs" / "target" / "x",
        checkout / "build" / "cli" / "konductor",
        checkout / "dist" / "x",
        checkout / "generated" / "claude-plugin" / "x",
    ]
    for junk in junk_paths:
        junk.parent.mkdir(parents=True, exist_ok=True)
        junk.write_text("leftover build output\n", encoding="utf-8")

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
        f"candidate tree picked up untracked build junk from the checkout: "
        f"tracked={tracked}, expected={expected}"
    )
    for junk in ("cli/konductor-rs/target/x", "build/cli/konductor", "dist/x", "generated/claude-plugin/x"):
        assert junk not in tracked


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
