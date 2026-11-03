# SPDX-License-Identifier: Apache-2.0
"""Tests for scripts/check-sop-gate-facts.py.

Each directory under tests/fixtures/sop-gate-facts/ is a minimal repo
root. `valid` passes; every other case fails with the code it is named for.

Run:  cd tests && pytest test_check_sop_gate_facts.py
"""
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check-sop-gate-facts.py"
FIXTURES = REPO_ROOT / "tests" / "fixtures" / "sop-gate-facts"


def run_check(*args) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["python3", str(SCRIPT), *map(str, args)],
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize("case", ["valid", "valid-code-review"])
def test_valid_fixture_passes_silently(case):
    result = run_check(FIXTURES / case)
    assert result.returncode == 0, result.stderr
    assert result.stdout == "" and result.stderr == ""


@pytest.mark.parametrize(
    "case, expected",
    [
        ("gate-fact-missing", "gate-fact-missing: 'k-full-sdlc' Step for 'review' does not name `gate_review_checker`"),
        ("gate-fact-unknown-phase", "gate-fact-unknown-phase: 'k-full-sdlc' names a gate fact for 'summary'"),
        ("gate-skip-unexplained", "gate-skip-unexplained: 'k-full-sdlc'"),
        ("gate-evidence-path", "gate-evidence-path: 'k-full-sdlc' gate_review_evidence"),
        ("gate-word-mapped", "gate-word-mapped: 'k-full-sdlc' maps a checker word to a gate id"),
        ("gate-result-rule", "gate-result-rule: 'k-full-sdlc' lacks the rule"),
        ("max-fix-cycles-unrecorded", "max-fix-cycles-unrecorded (k-full-sdlc only): 'k-full-sdlc' does not say `max_fix_cycles` is written into `run.data` at minting as a non-negative integer"),
        ("verify-run-step-order", "verify-run-step (k-full-sdlc only): 'k-full-sdlc' verify-run must come before"),
        ("verify-run-unavailable-missing", "verify-run-step (k-full-sdlc only): 'k-full-sdlc' final Step does not cover 'verify-run unavailable'"),
        ("gate-evidence-root", "gate-evidence-root (k-full-sdlc only): 'k-full-sdlc' must anchor evidence relative to `output_dir`"),
        ("gate-override-rule", "gate-override-rule: 'k-full-sdlc' does not say an unattended run never overrides"),
        ("gate-round-cap-no-approver", "gate-override-rule: 'k-full-sdlc' still says 'no approver'"),
        ("gate-override-rule-way-forward", "gate-override-rule: 'k-full-sdlc' lacks the sentence recording an engineer override"),
        ("gate-override-key-missing", "gate-fact-missing: 'k-full-sdlc' Step for 'review' does not name `gate_review_override`"),
        ("step-phase-mismatch", "step-phase-mismatch: 'k-full-sdlc' has Step headings numbered [0, 2, 2]"),
        ("verify-run-root", "verify-run-root (k-full-sdlc only): 'k-full-sdlc' verify-run call must run from `codebase_path`"),
        ("verify-run-root-flag", "verify-run-root (k-full-sdlc only): 'k-full-sdlc' verify-run call must run from `codebase_path`"),
        ("verify-run-exit-unhandled", "verify-run-exits (k-full-sdlc only): 'k-full-sdlc' final Step does not say what to do with exit 65"),
        ("verify-run-config-source", "verify-run-step (k-full-sdlc only): 'k-full-sdlc' final Step does not put every reason and info line, `CONFIG_SOURCE` included, under `Gate check`"),
        ("gate-override-on-approval-boundary", "gate-override-on-approval: 'k-full-sdlc' names `gate_draft_override`, but 'draft' is an approval boundary and has no override key"),
        ("gate-approval-result", "gate-approval-result (k-full-sdlc only): 'k-full-sdlc' records a verdict word instead of `approved`"),
        ("gate-verdict-missing", "gate-approval-result (k-full-sdlc only): 'k-full-sdlc' Step for 'code-review' does not name gate_code-review_verdict"),
        ("max-fix-cycles-unread", "max-fix-cycles-unread (k-full-sdlc only): 'k-full-sdlc' Step for 'implementation' does not read the cap from `run.data.max_fix_cycles`"),
        ("max-fix-cycles-resume-missing", "max-fix-cycles-resume (k-full-sdlc only): 'k-full-sdlc' lacks the 'Reconciliation on resume (max_fix_cycles)' rule"),
        ("verify-run-disagreement-missing", "verify-run-disagreement (k-full-sdlc only): 'k-full-sdlc' final Step does not force `satisfied=false`"),
        ("verify-run-gate-check-heading", "verify-run-step (k-full-sdlc only): 'k-full-sdlc' final Step's Expected Output does not name the `Gate check` section"),
        ("record-skipped-missing", "record-skipped-missing (k-full-sdlc only): 'k-full-sdlc' Step for 'review' has no Record bullet with a `SKIPPED` outcome"),
        ("verify-run-phase-status-missing", "verify-run-phase-status (k-full-sdlc only): 'k-full-sdlc' final Step lacks the constraint"),
        ("verify-run-phase-order-missing", "verify-run-phase-order (k-full-sdlc only): 'k-full-sdlc' final Step does not name `PHASE_ORDER` under exit 65"),
    ],
)
def test_failure_fixture_reports_its_code(case, expected):
    result = run_check(FIXTURES / case)
    assert result.returncode == 1
    assert expected in result.stderr
    assert len(result.stderr.splitlines()) == 1, result.stderr


def test_missing_root_signal_reports_both_phrases():
    result = run_check(FIXTURES / "verify-run-root-flag-signal")
    assert result.returncode == 1
    assert "does not cover 'unexpected argument'" in result.stderr
    assert "does not cover 'needs a build with --root'" in result.stderr
    assert len(result.stderr.splitlines()) == 2, result.stderr


def test_verify_run_rules_apply_only_to_k_full_sdlc():
    result = run_check(FIXTURES / "other-sop")
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("args", [["--help"], ["a", "b"], ["/no/such/dir"]])
def test_bad_invocation_exits_64(args):
    result = run_check(*args)
    assert result.returncode == 64
    assert result.stderr.startswith("usage:")


def test_repo_tree_passes():
    result = run_check(REPO_ROOT)
    assert result.returncode == 0, result.stderr
