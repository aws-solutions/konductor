# SPDX-License-Identifier: Apache-2.0
"""Spawn and checked-version statements in the docs match the shipped code."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIRO_V2_SYNTH = "cli/konductor-rs/src/cli/synth/kiro_cli_v2.rs"
INSTALL_PAGE = "docs/user-guide/tasks/install-kiro-cli.md"


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _flat(text):
    return " ".join(text.split())


def checked_kiro_versions():
    source = _read(KIRO_V2_SYNTH)
    literal = re.search(
        r"SPECIALIST_BUILTIN_TOOLS_CHECKED_WITH:\s*\[&str;\s*\d+\]\s*=\s*\[([^\]]*)\]", source
    )
    assert literal, "SPECIALIST_BUILTIN_TOOLS_CHECKED_WITH not found"
    return re.findall(r'"([^"]+)"', literal.group(1))


def _kiro_v2_bullet():
    agents = _read("docs/user-guide/agents.md")
    start = agents.index("- Kiro CLI v2 ignores `excludedTools`")
    end = agents.index("\n\n", start)
    return _flat(agents[start:end])


def test_agent_validate_is_not_offered_as_a_tool_name_check():
    assert "checks the file's schema, not tool names" in _kiro_v2_bullet()


def test_bundle_states_any_runtime():
    assert "cannot run the adversarial review in any runtime" in _read("docs/site/user-guide.html")


def test_docs_name_the_checked_kiro_versions():
    versions = checked_kiro_versions()
    assert versions == ["2.36.0", "3.0.0"]

    row = f"| Kiro CLI (checked: {', '.join(versions)}) | `kiro-cli --version` |"
    assert row in _read(INSTALL_PAGE)

    bullet = _kiro_v2_bullet()
    for version in versions:
        assert version in bullet, version
    assert f"checked with kiro-cli {' and '.join(versions)}" in _flat(_read("CHANGELOG.md"))

    cell = f"Kiro CLI (checked: {', '.join(versions)})"
    for rel in ("docs/site/user-guide.html", "docs/index.html"):
        assert cell in _read(rel), rel
