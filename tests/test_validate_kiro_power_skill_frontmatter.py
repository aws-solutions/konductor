# SPDX-License-Identifier: Apache-2.0
"""Regression tests for scripts/validate-kiro-power-skill-frontmatter.py.

The frontmatter parser reads each `key: value` line verbatim and never
expands multi-line YAML. If `name` or `description` is written as a block
scalar (`name: |`, `description: >-`, etc.), the real value lives on the
FOLLOWING indented lines, which this parser never reads -- it would
silently treat the bare indicator character itself ("|", ">-", ...) as
the whole value instead, passing or failing the wrong checks for the
wrong reason. This file pins that such a value is rejected with a clear,
specific error instead.

Run:  cd tests && pytest test_validate_kiro_power_skill_frontmatter.py
"""
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "validate-kiro-power-skill-frontmatter.py"


def run_validator(power_root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["python3", str(SCRIPT), str(power_root)],
        capture_output=True,
        text=True,
    )


def _write_skill(power_root: Path, skill_name: str, skill_md_body: str) -> None:
    skill_dir = power_root / "skills" / skill_name
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(skill_md_body, encoding="utf-8")


def test_script_exists():
    assert SCRIPT.is_file(), f"missing script: {SCRIPT}"


def test_valid_frontmatter_accepted():
    with tempfile.TemporaryDirectory() as tmp:
        power_root = Path(tmp)
        _write_skill(
            power_root,
            "my-skill",
            "---\nname: my-skill\ndescription: Does a thing.\n---\nBody.\n",
        )
        result = run_validator(power_root)
        assert result.returncode == 0, result.stderr


def test_name_as_block_scalar_pipe_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        power_root = Path(tmp)
        _write_skill(
            power_root,
            "my-skill",
            "---\nname: |\n  my-skill\ndescription: Does a thing.\n---\nBody.\n",
        )
        result = run_validator(power_root)
        assert result.returncode == 1
        assert "block scalar" in result.stderr
        assert "name" in result.stderr


def test_description_as_block_scalar_folded_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        power_root = Path(tmp)
        _write_skill(
            power_root,
            "my-skill",
            "---\nname: my-skill\ndescription: >-\n  Does a thing.\n---\nBody.\n",
        )
        result = run_validator(power_root)
        assert result.returncode == 1
        assert "block scalar" in result.stderr
        assert "description" in result.stderr


def test_block_scalar_with_indentation_indicator_rejected():
    """`|2`, `>+3`, etc. are also valid YAML block-scalar indicators."""
    with tempfile.TemporaryDirectory() as tmp:
        power_root = Path(tmp)
        _write_skill(
            power_root,
            "my-skill",
            "---\nname: my-skill\ndescription: |2\n  Does a thing.\n---\nBody.\n",
        )
        result = run_validator(power_root)
        assert result.returncode == 1
        assert "block scalar" in result.stderr


def test_pipe_character_as_literal_value_not_confused_with_block_scalar():
    """A single literal '|' is a legitimate (if unusual) block-scalar
    indicator in real YAML too -- there is no quoted-vs-bare distinction
    this line-based parser can see, so this must still be rejected the
    same way, not accidentally accepted as a one-character name."""
    with tempfile.TemporaryDirectory() as tmp:
        power_root = Path(tmp)
        _write_skill(
            power_root,
            "my-skill",
            "---\nname: my-skill\ndescription: |\n  text\n---\nBody.\n",
        )
        result = run_validator(power_root)
        assert result.returncode == 1
        assert "block scalar" in result.stderr
