# SPDX-License-Identifier: Apache-2.0
"""Tests for the lint-toolchain pin check in tools/user-guide-sync/check-guide-facts.py.

The pin in validate-pr.yml is required, so a missing file, a missing or renamed
key, or a value that is not a literal X.Y.Z version must fail the check instead
of being skipped.

Run:  cd tests && pytest test_check_guide_facts_lint_pin.py
"""

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "tools" / "user-guide-sync" / "check-guide-facts.py"
WORKFLOW_REL = Path(".github") / "workflows" / "validate-pr.yml"
SECTION_TITLE = "the pre-PR lint toolchain matches validate-pr.yml"
EXPECTED_SHAPE = "must be a literal X.Y.Z version, optionally quoted"


def load_script():
    sys.path.insert(0, str(SCRIPT.parent))
    spec = importlib.util.spec_from_file_location("check_guide_facts", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


check_guide_facts = load_script()


def pin_of(tmp_path, text):
    workflow = tmp_path / "validate-pr.yml"
    workflow.write_text(text, encoding="utf-8", newline="")
    return check_guide_facts.find_lint_toolchain_pin(workflow)


@pytest.mark.parametrize(
    "text",
    [
        "env:\n  RUST_LINT_TOOLCHAIN: 1.98.1\n",
        'env:\n  RUST_LINT_TOOLCHAIN: "1.98.1"\n',
        "env:\n  RUST_LINT_TOOLCHAIN: '1.98.1'\n",
        "env:\n  RUST_LINT_TOOLCHAIN: 1.98.1  # bump deliberately\n",
        "env:\n  RUST_LINT_TOOLCHAIN:\n    1.98.1\n",
        "env:\r\n  RUST_LINT_TOOLCHAIN: 1.98.1\r\n",
    ],
    ids=["bare", "double-quoted", "single-quoted", "trailing-comment", "next-line", "crlf"],
)
def test_literal_version_is_parsed(tmp_path, text):
    assert pin_of(tmp_path, text) == ("1.98.1", None)


def test_missing_workflow_file_is_a_problem(tmp_path):
    pin, problem = check_guide_facts.find_lint_toolchain_pin(tmp_path / "absent.yml")
    assert pin is None
    assert "validate-pr.yml not found" in problem
    assert "RUST_LINT_TOOLCHAIN" in problem


def test_renamed_key_is_a_problem(tmp_path):
    pin, problem = pin_of(tmp_path, "env:\n  LINT_TOOLCHAIN: 1.98.1\n")
    assert pin is None
    assert "no RUST_LINT_TOOLCHAIN key" in problem


@pytest.mark.parametrize(
    "value",
    ["${{ vars.RUST }}", "stable", "1.98", '"1.98.1', "1.98.1'"],
    ids=["expression", "stable", "two-part", "unbalanced-double", "unbalanced-single"],
)
def test_non_literal_version_is_a_problem(tmp_path, value):
    pin, problem = pin_of(tmp_path, f"env:\n  RUST_LINT_TOOLCHAIN: {value}\n")
    assert pin is None
    assert EXPECTED_SHAPE in problem


@pytest.fixture(scope="module")
def repo_copy(tmp_path_factory):
    dest = tmp_path_factory.mktemp("repo")
    shutil.copytree(
        REPO_ROOT,
        dest,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns(".git", "target", "node_modules", ".worktrees", ".agents"),
    )
    return dest


def lint_section_output(repo, pin_line):
    workflow = repo / WORKFLOW_REL
    original = workflow.read_text(encoding="utf-8")
    lines = [
        pin_line if "RUST_LINT_TOOLCHAIN:" in line else line
        for line in original.splitlines(keepends=True)
    ]
    workflow.write_text("".join(lines), encoding="utf-8")
    try:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--repo", str(repo)],
            capture_output=True,
            text=True,
        )
    finally:
        workflow.write_text(original, encoding="utf-8")
    _, _, rest = result.stdout.partition(SECTION_TITLE)
    return rest.split("\n[", 1)[0]


def test_guide_mention_that_differs_from_pin_fails(repo_copy):
    section = lint_section_output(repo_copy, "          RUST_LINT_TOOLCHAIN: 1.99.0\n")
    assert "FAIL  lint toolchain differs from RUST_LINT_TOOLCHAIN=1.99.0" in section


def test_quoted_pin_matching_the_guide_passes(repo_copy):
    section = lint_section_output(repo_copy, '          RUST_LINT_TOOLCHAIN: "1.98.1"\n')
    assert "ok    every lint toolchain mention says 1.98.1" in section
    assert "FAIL" not in section


def test_unparsable_pin_fails_the_section(repo_copy):
    section = lint_section_output(repo_copy, "          RUST_LINT_TOOLCHAIN: stable\n")
    assert f"FAIL  RUST_LINT_TOOLCHAIN in validate-pr.yml is 'stable'; it {EXPECTED_SHAPE}" in section
    assert "ok" not in section


CLI_RS = REPO_ROOT / "cli" / "konductor-rs" / "src" / "cli.rs"


def test_config_stays_withdrawn_and_is_found_as_a_hidden_command():
    assert "config" in check_guide_facts.WITHDRAWN_COMMANDS
    assert "config" in check_guide_facts.hidden_commands(CLI_RS.read_text(encoding="utf-8"))


def test_existence_check_accepts_a_hidden_command_missing_from_the_readme():
    assert check_guide_facts.withdrawn_command_problem("config", ["init"], {"config"}) is None


def test_existence_check_fails_for_a_name_in_neither_source():
    problem = check_guide_facts.withdrawn_command_problem("nosuchcmd", ["init"], {"config"})
    assert "cli/README.md does not declare it and cli.rs has no hidden command of that name" in problem
