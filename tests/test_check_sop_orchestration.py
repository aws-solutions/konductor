# SPDX-License-Identifier: Apache-2.0
"""Tests for scripts/check-sop-orchestration.py.

Each directory under tests/fixtures/sop-orchestration/ is a minimal repo
root. `valid` passes; every other case fails with the code it is named for.

Run:  cd tests && pytest test_check_sop_orchestration.py
"""
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check-sop-orchestration.py"
FIXTURES = REPO_ROOT / "tests" / "fixtures" / "sop-orchestration"
MARKER = "Orchestration: strict (phase-gated SOP)"


def run_check(*args) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["python3", str(SCRIPT), *map(str, args)],
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize("case", ["valid", "valid-phases-only", "valid-phase-list-no-sentinel"])
def test_valid_fixture_passes_silently(case):
    result = run_check(FIXTURES / case)
    assert result.returncode == 0, result.stderr
    assert result.stdout == "" and result.stderr == ""


@pytest.mark.parametrize(
    "case, expected",
    [
        ("unlisted-sop", "unlisted-sop: agent-sops/gamma-extra.sop.md"),
        ("listed-twice", "listed-twice: 'alpha-gated'"),
        ("missing-sop-file", "missing-sop-file: 'delta-missing'"),
        ("gated-missing-marker", "missing-marker: gated 'alpha-gated'"),
        ("gated-marker-in-overview", "missing-marker: gated 'alpha-gated'"),
        ("gated-marker-indented", "missing-marker: gated 'alpha-gated'"),
        ("gated-marker-not-own-paragraph", "missing-marker: gated 'alpha-gated'"),
        ("not-gated-with-marker", "unexpected-marker: not_gated 'beta-plain'"),
        ("bad-entry", "bad-entry: gated 'alpha-gated' needs a non-empty 'gates' list"),
        ("phase-list-mismatch", "phase-list-mismatch: gated 'alpha-gated' phases ['one', 'two'] differ"),
        ("phase-list-missing-bullet", "phase-list-mismatch: gated 'alpha-gated' has phases but"),
        ("unknown-boundary-phase", "unknown-boundary-phase: gated 'alpha-gated' boundary 'zero'"),
        ("unknown-boundary-kind", "unknown-boundary-kind: gated 'alpha-gated' boundary 'one' kind 'loop-exit'"),
        ("bad-boundary-shape", "'boundaries' item 1 'scope' must be one of feature, run"),
        ("bad-boundary-scope-list", "'boundaries' item 1 'scope' must be one of feature, run"),
        ("bad-boundary-scope-dict", "'boundaries' item 1 'scope' must be one of feature, run"),
        ("bad-boundary-scope-value", "'boundaries' item 1 'scope' must be one of feature, run"),
        ("bad-boundaries-not-list", "'boundaries' must be a list of {phase, kind, scope}"),
        ("bad-boundary-missing-key", "'boundaries' item 1 must have exactly phase, kind, scope (missing ['scope']"),
        ("bad-boundary-extra-key", "'boundaries' item 1 must have exactly phase, kind, scope (missing [], unexpected ['note']"),
        ("bad-boundary-non-string", "'boundaries' item 1 'phase' must be a string"),
        ("empty-boundaries", "'boundaries' must not be empty; omit it"),
        ("unknown-gated-key-boundaries", "bad-entry: gated 'alpha-gated' has unknown key 'boundries'"),
        ("unknown-gated-key-phases", "bad-entry: gated 'alpha-gated' has unknown key 'phasesz'"),
        ("bad-phases-unhashable", "bad-entry: gated 'alpha-gated' 'phases' must be a non-empty list of unique ids"),
        ("duplicate-boundary-phase", "bad-entry: gated 'alpha-gated' boundary phase 'one' listed more than once"),
        ("bad-phases-duplicate", "bad-entry: gated 'alpha-gated' 'phases' must be a non-empty list of unique ids"),
        ("bad-phases-empty", "bad-entry: gated 'alpha-gated' 'phases' must be a non-empty list of unique ids"),
        ("bad-phases-non-string", "bad-entry: gated 'alpha-gated' 'phases' must be a non-empty list of unique ids"),
        ("boundaries-without-phases", "bad-entry: gated 'alpha-gated' has 'boundaries' without 'phases'"),
    ],
)
def test_failure_fixture_reports_its_code(case, expected):
    result = run_check(FIXTURES / case)
    assert result.returncode == 1
    assert expected in result.stderr


def assert_one_clean_bad_entry(result, expected):
    output = result.stdout + result.stderr
    bad_entries = [line for line in output.splitlines() if line.startswith("bad-entry:")]
    assert result.returncode != 0
    assert len(bad_entries) == 1, output
    assert expected in bad_entries[0]
    assert "Traceback" not in output


def test_malformed_map_reports_one_bad_entry():
    result = run_check(FIXTURES / "malformed-map")
    assert_one_clean_bad_entry(result, "bad-entry: cli/gate-config/sop-orchestration.yml: ")


def test_non_utf8_sop_reports_one_bad_entry():
    result = run_check(FIXTURES / "non-utf8-sop")
    assert_one_clean_bad_entry(result, "bad-entry: agent-sops/beta-plain.sop.md: ")


def test_removing_the_marker_from_a_valid_tree_fails(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "valid", root)
    sop = root / "agent-sops" / "alpha-gated.sop.md"
    sop.write_text(sop.read_text(encoding="utf-8").replace(MARKER + "\n\n", ""), encoding="utf-8")
    result = run_check(root)
    assert result.returncode == 1
    assert "missing-marker: gated 'alpha-gated'" in result.stderr


@pytest.mark.parametrize("args", [["a", "b"], ["--help"], ["does-not-exist"]])
def test_bad_invocation_exits_64(args):
    assert run_check(*args).returncode == 64


def test_full_sdlc_boundaries_are_pinned():
    import yaml

    data = yaml.safe_load((REPO_ROOT / "cli/gate-config/sop-orchestration.yml").read_text(encoding="utf-8"))
    assert data["gated"]["k-full-sdlc"]["boundaries"] == [
        {"phase": "design-review", "kind": "check-threshold", "scope": "run"},
        {"phase": "feature-splitting", "kind": "approval", "scope": "run"},
        {"phase": "specs", "kind": "approval", "scope": "feature"},
        {"phase": "code-review", "kind": "approval", "scope": "run"},
        {"phase": "testing", "kind": "check-threshold", "scope": "feature"},
    ]


def test_repo_tree_agrees_with_its_map():
    result = run_check(REPO_ROOT)
    assert result.returncode == 0, result.stderr
