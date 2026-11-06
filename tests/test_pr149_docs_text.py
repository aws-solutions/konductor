# SPDX-License-Identifier: Apache-2.0
"""Version and spawn statements in the docs match what was checked."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _flat(text):
    return " ".join(text.split())


def test_no_last_v2_release_claim():
    for rel in ("docs/user-guide/agents.md", "cli/konductor-rs/src/cli/synth/kiro_cli_v2.rs"):
        text = _flat(_read(rel).replace("///", " "))
        assert "last v2 release" not in text, rel
        assert "no further feature updates" not in text, rel


def test_agent_validate_is_not_offered_as_a_tool_name_check():
    text = _flat(_read("docs/user-guide/agents.md"))
    assert "checks the file's schema, not tool names" in text


def _spawn_either_runtime_sentences(text):
    for sentence in re.split(r"(?<=[.!?])\s+", _flat(text)):
        if "spawn" in sentence.lower() and "either runtime" in sentence.lower():
            yield sentence


def test_spawn_claims_say_any_runtime():
    offenders = []
    for path in (ROOT / "docs/user-guide").rglob("*.md"):
        offenders += [f"{path.name}: {s}" for s in _spawn_either_runtime_sentences(path.read_text(encoding="utf-8"))]
    for rel in ("docs/site/user-guide.html", "docs/index.html"):
        offenders += [f"{rel}: {s}" for s in _spawn_either_runtime_sentences(_read(rel))]
    assert "cannot spawn the architect in any runtime" in _read("docs/site/user-guide.html")
    assert not offenders, offenders
