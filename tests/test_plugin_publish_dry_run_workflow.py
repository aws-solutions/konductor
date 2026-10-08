# SPDX-License-Identifier: Apache-2.0
"""Regression tests for .github/workflows/plugin-publish-dry-run.yml's
hardening around the confirm_dry_run input, GH_TOKEN scope, and cleanup
reporting.

These tests parse the workflow with PyYAML and assert on its structure --
they do not execute the workflow (that requires GitHub Actions itself).

Covers:

1. No step's `run:` body contains a raw `${{ inputs.* }}` expression.
   Free-form workflow_dispatch input text substituted directly into a
   shell script body is a shell-injection vector: GitHub Actions expands
   `${{ }}` expressions into the script source before the shell ever runs
   it, so a value containing shell metacharacters executes as code
   instead of comparing as a string.
2. The confirmation guard step binds `inputs.confirm_dry_run` through its
   own `env:` block (not interpolated inline) and is still the first step
   in the job, so the workflow fails closed before any other step runs.
3. GH_TOKEN is not set at job level -- it appears only in the `env:` of
   the specific steps that call `gh` or a script requiring it.
4. The cleanup-identifiers step runs unconditionally (`if: always()`).
5. The cleanup-identifiers step's `run:` body references the candidate
   branch output independently of the PR step's outputs, so the
   candidate branch is reported even when PR creation never ran.

Run:  cd tests && pytest test_plugin_publish_dry_run_workflow.py -v
"""

import re
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "plugin-publish-dry-run.yml"

# Matches any GitHub Actions expression, e.g. "${{ inputs.confirm_dry_run }}".
GHA_EXPRESSION_RE = re.compile(r"\$\{\{\s*(.*?)\s*\}\}")


def _load_job():
    with WORKFLOW_PATH.open(encoding="utf-8") as f:
        doc = yaml.safe_load(f)
    # PyYAML 5.x/6.x resolve the bare YAML 1.1 key `on:` to the boolean
    # True, not the string "on" -- GitHub Actions documents `on:` as a
    # literal workflow key, so this is a parser quirk, not a workflow
    # error. Look it up by the boolean key rather than renaming anything
    # in the workflow file itself.
    assert True in doc, "workflow is missing an 'on:' trigger block"
    jobs = doc["jobs"]
    assert "dry-run" in jobs, "workflow is missing the 'dry-run' job"
    return jobs["dry-run"]


def _steps_by_name(job):
    return {step["name"]: step for step in job["steps"]}


def test_no_run_body_contains_a_raw_input_expression():
    """No `${{ inputs.* }}` expression may appear inside any `run:` body.

    A free-form workflow_dispatch string input substituted directly into
    shell source is a shell-injection vector. Any such input must be
    bound through a step's `env:` block and referenced in the shell as a
    quoted variable instead.
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


def test_confirmation_guard_is_bound_through_env_and_runs_first():
    job = _load_job()
    first_step = job["steps"][0]
    assert first_step["name"] == "Enforce the hard dry-run confirmation guard", (
        "the confirmation guard must be the first step so the workflow fails "
        "closed before any other step runs"
    )
    env = first_step.get("env") or {}
    assert env.get("CONFIRM_DRY_RUN") == "${{ inputs.confirm_dry_run }}", (
        "confirm_dry_run must be bound through this step's own env: block"
    )
    run_body = first_step["run"]
    assert "$CONFIRM_DRY_RUN" in run_body, (
        "the guard's shell script must compare against the env-bound "
        "$CONFIRM_DRY_RUN variable, not an inline expression"
    )
    assert "inputs.confirm_dry_run" not in run_body, (
        "the raw input expression must not appear in the script body itself"
    )


def test_gh_token_is_not_job_wide():
    job = _load_job()
    job_env = job.get("env") or {}
    assert "GH_TOKEN" not in job_env, (
        "GH_TOKEN must not be set at job level -- every step would inherit it, "
        "including checkout, toolchain setup, the build, npm install, and "
        "tree assembly, none of which call the GitHub API"
    )


def test_gh_token_is_scoped_to_only_the_steps_that_need_it():
    job = _load_job()
    steps = _steps_by_name(job)

    expected_token_steps = {
        "Validate publish preconditions (source ref, candidate collision)",
        "Open a draft pull request into release/plugins",
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

    # Spot-check that steps with no business calling the GitHub API never
    # see the token, even transitively via a broader env: block.
    no_token_step_names = [
        "Checkout",
        "Set up Rust toolchain",
        "Build the konductor CLI",
        "Assemble the flat Claude Code plugin tree",
        "Install claude CLI for validation",
    ]
    for name in no_token_step_names:
        step = steps[name]
        env = step.get("env") or {}
        assert "GH_TOKEN" not in env, f"step '{name}' must not bind GH_TOKEN"


def test_cleanup_report_runs_unconditionally():
    job = _load_job()
    steps = _steps_by_name(job)
    cleanup_step = steps["Report deterministic cleanup identifiers"]
    assert cleanup_step.get("if") == "always()", (
        "the cleanup-identifiers step must run with if: always() so it still "
        "reports on a partial failure"
    )


def test_cleanup_report_prints_candidate_branch_independently_of_pr_outputs():
    job = _load_job()
    steps = _steps_by_name(job)
    cleanup_step = steps["Report deterministic cleanup identifiers"]
    env = cleanup_step.get("env") or {}
    assert env.get("CANDIDATE_BRANCH") == "${{ steps.candidate.outputs.candidate_branch }}", (
        "the cleanup step must bind the candidate branch output independently "
        "of the PR step's outputs"
    )
    run_body = cleanup_step["run"]
    assert "$CANDIDATE_BRANCH" in run_body
    # The candidate branch must be printed on its own branch of the script's
    # conditional logic, not only alongside the PR number -- otherwise a run
    # that pushed a branch but never created a PR would print nothing useful.
    assert 'if [ -n "$CANDIDATE_BRANCH" ]' in run_body
    assert 'if [ -n "$PR_NUMBER" ]' in run_body


def test_cleanup_report_does_not_call_the_github_api():
    """The cleanup step only echoes instructions for a human/script to run
    later -- it must not itself hold GH_TOKEN, since always() means it also
    runs on forks/unauthorized contexts where the job's own `if:` guard
    already gates everything upstream, but defense in depth costs nothing
    here."""
    job = _load_job()
    steps = _steps_by_name(job)
    cleanup_step = steps["Report deterministic cleanup identifiers"]
    env = cleanup_step.get("env") or {}
    assert "GH_TOKEN" not in env


def test_workflow_still_refuses_main_and_mainline_as_base_branch():
    """Guards against regressing an existing safety property while editing
    this workflow for the hardening above."""
    job = _load_job()
    steps = _steps_by_name(job)
    guard_step = steps["Refuse to target main/mainline"]
    run_body = guard_step["run"]
    assert "main|mainline" in run_body


def test_workflow_still_uses_the_dryrun_candidate_branch_prefix():
    """Guards against regressing the dry-run-specific candidate branch
    prefix (--prefix "plugin-candidate-dryrun"), which keeps dry-run
    branches out of tag-claude-plugin-release.yml's real
    "plugin-candidate/" tagging path."""
    job = _load_job()
    steps = _steps_by_name(job)
    derive_step = steps["Derive the dry-run candidate branch name"]
    run_body = derive_step["run"]
    assert '--prefix "plugin-candidate-dryrun"' in run_body


def test_workflow_still_opens_draft_pr_into_release_plugins():
    """Guards against regressing the draft-only, release/plugins-targeted
    PR creation while editing the step for GH_TOKEN scoping."""
    job = _load_job()
    steps = _steps_by_name(job)
    pr_step = steps["Open a draft pull request into release/plugins"]
    run_body = pr_step["run"]
    assert "--base \"$BASE_BRANCH\"" in run_body
    assert "--draft" in run_body
    job_env = job.get("env") or {}
    assert job_env.get("BASE_BRANCH") == "release/plugins"
