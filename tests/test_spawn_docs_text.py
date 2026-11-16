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


def test_docs_say_only_konductor_holds_subagent_on_kiro_v2():
    """Synth gives the mux orchestrators the specialists' explicit v2 built-in list, so
    `konductor` is the one agent whose Kiro CLI v2 config carries `subagent`; the earlier
    "declares ... reach it only through `@builtin`" hedge is gone with the `@builtin`."""
    for rel in ("docs/user-guide/agents.md", "docs/user-guide/use-cases/review-code-and-tests.md"):
        text = _flat(_read(rel))
        assert "holds `subagent` on Kiro CLI v2" in text, rel
        assert "declares `subagent`" not in text, rel
        assert "reach it only through `@builtin`" not in text, rel
        assert "has `subagent`" not in text, rel
    for rel in ("docs/site/user-guide.html", "docs/index.html"):
        # The bundle stores the page JSON-encoded, so `</code>` is `<\u002Fcode>`.
        page = re.sub(r"<code[^>]*>|<(?:/|\\u002F)code>", "", _read(rel))
        assert "Only konductor holds subagent on Kiro CLI v2" in page, rel
        assert "only konductor holds subagent on Kiro CLI v2; the mux orchestrators" in page, rel
        assert "7 agents have subagent" not in page, rel
        assert "Only konductor declares subagent" not in page, rel
        assert "only konductor does." not in page, rel


def test_mux_rows_say_the_v2_list_matches_a_specialist():
    """The mux rows scope their claim to v2: on Kiro CLI v3 synth leaves their `@builtin`
    (and its `run_workflow`) in place, so the specialist row's unscoped "**nothing**" would
    overclaim there."""
    agents = _flat(_read("docs/user-guide/agents.md"))
    cell = "no `subagent` tool (on v2, the same explicit built-in list as a specialist)"
    for name in ("konductor-mux-orchestrator", "konductor-cmux-orchestrator"):
        assert f"| `{name}` | {cell}" in agents, name
        assert f"| `{name}` | **nothing**" not in agents, name
    assert "| every `k-*` specialist | **nothing** | **nothing** |" in agents
    assert "on Kiro CLI v2 synth replaces that `@builtin`" in agents
    for rel in ("docs/site/user-guide.html", "docs/index.html"):
        page = _read(rel)
        assert "no subagent tool (on v2, the same explicit built-in list as a specialist)" in page, rel
        assert "nothing: no subagent tool" not in page, rel
        assert "synth replaces that @builtin with the same explicit built-in list" in page, rel


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
