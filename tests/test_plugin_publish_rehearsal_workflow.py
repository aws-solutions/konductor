# SPDX-License-Identifier: Apache-2.0
"""Static checks for .github/workflows/plugin-publish-rehearsal-dry-run.yml.

This workflow is a stopgap: it rehearses the plugin candidate publish path
(push a throwaway branch, open a draft PR into release/plugins) from main,
before the pull request that introduces the real plugin-publish-dry-run.yml
merges. These tests pin down the safety properties that make it acceptable
to register on main at all:

1. The hard typed-confirmation gate is present and required, and the input
   it compares is bound through a step-level env: mapping, never spliced
   directly into shell as a raw `${{ inputs.* }}` substitution.
2. The source ref is a single fixed commit SHA, with no dispatch input that
   could let a caller choose a different ref, branch, or target, and a
   live check confirms that SHA still matches PR #28's actual current head
   before anything is checked out.
3. Workflow permissions are minimal (contents/pull-requests write, nothing
   broader) and scoped to the one job that needs them. GH_TOKEN itself is
   bound only on the specific steps that call `gh`, never at job or
   workflow level.
4. The workflow never contains a tag-push, release-create, merge, or
   direct-push-to-release/plugins command.
5. The draft PR step always targets release/plugins and always passes
   --draft.
6. The cleanup-identifiers step always runs (even on partial failure) and
   reports whatever remote state actually exists, without ever echoing a
   token.

Run:  cd tests && pytest test_plugin_publish_rehearsal_workflow.py -v
"""

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_PATH = (
    REPO_ROOT / ".github" / "workflows" / "plugin-publish-rehearsal-dry-run.yml"
)


def _load_workflow() -> dict:
    with WORKFLOW_PATH.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def _workflow_text() -> str:
    return WORKFLOW_PATH.read_text(encoding="utf-8")


def test_workflow_file_exists():
    assert WORKFLOW_PATH.is_file(), f"missing workflow: {WORKFLOW_PATH}"


def test_dispatch_trigger_has_no_ref_or_branch_input():
    """The only way this workflow could rehearse an arbitrary ref is a
    dispatch input naming one. Pin down that no such input exists -- the
    trigger must only accept a bare `workflow_dispatch` with the typed
    confirmation input below."""
    doc = _load_workflow()
    # yaml.safe_load parses the bare `on` key as the Python bool True.
    trigger = doc[True]
    assert set(trigger.keys()) == {"workflow_dispatch"}
    inputs = trigger["workflow_dispatch"]["inputs"]
    assert set(inputs.keys()) == {"confirm_dry_run"}
    for forbidden in ("ref", "branch", "source_ref", "target", "base_branch"):
        assert forbidden not in inputs, (
            f"found a '{forbidden}' dispatch input -- this would let a "
            "caller override the fixed source ref or target"
        )


def test_confirmation_input_is_required_string():
    doc = _load_workflow()
    confirm_input = doc[True]["workflow_dispatch"]["inputs"]["confirm_dry_run"]
    assert confirm_input["required"] is True
    assert confirm_input["type"] == "string"


def test_hard_confirmation_guard_is_the_first_step():
    """The exact-match guard must run before any other step -- in
    particular before checkout, so a wrong/missing confirmation value can
    never reach a step that touches the repository or the network."""
    doc = _load_workflow()
    steps = doc["jobs"]["dry-run"]["steps"]
    first_step_run = steps[0].get("run", "")
    assert "DRY_RUN_CONFIRMED" in first_step_run
    assert "exit 1" in first_step_run


def test_confirmation_guard_binds_input_through_step_env_not_raw_interpolation():
    """A raw `${{ inputs.confirm_dry_run }}` substitution inside a run:
    body is text-substituted into the script source before the shell ever
    parses it -- a value containing `"` or `$(...)` could break out of the
    comparison and execute as shell. The guard must instead bind the input
    through a step-level env: mapping and compare a quoted shell variable,
    so the value is always read as data."""
    doc = _load_workflow()
    steps = doc["jobs"]["dry-run"]["steps"]
    guard_step = steps[0]
    env = guard_step.get("env", {})
    assert any("inputs.confirm_dry_run" in str(v) for v in env.values()), (
        "confirm_dry_run must be bound via the guard step's env: mapping"
    )
    run_body = guard_step["run"]
    # The run body must compare a shell variable, never the raw expression.
    assert "${{ inputs.confirm_dry_run }}" not in run_body
    assert '"$CONFIRM_DRY_RUN"' in run_body


def test_source_ref_is_pinned_to_a_single_full_commit_sha():
    """FIXED_SOURCE_REF must be a 40-character hex commit SHA (not a
    branch name, tag, or dispatch input), and it must be the one value
    used everywhere the workflow checks out or validates against it."""
    doc = _load_workflow()
    env = doc["jobs"]["dry-run"]["env"]
    fixed_ref = env["FIXED_SOURCE_REF"]
    assert len(fixed_ref) == 40
    assert all(c in "0123456789abcdef" for c in fixed_ref)

    text = _workflow_text()
    # The checkout step's `ref:` must reference this same env var, never a
    # literal branch name or a dispatch input.
    assert "ref: ${{ env.FIXED_SOURCE_REF }}" in text
    assert "ref: ${{ inputs." not in text
    assert "ref: ${{ github.event.inputs." not in text


def test_pinned_sha_matches_current_known_pr28_head():
    """Regression guard for the specific stale-pin bug this workflow was
    fixed for: FIXED_SOURCE_REF must track PR #28's hardened head commit,
    not an earlier commit on that branch."""
    doc = _load_workflow()
    env = doc["jobs"]["dry-run"]["env"]
    assert env["FIXED_SOURCE_REF"] == "84404aff69e7a1a8915297d9531438a6b41c631e"


def test_live_source_head_drift_check_runs_before_checkout():
    """A step must call `gh pr view 28` to compare PR #28's actual current
    head against FIXED_SOURCE_REF, and it must run before the checkout
    step -- a stale pin has to stop the run before anything is fetched."""
    doc = _load_workflow()
    steps = doc["jobs"]["dry-run"]["steps"]
    checkout_index = next(
        i for i, s in enumerate(steps) if s.get("uses", "").startswith("actions/checkout")
    )
    drift_check_indices = [
        i for i, s in enumerate(steps) if "gh pr view 28" in s.get("run", "")
    ]
    assert len(drift_check_indices) == 1, "expected exactly one live PR #28 head check"
    assert drift_check_indices[0] < checkout_index, (
        "the drift check must run before checkout, not after"
    )
    drift_step = steps[drift_check_indices[0]]
    run_body = drift_step["run"]
    assert "headRefOid" in run_body
    assert "FIXED_SOURCE_REF" in run_body
    assert "exit 1" in run_body


def test_workflow_only_runs_from_main():
    doc = _load_workflow()
    job = doc["jobs"]["dry-run"]
    assert "github.ref == 'refs/heads/main'" in job["if"]


def test_refuses_main_mainline_as_base_branch():
    doc = _load_workflow()
    steps = doc["jobs"]["dry-run"]["steps"]
    refusal_steps = [s for s in steps if s.get("name") == "Refuse to target main/mainline"]
    assert len(refusal_steps) == 1
    run_body = refusal_steps[0]["run"]
    assert "main|mainline" in run_body
    assert "exit 1" in run_body


def test_base_branch_is_always_release_plugins():
    doc = _load_workflow()
    env = doc["jobs"]["dry-run"]["env"]
    assert env["BASE_BRANCH"] == "release/plugins"


def test_draft_pr_step_targets_release_plugins_and_sets_draft_flag():
    doc = _load_workflow()
    steps = doc["jobs"]["dry-run"]["steps"]
    pr_steps = [s for s in steps if s.get("id") == "pr"]
    assert len(pr_steps) == 1
    run_body = pr_steps[0]["run"]
    assert '--base "$BASE_BRANCH"' in run_body
    assert "--draft" in run_body


def test_candidate_branch_uses_dryrun_prefix_not_the_real_one():
    """The real `plugin-candidate/` prefix is what
    compute-plugin-release-tag.sh looks for before tagging a merge. This
    rehearsal must use a visibly distinct prefix so an accidental merge of
    its draft PR can never produce a real claude-plugin-vX.Y.Z tag."""
    text = _workflow_text()
    assert '--prefix "plugin-candidate-dryrun"' in text
    assert '--prefix "plugin-candidate"' not in text


def test_workflow_level_permissions_are_read_only():
    doc = _load_workflow()
    assert doc["permissions"] == {"contents": "read"}


def test_job_permissions_are_minimal_and_scoped_to_the_dry_run_job():
    doc = _load_workflow()
    job = doc["jobs"]["dry-run"]
    assert job["permissions"] == {"contents": "write", "pull-requests": "write"}
    # No broader scopes anywhere in the file.
    forbidden_scopes = ("id-token", "actions", "packages", "deployments", "security-events")
    text = _workflow_text()
    for scope in forbidden_scopes:
        assert f"{scope}:" not in text, f"found forbidden permission scope '{scope}'"


def test_gh_token_is_not_job_or_workflow_wide():
    """GH_TOKEN must never appear in the job's own `env:` block or at
    workflow level -- only on the individual steps that call `gh`.
    A job-wide token would be implicitly readable by every step, including
    checkout, the Rust build, npm install, and plugin assembly, none of
    which need it."""
    doc = _load_workflow()
    job = doc["jobs"]["dry-run"]
    job_env = job.get("env", {})
    assert "GH_TOKEN" not in job_env, "GH_TOKEN must not be set at job level"
    assert "GH_TOKEN" not in doc.get("env", {}), "GH_TOKEN must not be set at workflow level"


def test_gh_token_is_scoped_to_exactly_the_steps_that_call_gh():
    """GH_TOKEN must be bound via step-level env: on exactly the three
    steps that invoke `gh` (the live PR #28 head check, precondition
    validation, and draft-PR creation) -- and nowhere else, in particular
    not on checkout, the Rust toolchain setup, the CLI build, plugin
    assembly, or the claude CLI install/validate steps."""
    doc = _load_workflow()
    steps = doc["jobs"]["dry-run"]["steps"]
    gh_token_step_names = {
        s["name"] for s in steps if "GH_TOKEN" in s.get("env", {})
    }
    expected = {
        "Check PR #28 for live source-head drift",
        "Validate publish preconditions (source ref, candidate collision)",
        "Open a draft pull request into release/plugins",
    }
    assert gh_token_step_names == expected

    no_token_steps = (
        "Checkout the pinned source commit",
        "Set up Rust toolchain",
        "Build the konductor CLI",
        "Assemble the flat Claude Code plugin tree",
        "Install claude CLI for validation",
        "Validate the assembled plugin tree (strict manifest validation)",
    )
    for s in steps:
        if s.get("name") in no_token_steps:
            assert "GH_TOKEN" not in s.get("env", {}), (
                f"step '{s.get('name')}' must not have GH_TOKEN bound"
            )


def _all_run_bodies() -> str:
    """Concatenates every step's `run:` body across every job. Scoped to
    actual executed shell, not the file's prose comments -- the header
    comment above legitimately names these commands to say the workflow
    never runs them, which would otherwise false-positive a plain
    substring check against the whole file."""
    doc = _load_workflow()
    bodies = []
    for job in doc["jobs"].values():
        for step in job.get("steps", []):
            if "run" in step:
                bodies.append(step["run"])
    return "\n".join(bodies)


def test_no_tag_release_merge_or_direct_base_push_commands():
    """These are the operations this rehearsal must be structurally
    incapable of: creating/moving a tag, creating a GitHub Release,
    merging the opened PR, or writing straight to release/plugins without
    going through a candidate branch + draft PR."""
    run_bodies = _all_run_bodies()
    forbidden_substrings = (
        "git tag",
        "gh release create",
        "gh release upload",
        "gh pr merge",
        "--force",
        "push origin release/plugins",
        "push origin HEAD:release/plugins",
    )
    for forbidden in forbidden_substrings:
        assert forbidden not in run_bodies, f"found forbidden command/flag: '{forbidden}'"


def test_only_one_job_defined():
    """A single job keeps the permissions grant above provably scoped to
    the one place that needs it -- no second job could pick up a broader
    permissions default."""
    doc = _load_workflow()
    assert list(doc["jobs"].keys()) == ["dry-run"]


def test_cleanup_step_runs_with_if_always():
    """The cleanup-identifiers step must run on every outcome, not just
    on success -- a mid-pipeline failure (e.g. after the branch push but
    before the PR is opened) still leaves remote state that needs a
    printed identifier to clean up."""
    doc = _load_workflow()
    steps = doc["jobs"]["dry-run"]["steps"]
    cleanup_steps = [
        s for s in steps if s.get("name") == "Report deterministic cleanup identifiers"
    ]
    assert len(cleanup_steps) == 1
    assert cleanup_steps[0].get("if") == "always()"


def test_cleanup_step_reports_candidate_branch_unconditionally_and_pr_conditionally():
    """The candidate branch identifier must always be reported (if it was
    derived at all); the PR identifiers must only be reported when the PR
    step actually produced them, so a failed/skipped PR step can't print
    an empty, malformed cleanup command. Separate cleanup commands must be
    offered for the branch-only case and the branch+PR case."""
    doc = _load_workflow()
    steps = doc["jobs"]["dry-run"]["steps"]
    cleanup_step = next(
        s for s in steps if s.get("name") == "Report deterministic cleanup identifiers"
    )
    run_body = cleanup_step["run"]
    assert 'CANDIDATE_BRANCH="${{ steps.candidate.outputs.candidate_branch }}"' in run_body
    assert 'PR_NUMBER="${{ steps.pr.outputs.pr_number }}"' in run_body
    # Branch-only cleanup path (PR never created).
    assert "git push origin --delete $CANDIDATE_BRANCH" in run_body
    # Branch+PR cleanup path (PR was created).
    assert "gh pr close $PR_NUMBER" in run_body
    assert "--delete-branch" in run_body


def test_cleanup_step_never_prints_a_token():
    """The cleanup commands must rely on the invoking user's own gh/git
    auth, never embed GH_TOKEN or any other credential in printed text."""
    doc = _load_workflow()
    steps = doc["jobs"]["dry-run"]["steps"]
    cleanup_step = next(
        s for s in steps if s.get("name") == "Report deterministic cleanup identifiers"
    )
    assert "GH_TOKEN" not in cleanup_step.get("env", {})
    assert "GH_TOKEN" not in cleanup_step["run"]
    assert "secrets." not in cleanup_step["run"]
