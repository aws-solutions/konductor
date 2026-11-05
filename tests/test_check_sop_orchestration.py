# SPDX-License-Identifier: Apache-2.0
"""Tests for scripts/check-sop-orchestration.py.

Each directory under tests/fixtures/sop-orchestration/ is a minimal repo
root. `valid` passes; every other case fails with the code it is named for.

Run:  cd tests && pytest test_check_sop_orchestration.py
"""
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check-sop-orchestration.py"
FIXTURES = REPO_ROOT / "tests" / "fixtures" / "sop-orchestration"
MARKER = "Orchestration: strict (phase-gated SOP)"
MEANING = (
    "Strict means: stop at each recorded gate, record the gate facts, and do not "
    "proceed past an unmet gate unless the engineer overrides it, or the SOP's own "
    "round-cap rule says to proceed; record which."
)
FIXTURE_MEANING = "Strict means: fixture meaning."
FIXTURE_GATE_NOTE = "Gate note: fixture."
GATE_NOTE = (
    "Recorded gates are the stops this SOP names; where the run keeps a session "
    "file, record their gate facts there."
)
GATED_SOPS = [
    "k-full-sdlc",
    "k-design-doc-creation",
    "k-principal-engineer-design-review",
    "kiro-spec-workflow",
]
pytestmark = pytest.mark.skipif(importlib.util.find_spec("yaml") is None, reason="PyYAML is not installed")


def run_check(*args) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *map(str, args)],
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
        ("stale-basis-heading", "stale-basis: gated 'alpha-gated' basis cites `Ship it`"),
        ("bad-entry", "bad-entry: gated 'alpha-gated' needs a non-empty 'gates' list"),
        ("gated-marker-twice", "unexpected-marker: gated 'alpha-gated' has the marker more than once"),
        ("unknown-top-level-key", "bad-entry: unknown top-level key 'extra'"),
        ("missing-top-level-key", "bad-entry: missing top-level key 'version'"),
        ("marker-wrong-type", "bad-entry: 'marker' must be a non-empty string"),
        ("wrong-gate-note", "missing-marker: gated 'alpha-gated'"),
        ("gated-basis-uncited", "uncited-basis: gated 'alpha-gated' basis cites no step heading"),
        ("not-gated-map-form", "bad-entry: not_gated 'beta-plain' needs a non-empty basis string"),
        ("non-string-sop-name", "bad-entry: not_gated key 5 must be a string"),
        ("repeated-gate-kind", "bad-entry: gated 'alpha-gated' needs a non-empty 'gates' list of distinct"),
        ("stale-basis-numbered-heading", "stale-basis: gated 'alpha-gated' basis cites `1. Do the thing`"),
        ("phase-heading-cited-prefixed", "stale-basis: gated 'alpha-gated' basis cites `Phase 1: Do the thing`"),
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
    sop.write_text(sop.read_text(encoding="utf-8").replace(MARKER + "\n" + FIXTURE_MEANING + "\n\n" + FIXTURE_GATE_NOTE + "\n\n", ""), encoding="utf-8")
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


def test_changing_the_meaning_sentence_in_a_gated_sop_fails(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "valid", root)
    sop = root / "agent-sops" / "alpha-gated.sop.md"
    sop.write_text(sop.read_text(encoding="utf-8").replace(FIXTURE_MEANING, "Strict means something else."), encoding="utf-8")
    result = run_check(root)
    assert result.returncode == 1
    assert "missing-marker: gated 'alpha-gated'" in result.stderr


@pytest.mark.parametrize(
    "case, reason",
    [
        ("gated-missing-marker", "the marker line is not the first line after the title"),
        ("wrong-gate-note", "the gate note is missing or wrong (expected: 'Gate note: fixture.')"),
        ("gated-marker-in-overview", "the marker line is not the first line after the title"),
        ("gated-marker-not-own-paragraph", "the meaning line does not follow the marker"),
        ("gated-marker-indented", "the marker line is not the first line after the title"),
    ],
)
def test_layout_failure_names_its_reason(case, reason):
    result = run_check(FIXTURES / case)
    assert result.returncode == 1
    assert reason in result.stderr


def test_changed_meaning_names_the_meaning_reason(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "valid", root)
    sop = root / "agent-sops" / "alpha-gated.sop.md"
    sop.write_text(sop.read_text(encoding="utf-8").replace(FIXTURE_MEANING, "Other."), encoding="utf-8")
    assert "the meaning line does not follow the marker" in run_check(root).stderr


def test_gate_items_that_are_not_strings_report_one_bad_entry():
    result = run_check(FIXTURES / "gates-nested-list")
    assert_one_clean_bad_entry(result, "bad-entry: gated 'alpha-gated' needs a non-empty 'gates' list")


def test_scalar_gates_with_boundaries_reports_only_the_bad_entry():
    result = run_check(FIXTURES / "gates-scalar-with-boundaries")
    assert_one_clean_bad_entry(result, "bad-entry: gated 'alpha-gated' needs a non-empty 'gates' list")
    assert "unknown-boundary-kind" not in result.stdout + result.stderr


@pytest.mark.parametrize("case", ["version-99", "version-true"])
def test_version_must_be_one(case):
    result = run_check(FIXTURES / case)
    assert_one_clean_bad_entry(result, "bad-entry: 'version' must be 1")


def test_phase_heading_is_cited_without_its_phase_label():
    result = run_check(FIXTURES / "phase-heading-cited-bare")
    assert result.returncode == 0, result.stderr


def test_duplicate_sop_entry_reports_one_bad_entry():
    result = run_check(FIXTURES / "duplicate-sop-entry")
    assert_one_clean_bad_entry(result, "duplicate key 'beta-plain'")


def test_non_string_sop_name_does_not_crash():
    result = run_check(FIXTURES / "non-string-sop-name")
    assert_one_clean_bad_entry(result, "bad-entry: not_gated key 5 must be a string")


def test_missing_pyyaml_exits_3_with_setup_message(tmp_path):
    (tmp_path / "yaml.py").write_text("raise ImportError('stub')\n", encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(FIXTURES / "valid")],
        capture_output=True,
        text=True,
        env={"PYTHONPATH": str(tmp_path)},
    )
    assert result.returncode == 3
    assert result.stderr.startswith("setup: PyYAML is required")


def test_meaning_and_gate_note_are_pinned_in_the_map_and_every_gated_sop():
    import yaml

    data = yaml.safe_load((REPO_ROOT / "cli" / "gate-config" / "sop-orchestration.yml").read_text(encoding="utf-8"))
    assert data["meaning"] == MEANING
    assert data["gate_note"] == GATE_NOTE
    assert sorted(data["gated"]) == sorted(GATED_SOPS)
    for name in GATED_SOPS:
        lines = (REPO_ROOT / "agent-sops" / f"{name}.sop.md").read_text(encoding="utf-8").splitlines()
        assert lines[2:6] == [MARKER, MEANING, "", GATE_NOTE], name
