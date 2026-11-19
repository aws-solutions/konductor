# SPDX-License-Identifier: Apache-2.0
"""Tests for scripts/generate-claude-plugin.sh's --out guard.

The script replaces --out as a whole, so it must refuse a directory it
could destroy: the repo root or an ancestor, any in-repo path outside
dist/, and a non-empty directory without its marker file. Every case runs
in a disposable copy of the script's repo layout, never this checkout.

Refusal cases point KONDUCTOR_BIN at a path that does not exist. The guard
runs before that check, so a missing guard shows up as the wrong error
message, not as damage. Success cases use a stub konductor that imitates
`synth` and `install --harness claude`.

Run:  cd tests && pytest test_generate_claude_plugin_out_guard.py -v
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
MARKER = ".konductor-claude-plugin-out"

STUB_KONDUCTOR = """#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  synth)
    mkdir -p dist/claude/agents
    printf -- '---\\nname: k-stub\\n---\\n' > dist/claude/agents/k-stub.md
    ;;
  install)
    [ -z "${STUB_INSTALL_FAILS:-}" ] || exit 7
    target=""
    while [ $# -gt 0 ]; do
      [ "$1" = "--target" ] && target="$2"
      shift
    done
    mkdir -p "$target/.claude/skills/sop-k-stub"
    printf 'stub\\n' > "$target/.claude/skills/sop-k-stub/SKILL.md"
    ;;
esac
"""


@pytest.fixture
def fake_repo(tmp_path):
    """A repo layout holding the generator, its helper and the tracked
    source trees the guard protects."""
    root = tmp_path / "repo"
    (root / "scripts").mkdir(parents=True)
    for name in (
        "generate-claude-plugin.sh",
        "read-bundled-mcp-servers.sh",
        "claude-plugin-mcp-servers.json",
    ):
        shutil.copy2(REPO_ROOT / "scripts" / name, root / "scripts" / name)
    for tree in ("agents", "skills"):
        (root / tree).mkdir()
        (root / tree / "keep.txt").write_text("source\n", encoding="utf-8")
    stub = tmp_path / "konductor"
    stub.write_text(STUB_KONDUCTOR, encoding="utf-8")
    stub.chmod(0o755)
    return root


def run(repo, out, cwd=None, konductor=None, extra_env=None):
    env = dict(os.environ)
    env["KONDUCTOR_BIN"] = str(konductor or (repo.parent / "no-such-konductor"))
    env.update(extra_env or {})
    return subprocess.run(
        ["bash", str(repo / "scripts" / "generate-claude-plugin.sh"), "--out", str(out)],
        cwd=cwd or repo,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def assert_sources_intact(repo):
    for tree in ("agents", "skills"):
        assert (repo / tree / "keep.txt").read_text(encoding="utf-8") == "source\n", tree


def assert_refused(result, reason):
    assert result.returncode == 1, result.stderr
    assert "refusing --out" in result.stderr, result.stderr
    assert reason in result.stderr, result.stderr


def test_refuses_dot_from_the_repo_root(fake_repo):
    result = run(fake_repo, ".", cwd=fake_repo)
    assert_refused(result, "repository root or an ancestor")
    assert_sources_intact(fake_repo)


def test_refuses_the_repo_root_by_absolute_path(fake_repo):
    result = run(fake_repo, fake_repo, cwd=fake_repo.parent)
    assert_refused(result, "repository root or an ancestor")
    assert_sources_intact(fake_repo)


def test_refuses_dotdot_from_the_repo_root(fake_repo):
    result = run(fake_repo, "..", cwd=fake_repo)
    assert_refused(result, "repository root or an ancestor")
    assert_sources_intact(fake_repo)


def test_refuses_a_symlink_to_the_repo_root(fake_repo, tmp_path):
    link = tmp_path / "link-to-repo"
    link.symlink_to(fake_repo)
    result = run(fake_repo, link, cwd=tmp_path)
    assert_refused(result, "repository root or an ancestor")
    assert_sources_intact(fake_repo)


@pytest.mark.parametrize("rel", ["agents", "skills", "docs/out", "dist"])
def test_refuses_in_repo_paths_outside_dist(fake_repo, rel):
    result = run(fake_repo, rel, cwd=fake_repo)
    assert_refused(result, "must be under dist/")
    assert_sources_intact(fake_repo)


def test_refuses_a_foreign_non_empty_directory(fake_repo, tmp_path):
    foreign = tmp_path / "someone-elses"
    foreign.mkdir()
    (foreign / "notes.txt").write_text("mine\n", encoding="utf-8")
    result = run(fake_repo, foreign)
    assert_refused(result, f"no {MARKER}")
    assert (foreign / "notes.txt").read_text(encoding="utf-8") == "mine\n"


def test_refuses_a_file(fake_repo, tmp_path):
    target = tmp_path / "a-file"
    target.write_text("x\n", encoding="utf-8")
    result = run(fake_repo, target)
    assert_refused(result, "not a directory")
    assert target.read_text(encoding="utf-8") == "x\n"


def assert_generated(out):
    assert (out / MARKER).is_file()
    assert sorted(p.name for p in out.iterdir()) == sorted([MARKER, "agents", "skills"])
    assert (out / "agents" / "k-stub.md").is_file()
    assert (out / "skills" / "sop-k-stub" / "SKILL.md").is_file()


def test_writes_an_absent_directory(fake_repo, tmp_path):
    out = tmp_path / "new" / "out"
    result = run(fake_repo, out, konductor=tmp_path / "konductor")
    assert result.returncode == 0, result.stderr
    assert_generated(out)
    assert_sources_intact(fake_repo)


def test_writes_an_empty_directory(fake_repo, tmp_path):
    out = tmp_path / "empty"
    out.mkdir()
    result = run(fake_repo, out, konductor=tmp_path / "konductor")
    assert result.returncode == 0, result.stderr
    assert_generated(out)


def test_replaces_a_directory_with_the_marker(fake_repo, tmp_path):
    out = tmp_path / "previous"
    out.mkdir()
    (out / MARKER).write_text("", encoding="utf-8")
    (out / "stale.txt").write_text("old\n", encoding="utf-8")
    result = run(fake_repo, out, konductor=tmp_path / "konductor")
    assert result.returncode == 0, result.stderr
    assert_generated(out)
    assert not list(tmp_path.glob(".claude-plugin-*")), "staging directories left behind"


def test_first_run_into_dist_claude_plugin(fake_repo, tmp_path):
    result = run(fake_repo, "dist/claude-plugin", konductor=tmp_path / "konductor")
    assert result.returncode == 0, result.stderr
    assert_generated(fake_repo / "dist" / "claude-plugin")
    assert_sources_intact(fake_repo)
    assert not list((fake_repo / "dist").glob(".claude-plugin-*"))


def test_a_failed_run_leaves_the_previous_output_untouched(fake_repo, tmp_path):
    out = tmp_path / "previous"
    out.mkdir()
    (out / MARKER).write_text("", encoding="utf-8")
    (out / "stale.txt").write_text("old\n", encoding="utf-8")
    result = run(
        fake_repo, out, konductor=tmp_path / "konductor", extra_env={"STUB_INSTALL_FAILS": "1"}
    )
    assert result.returncode == 7
    assert (out / "stale.txt").read_text(encoding="utf-8") == "old\n"
    assert not list(tmp_path.glob(".claude-plugin-*")), "staging directories left behind"
