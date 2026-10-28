# SPDX-License-Identifier: Apache-2.0
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check-version-consistency.py"


def _tree(tmp_path, version="1.2.0"):
    (tmp_path / "VERSION").write_text(f"{version}\n", encoding="utf-8")
    (tmp_path / "CHANGELOG.md").write_text(
        f"# Changelog\n\n## [Unreleased]\n\n## [{version}] - 2026-10-26\n\n### Added\n\n- x\n",
        encoding="utf-8",
    )
    cli = tmp_path / "cli" / "konductor-rs"
    cli.mkdir(parents=True)
    (cli / "Cargo.toml").write_text(f'[package]\nname = "konductor"\nversion = "{version}"\n', encoding="utf-8")
    (cli / "Cargo.lock").write_text(
        f'version = 4\n\n[[package]]\nname = "konductor"\nversion = "{version}"\n\n'
        '[[package]]\nname = "serde"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n',
        encoding="utf-8",
    )
    mcp = tmp_path / "mcp"
    (mcp / "servers" / "skill-lookup").mkdir(parents=True)
    (mcp / "Cargo.toml").write_text(f'[workspace]\nmembers = ["servers/*"]\n\n[workspace.package]\nversion = "{version}"\n', encoding="utf-8")
    (mcp / "servers" / "skill-lookup" / "Cargo.toml").write_text(
        '[package]\nname = "skill-lookup-mcp"\nversion.workspace = true\n', encoding="utf-8"
    )
    return tmp_path


def _run(root):
    return subprocess.run([sys.executable, str(SCRIPT), "--root", str(root)], capture_output=True, text=True)


def test_aligned_tree_passes(tmp_path):
    result = _run(_tree(tmp_path))
    assert result.returncode == 0, result.stderr


def test_lagging_crate_version_fails(tmp_path):
    root = _tree(tmp_path)
    (root / "cli" / "konductor-rs" / "Cargo.toml").write_text('[package]\nname = "konductor"\nversion = "1.1.0"\n', encoding="utf-8")
    result = _run(root)
    assert result.returncode == 1
    assert "cli/konductor-rs/Cargo.toml: [package] version is 1.1.0" in result.stderr


def test_lagging_workspace_version_fails(tmp_path):
    root = _tree(tmp_path)
    (root / "mcp" / "Cargo.toml").write_text('[workspace]\nmembers = ["servers/*"]\n\n[workspace.package]\nversion = "1.0.3"\n', encoding="utf-8")
    result = _run(root)
    assert result.returncode == 1
    assert "mcp/Cargo.toml: [workspace.package] version is 1.0.3" in result.stderr


def test_stale_lockfile_entry_fails_but_registry_crates_are_ignored(tmp_path):
    root = _tree(tmp_path)
    lock = root / "cli" / "konductor-rs" / "Cargo.lock"
    lock.write_text(lock.read_text(encoding="utf-8").replace('name = "konductor"\nversion = "1.2.0"', 'name = "konductor"\nversion = "1.1.0"'), encoding="utf-8")
    result = _run(root)
    assert result.returncode == 1
    assert "cli/konductor-rs/Cargo.lock: konductor is 1.1.0" in result.stderr
    assert "serde" not in result.stderr


def test_missing_changelog_section_fails(tmp_path):
    root = _tree(tmp_path)
    (root / "CHANGELOG.md").write_text("# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - 2026-10-14\n", encoding="utf-8")
    result = _run(root)
    assert result.returncode == 1
    assert "no '## [1.2.0] - YYYY-MM-DD' heading" in result.stderr


def test_build_output_under_target_is_ignored(tmp_path):
    root = _tree(tmp_path)
    vendored = root / "cli" / "konductor-rs" / "target" / "package" / "konductor-0.1.0"
    vendored.mkdir(parents=True)
    (vendored / "Cargo.toml").write_text('[package]\nname = "konductor"\nversion = "0.1.0"\n', encoding="utf-8")
    result = _run(root)
    assert result.returncode == 0, result.stderr


def test_repository_itself_passes():
    result = _run(REPO_ROOT)
    assert result.returncode == 0, result.stderr
