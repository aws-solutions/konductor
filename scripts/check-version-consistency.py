#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Fail if any Cargo version, any lockfile entry for this repo's own crates, or the
CHANGELOG disagrees with the repo-root VERSION file.

Checked against VERSION:
- `[package].version` and `[workspace.package].version` in every Cargo.toml under
  cli/, mcp/ and shared/. Crates with `version.workspace = true` are covered by their
  workspace's own version.
- Every Cargo.lock entry with no `source`, which are this repo's own crates.
- CHANGELOG.md has a `## [<VERSION>] - YYYY-MM-DD` heading.

powers/konductor/plugin.json is checked by scripts/check-plugin-json-version-drift.sh.

Usage: check-version-consistency.py [--root DIR]
"""

import argparse
import os
import re
import sys
import tomllib
from pathlib import Path

CRATE_DIRS = ("cli", "mcp", "shared")
SKIP_DIRS = {"target", "node_modules", ".git"}


def cargo_files(root, name):
    for top in CRATE_DIRS:
        for dirpath, dirnames, filenames in os.walk(root / top):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            if name in filenames:
                yield Path(dirpath) / name


def check(root):
    version = (root / "VERSION").read_text(encoding="utf-8").strip()
    problems = []

    for path in sorted(cargo_files(root, "Cargo.toml")):
        data = tomllib.loads(path.read_text(encoding="utf-8"))
        rel = path.relative_to(root)
        for table, label in ((data.get("package", {}), "[package]"),
                             (data.get("workspace", {}).get("package", {}), "[workspace.package]")):
            found = table.get("version")
            if isinstance(found, str) and found != version:
                problems.append(f"{rel}: {label} version is {found}")

    for path in sorted(cargo_files(root, "Cargo.lock")):
        data = tomllib.loads(path.read_text(encoding="utf-8"))
        rel = path.relative_to(root)
        for package in data.get("package", []):
            if "source" not in package and package.get("version") != version:
                problems.append(f"{rel}: {package.get('name')} is {package.get('version')}")

    changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8")
    if not re.search(rf"^## \[{re.escape(version)}\] - \d{{4}}-\d{{2}}-\d{{2}}$", changelog, re.M):
        problems.append(f"CHANGELOG.md: no '## [{version}] - YYYY-MM-DD' heading")

    return version, problems


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()

    version, problems = check(args.root.resolve())
    if problems:
        print(f"error: these disagree with VERSION ({version}):", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    print(f"version check passed: everything matches VERSION ({version})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
