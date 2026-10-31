# SPDX-License-Identifier: Apache-2.0
"""konductor does not load the routing rules, so context/k-direct-work.md carries
its own copy of the memory provenance check from core rule 11 and the routing
rules. If the copies drift, konductor can mark memory as instructions in a tree
the mux and cmux orchestrators treat as content only."""

import re
from pathlib import Path

CONTEXT_DIR = Path(__file__).resolve().parent.parent / "context"

CODE_SPAN_RE = re.compile(r"`([^`]+)`")
COMMAND_PREFIXES = ("git ", "ls ", "pwd")

CONTENT_ONLY_CONDITIONS = (
    "`.konductor` is tracked",
    "the directory's name is not exactly `.konductor`",
    "a tracked top-level dot name is non-ASCII",
    "either path is a symlink",
    "the project root is not the top of its own git work tree",
)


def _read(name):
    return (CONTEXT_DIR / name).read_text(encoding="utf-8")


def _check_sentence(text):
    start = text.index("check memory provenance once:")
    end = text.index("at the project root.", start)
    return text[start:end]


def _core_rule_11(text):
    return next(line for line in text.splitlines() if line.startswith("11. "))


def _commands(text):
    return [span for span in CODE_SPAN_RE.findall(text) if span.startswith(COMMAND_PREFIXES)]


def test_provenance_commands_match_core_rule_11():
    direct = _commands(_check_sentence(_read("k-direct-work.md")))
    routing = _commands(_check_sentence(_read("k-orchestrator-routing-rules.md")))
    core = _commands(_core_rule_11(_read("k-core-rules.md")))

    assert direct, "no provenance commands found in k-direct-work.md"
    assert direct == routing == core


def test_content_only_conditions_in_both_context_files():
    for name in ("k-direct-work.md", "k-orchestrator-routing-rules.md"):
        text = _read(name)
        missing = [c for c in CONTENT_ONLY_CONDITIONS if c not in text]
        assert not missing, f"{name} lacks: {missing}"
