# SPDX-License-Identifier: Apache-2.0
"""Regression tests for .github/workflows/tag-claude-plugin-release.yml.

Covers the fix for the PR #28 defect flagged by review: the workflow
previously triggered on `pull_request: types: [closed], branches:
[release/plugins]`, but GitHub only runs a `pull_request`-triggered workflow
from a copy of the workflow file that exists on the PR's BASE branch. Since
release/plugins is artifact-only (no `.github/`, `VERSION`, or `scripts/`),
that trigger could never actually fire for a real merge.

This workflow is now a manually dispatched `workflow_dispatch` that exists
on `main` (the repository's default branch, where workflow_dispatch always
runs from) and takes a merged PR number as input, verified live via the
GitHub API rather than trusted from an event payload that never arrives.

These tests parse the workflow with PyYAML and assert on its structure --
they do not execute the workflow (that requires GitHub Actions itself) or
call the real GitHub API.

Covers:

1. The trigger is workflow_dispatch with a required pr_number input, not
   pull_request.closed.
2. No step's `run:` body contains a raw `${{ inputs.* }}` expression --
   the free-form pr_number input must be bound through env, not
   interpolated inline.
3. The pr_number input is validated as purely numeric before being used to
   build a `gh pr view` argument.
4. GH_TOKEN is not job-wide; it appears only on the steps that actually
   call `gh` or push a tag (not on checkout, artifact validation, or
   version parsing).
5. The job requires merged, base ref == release/plugins, head ref under
   the real "plugin-candidate/" prefix, and a nonempty merge commit SHA,
   failing closed on each.
6. The merge commit is checked out via `ref:`, and artifact presence
   (plugin.json, .mcp.json, README.md, LICENSE.txt, agents/, skills/) is
   validated before the version is parsed.
7. The version comes from .claude-plugin/plugin.json, not VERSION or any
   other source-only file, and is semver-validated via the shared
   scripts/validate-version-semver.sh.
8. The job never performs a branch write, a release, or an asset publish --
   only `git tag` (via scripts/compute-plugin-release-tag.sh's guards) and
   a tag push.
9. Dispatching this workflow against a non-main ref must fail closed
   before any checkout, PR API call, or helper-script read happens:
   workflow_dispatch always runs the copy of the workflow file on the
   default branch, but a specific run can still be pointed at any other
   branch or tag once the workflow has run once, and nothing else in this
   job re-checks that the ref it ends up reading scripts/compute-plugin-
   release-tag.sh and scripts/validate-version-semver.sh from is actually
   main.

Run:  cd tests && pytest test_tag_claude_plugin_release_workflow.py -v
"""

import re
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "tag-claude-plugin-release.yml"

# Matches any GitHub Actions expression, e.g. "${{ inputs.pr_number }}".
GHA_EXPRESSION_RE = re.compile(r"\$\{\{\s*(.*?)\s*\}\}")


def _load_doc():
    with WORKFLOW_PATH.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def _load_job():
    doc = _load_doc()
    # PyYAML 5.x/6.x resolve the bare YAML 1.1 key `on:` to the boolean
    # True, not the string "on" -- GitHub Actions documents `on:` as a
    # literal workflow key, so this is a parser quirk, not a workflow
    # error. Look it up by the boolean key rather than renaming anything
    # in the workflow file itself.
    assert True in doc, "workflow is missing an 'on:' trigger block"
    jobs = doc["jobs"]
    assert "tag-release" in jobs, "workflow is missing the 'tag-release' job"
    return jobs["tag-release"]


def _steps_by_name(job):
    return {step["name"]: step for step in job["steps"]}


def test_trigger_is_workflow_dispatch_with_required_pr_number_input():
    doc = _load_doc()
    trigger = doc[True]
    assert "workflow_dispatch" in trigger, (
        "the workflow must trigger on workflow_dispatch, not pull_request.closed -- "
        "a pull_request trigger on this file would never fire for a merge into "
        "release/plugins, since that branch carries no copy of this workflow"
    )
    assert "pull_request" not in trigger, (
        "the old pull_request.closed trigger must be fully removed, not left "
        "alongside workflow_dispatch"
    )
    inputs = trigger["workflow_dispatch"]["inputs"]
    assert "pr_number" in inputs
    assert inputs["pr_number"]["required"] is True
    assert inputs["pr_number"]["type"] == "string"


def test_job_only_runs_for_this_repository():
    job = _load_job()
    assert job.get("if") == "github.repository == 'aws-solutions/konductor'"


def test_main_ref_guard_exists_and_is_the_first_step():
    """The main-ref guard must be the very first step in the job.

    workflow_dispatch always runs the copy of the workflow file on the
    default branch, but a specific dispatched run can still target any
    other branch or tag -- so this guard, not the trigger definition
    alone, is what stops a non-main run from reaching the checkout that
    would read helper scripts from that other ref.
    """
    job = _load_job()
    steps = job["steps"]
    assert steps[0]["name"] == "Fail closed unless dispatched from main"


def test_main_ref_guard_runs_before_checkout_api_call_and_token_steps():
    job = _load_job()
    steps = job["steps"]
    guard_index = next(
        i for i, s in enumerate(steps) if s["name"] == "Fail closed unless dispatched from main"
    )
    for i, step in enumerate(steps):
        if i == guard_index:
            continue
        is_checkout = step.get("uses", "").startswith("actions/checkout")
        is_token_bound = (step.get("env") or {}).get("GH_TOKEN") == "${{ secrets.GITHUB_TOKEN }}"
        reads_pr_number = "inputs.pr_number" in (step.get("env") or {}).values()
        if is_checkout or is_token_bound or reads_pr_number:
            assert guard_index < i, (
                f"step '{step['name']}' (checkout/token-bound/PR-input step) "
                "must run after the main-ref guard"
            )


def test_main_ref_guard_binds_ref_context_through_env_not_inline():
    """The guard must bind github.ref/github.ref_name via `env:`, matching
    this workflow's own input-hardening convention for untrusted context
    values, rather than interpolating a raw `${{ ... }}` expression
    directly into the shell comparison.
    """
    job = _load_job()
    steps = _steps_by_name(job)
    guard_step = steps["Fail closed unless dispatched from main"]
    env = guard_step.get("env") or {}
    assert env.get("DISPATCH_REF") == "${{ github.ref }}"
    assert env.get("DISPATCH_REF_NAME") == "${{ github.ref_name }}"
    run_body = guard_step["run"]
    assert "$DISPATCH_REF" in run_body
    assert "$DISPATCH_REF_NAME" in run_body
    # No raw expression substitution inside the shell body itself.
    assert "github.ref" not in run_body


def test_main_ref_guard_rejects_any_ref_other_than_main():
    job = _load_job()
    steps = _steps_by_name(job)
    guard_step = steps["Fail closed unless dispatched from main"]
    run_body = guard_step["run"]
    assert '"$DISPATCH_REF" != "refs/heads/main"' in run_body
    assert '"$DISPATCH_REF_NAME" != "main"' in run_body
    assert "exit 1" in run_body
    assert "Failing closed" in run_body


def test_no_run_body_contains_a_raw_input_expression():
    """No `${{ inputs.* }}` expression may appear inside any `run:` body.

    The free-form workflow_dispatch pr_number input must be bound through
    a step's `env:` block and referenced in the shell as a quoted
    variable instead -- the same shell-injection concern
    plugin-publish-dry-run.yml's confirm_dry_run input guards against.
    """
    job = _load_job()
    offending_steps = []
    for step in job["steps"]:
        run_body = step.get("run")
        if not run_body:
            continue
        for match in GHA_EXPRESSION_RE.finditer(run_body):
            expression = match.group(1)
            if expression.startswith("inputs."):
                offending_steps.append((step.get("name"), expression))
    assert not offending_steps, (
        f"found raw 'inputs.*' expression(s) inside a run: body: {offending_steps}"
    )


def test_pr_number_is_validated_as_numeric_before_first_use():
    job = _load_job()
    steps = job["steps"]
    validate_index = next(
        i for i, s in enumerate(steps) if s["name"] == "Validate the pr_number input is purely numeric"
    )
    read_pr_index = next(
        i for i, s in enumerate(steps) if s["name"] == "Read the pull request's state, base, head, and merge commit"
    )
    assert validate_index < read_pr_index, (
        "pr_number must be validated before it is used to build a `gh pr view` argument"
    )
    validate_step = steps[validate_index]
    env = validate_step.get("env") or {}
    assert env.get("PR_NUMBER") == "${{ inputs.pr_number }}"
    run_body = validate_step["run"]
    assert "$PR_NUMBER" in run_body
    assert "inputs.pr_number" not in run_body


def test_gh_token_is_not_job_wide():
    job = _load_job()
    job_env = job.get("env") or {}
    assert "GH_TOKEN" not in job_env, (
        "GH_TOKEN must not be set at job level -- every step would inherit it, "
        "including the default-branch checkout, the merge-commit checkout, "
        "artifact validation, and version parsing, none of which call the "
        "GitHub API or push to the remote"
    )


def test_gh_token_is_scoped_to_only_the_steps_that_need_it():
    job = _load_job()
    steps = _steps_by_name(job)

    expected_token_steps = {
        "Read the pull request's state, base, head, and merge commit",
        "Confirm the tag does not already exist",
        "Create and push the immutable release tag",
    }
    actual_token_steps = {
        step["name"]
        for step in job["steps"]
        if (step.get("env") or {}).get("GH_TOKEN") == "${{ secrets.GITHUB_TOKEN }}"
    }
    assert actual_token_steps == expected_token_steps, (
        f"GH_TOKEN should be bound on exactly {expected_token_steps}, "
        f"found it on {actual_token_steps}"
    )

    # Spot-check that steps with no business calling the GitHub API or
    # writing to the remote never see the token, even transitively via a
    # broader env: block.
    no_token_step_names = [
        "Checkout the default branch (for VERSION-independent scripts)",
        "Validate the pr_number input is purely numeric",
        "Fail closed unless the PR is actually merged, with a merge commit",
        "Check out the merge commit on release/plugins",
        "Validate artifact presence at the merge commit",
        "Parse and validate the version from .claude-plugin/plugin.json",
        "Decide the tag name (re-confirms every guard against the real version)",
    ]
    for name in no_token_step_names:
        step = steps[name]
        env = step.get("env") or {}
        assert "GH_TOKEN" not in env, f"step '{name}' must not bind GH_TOKEN"


def test_permissions_are_minimal():
    job = _load_job()
    perms = job["permissions"]
    assert perms.get("contents") == "write"
    assert perms.get("pull-requests") == "read"
    # No broader scope (e.g. pull-requests: write, issues: write,
    # actions: write) should ever be granted here -- this job only reads
    # a PR and writes a tag.
    assert set(perms.keys()) == {"contents", "pull-requests"}


def test_merge_commit_checkout_uses_the_pr_output_ref():
    job = _load_job()
    steps = _steps_by_name(job)
    checkout_step = steps["Check out the merge commit on release/plugins"]
    assert checkout_step["with"]["ref"] == "${{ steps.pr.outputs.merge_sha }}"
    assert checkout_step["with"]["fetch-depth"] == 0


def test_merged_base_head_and_merge_sha_guards_fail_closed():
    job = _load_job()
    steps = _steps_by_name(job)
    guard_step = steps["Fail closed unless the PR is actually merged, with a merge commit"]
    run_body = guard_step["run"]
    assert 'PR_STATE" != "MERGED"' in run_body
    assert "exit 1" in run_body
    assert "merge commit SHA" in run_body

    decide_step = steps["Decide the tag name (re-confirms every guard against the real version)"]
    decide_run = decide_step["run"]
    assert "--merged true" in decide_run
    assert "--base-ref" in decide_run
    assert "--head-ref" in decide_run
    assert "compute-plugin-release-tag.sh" in decide_run


def test_artifact_presence_is_validated_before_version_parsing():
    job = _load_job()
    steps = job["steps"]
    artifact_index = next(
        i for i, s in enumerate(steps) if s["name"] == "Validate artifact presence at the merge commit"
    )
    version_index = next(
        i for i, s in enumerate(steps) if s["name"] == "Parse and validate the version from .claude-plugin/plugin.json"
    )
    assert artifact_index < version_index

    artifact_step = steps[artifact_index]
    run_body = artifact_step["run"]
    for expected in [
        ".claude-plugin/plugin.json",
        ".mcp.json",
        "README.md",
        "LICENSE.txt",
        '"agents"',
        '"skills"',
    ]:
        assert expected in run_body, f"artifact validation step must check for {expected}"


def test_version_is_parsed_from_plugin_json_not_version_file():
    job = _load_job()
    steps = _steps_by_name(job)
    version_step = steps["Parse and validate the version from .claude-plugin/plugin.json"]
    run_body = version_step["run"]
    assert ".claude-plugin/plugin.json" in run_body
    assert "validate-version-semver.sh" in run_body
    # The old VERSION-file-based read must be fully gone -- release/plugins
    # never carries a VERSION file.
    assert "cat VERSION" not in run_body


def test_no_branch_write_release_or_asset_publish_anywhere_in_the_job():
    job = _load_job()
    for step in job["steps"]:
        run_body = step.get("run") or ""
        # Strip full-line comments before checking for a real `--force`
        # flag -- the tag-push step's own comment explains in prose that
        # it does NOT force-push, which would otherwise false-positive
        # here.
        code_lines = [
            line for line in run_body.splitlines() if not line.strip().startswith("#")
        ]
        code_body = "\n".join(code_lines)
        assert "git push origin" not in code_body or "refs/tags/" in code_body, (
            f"step '{step['name']}' pushes something other than a tag ref"
        )
        assert "gh release create" not in code_body
        assert "gh release upload" not in code_body
        assert "--force" not in code_body
        assert "git branch" not in code_body
        assert "gh pr merge" not in code_body


def test_tag_existence_check_fails_closed_on_collision_or_infra_error():
    job = _load_job()
    steps = _steps_by_name(job)
    tag_check_step = steps["Confirm the tag does not already exist"]
    run_body = tag_check_step["run"]
    assert "ls-remote --exit-code --tags" in run_body
    assert "already exists" in run_body
    assert "Failing closed" in run_body


def test_tag_push_step_creates_an_annotated_tag_and_pushes_only_the_tag_ref():
    job = _load_job()
    steps = _steps_by_name(job)
    push_step = steps["Create and push the immutable release tag"]
    run_body = push_step["run"]
    code_lines = [line for line in run_body.splitlines() if not line.strip().startswith("#")]
    code_body = "\n".join(code_lines)
    assert "git tag -a" in code_body
    assert "refs/tags/" in code_body
    assert "--force" not in code_body
    assert ":refs/heads/" not in code_body
