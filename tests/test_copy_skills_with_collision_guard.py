# SPDX-License-Identifier: Apache-2.0
"""Regression tests for scripts/copy-skills-with-collision-guard.sh.

assemble-claude-plugin-branch.sh assembles one flat skills/ directory from
two sources: this repo's native skills/*/SKILL.md directories, and the
sop-*/SKILL.md directories konductor install --harness claude produces.
`cp -r src dst` MERGES into an already-existing dst directory rather than
failing, so a sop-* name colliding with a native skill name would
otherwise silently interleave the two directories' files instead of
erroring. These tests exercise the guard directly against synthetic
directories, without needing the full synth/install pipeline that
scripts/assemble-claude-plugin-branch.sh depends on to populate its real
inputs.

Run:  cd tests && pytest test_copy_skills_with_collision_guard.py -v
"""

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "copy-skills-with-collision-guard.sh"


def _make_skill(root: Path, name: str, body: str) -> None:
    skill_dir = root / name
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(body, encoding="utf-8")


def _run(native: Path, sop: Path, out: Path):
    return subprocess.run(
        ["bash", str(SCRIPT), "--native", str(native), "--sop", str(sop), "--out", str(out)],
        capture_output=True,
        text=True,
    )


def test_no_collision_copies_both_sources(tmp_path):
    native = tmp_path / "native"
    sop = tmp_path / "sop"
    out = tmp_path / "out"
    _make_skill(native, "example-skill", "# example-skill\nnative body\n")
    _make_skill(sop, "sop-example", "# sop-example\nsop body\n")

    result = _run(native, sop, out)
    assert result.returncode == 0, result.stderr

    assert (out / "example-skill" / "SKILL.md").read_text(encoding="utf-8") == (
        "# example-skill\nnative body\n"
    )
    assert (out / "sop-example" / "SKILL.md").read_text(encoding="utf-8") == (
        "# sop-example\nsop body\n"
    )


def test_colliding_name_fails_loudly_instead_of_merging(tmp_path):
    native = tmp_path / "native"
    sop = tmp_path / "sop"
    out = tmp_path / "out"
    _make_skill(native, "sop-conflict", "# sop-conflict\nnative body -- must survive\n")
    _make_skill(sop, "sop-conflict", "# sop-conflict\nsop body -- must NOT overwrite native\n")

    result = _run(native, sop, out)
    assert result.returncode != 0, "expected a non-zero exit on a name collision"
    assert "sop-conflict" in result.stderr
    assert "already exists" in result.stderr

    # The native copy must be left exactly as first copied -- no partial or
    # silent merge from the colliding sop-derived directory.
    assert (out / "sop-conflict" / "SKILL.md").read_text(encoding="utf-8") == (
        "# sop-conflict\nnative body -- must survive\n"
    )


def test_multiple_native_and_sop_skills_with_one_collision_among_them(tmp_path):
    native = tmp_path / "native"
    sop = tmp_path / "sop"
    out = tmp_path / "out"
    _make_skill(native, "alpha-skill", "alpha\n")
    _make_skill(native, "sop-beta", "native beta\n")
    _make_skill(sop, "sop-beta", "sop beta -- colliding\n")
    _make_skill(sop, "sop-gamma", "gamma\n")

    result = _run(native, sop, out)
    assert result.returncode != 0
    assert "sop-beta" in result.stderr

    # alpha-skill (native, no collision) should have copied fine before the
    # collision was hit on sop-beta -- the script fails fast, but earlier,
    # non-colliding entries already copied are not rolled back.
    assert (out / "alpha-skill" / "SKILL.md").exists()
    assert (out / "sop-beta" / "SKILL.md").read_text(encoding="utf-8") == "native beta\n"


def test_missing_native_dir_fails_with_clear_error(tmp_path):
    native = tmp_path / "does-not-exist"
    sop = tmp_path / "sop"
    out = tmp_path / "out"
    sop.mkdir()

    result = _run(native, sop, out)
    assert result.returncode != 0
    assert "not found" in result.stderr


def test_missing_sop_dir_fails_with_clear_error(tmp_path):
    native = tmp_path / "native"
    sop = tmp_path / "does-not-exist"
    out = tmp_path / "out"
    native.mkdir()

    result = _run(native, sop, out)
    assert result.returncode != 0
    assert "not found" in result.stderr


def test_empty_sources_is_a_no_op_success(tmp_path):
    native = tmp_path / "native"
    sop = tmp_path / "sop"
    out = tmp_path / "out"
    native.mkdir()
    sop.mkdir()

    result = _run(native, sop, out)
    assert result.returncode == 0, result.stderr
    assert out.is_dir()
    assert list(out.iterdir()) == []


def test_missing_required_argument_fails_with_usage_error(tmp_path):
    native = tmp_path / "native"
    native.mkdir()
    result = subprocess.run(
        ["bash", str(SCRIPT), "--native", str(native)],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "required" in result.stderr
