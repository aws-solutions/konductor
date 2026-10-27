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


def test_valid_fixture_passes_silently():
    result = run_check(FIXTURES / "valid")
    assert result.returncode == 0, result.stderr
    assert result.stdout == "" and result.stderr == ""


@pytest.mark.parametrize(
    "case, expected",
    [
        ("gate-fact-missing", "gate-fact-missing: 'alpha-gated' Step for 'review' does not name `gate_review_checker`"),
        ("gate-fact-unknown-phase", "gate-fact-unknown-phase: 'alpha-gated' names a gate fact for 'summary'"),
        ("gate-skip-unexplained", "gate-skip-unexplained: 'alpha-gated'"),
        ("gate-evidence-path", "gate-evidence-path: 'alpha-gated' gate_review_evidence"),
        ("gate-word-mapped", "gate-word-mapped: 'alpha-gated' maps a checker word to a gate id"),
        ("gate-result-rule", "gate-result-rule: 'alpha-gated' lacks the rule"),
        ("verify-run-step-order", "verify-run-step: 'alpha-gated' verify-run must come before"),
        ("verify-run-unavailable-missing", "verify-run-step: 'alpha-gated' final Step does not cover 'verify-run unavailable'"),
    ],
)
def test_failure_fixture_reports_its_code(case, expected):
    result = run_check(FIXTURES / case)
    assert result.returncode == 1
    assert expected in result.stderr
    assert len(result.stderr.splitlines()) == 1, result.stderr


@pytest.mark.parametrize("args", [["--help"], ["a", "b"], ["/no/such/dir"]])
def test_bad_invocation_exits_64(args):
    result = run_check(*args)
    assert result.returncode == 64
    assert result.stderr.startswith("usage:")


def test_repo_tree_passes():
    result = run_check(REPO_ROOT)
    assert result.returncode == 0, result.stderr
