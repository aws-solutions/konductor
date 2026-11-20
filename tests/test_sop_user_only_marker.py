# SPDX-License-Identifier: Apache-2.0
"""A SOP that commits, pushes, opens pull requests or acts on a live app must
carry the `Invocation: user-only (` marker.

On Claude Code the installer turns that marker into `disable-model-invocation:
true`, the one block the harness enforces. A SOP without the marker is
model-invocable, so a typo or a forgotten line would open the SOP to the model
without a word. The list of marked SOPs is written out below on purpose: adding
or removing a user-only SOP is a decision, and this test makes it a visible one.
claude.rs rejects a malformed `Invocation:` line at install time and pins the
same three names; this test covers the source files and the listing budget.
"""

import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOPS_DIR = ROOT / "agent-sops"

# Commits, pushes, opens pull requests, or acts on a live app.
USER_ONLY_SOPS = {
    "k-e2e-test-generation",
    "k-full-sdlc",
    "k-light-ui-testing",
}

MARKER = re.compile(r"^Invocation: user-only \(", re.M)
INVOCATION_LABEL = re.compile(r"^[ \t>]*invocation[ \t]*:", re.M | re.I)
# Commands that change a repository or its remote.
SIDE_EFFECT = re.compile(
    r"\bgit (?:-C \S+ )?(?:push|commit|add|merge|rebase|reset|worktree add)\b|\bgh pr (?:create|merge)\b"
)


def _sops():
    return {p.name[: -len(".sop.md")]: p.read_text(encoding="utf-8") for p in sorted(SOPS_DIR.glob("*.sop.md"))}


def _outside_fences(text):
    return re.sub(r"^(?:```|~~~).*?^(?:```|~~~)[^\n]*$", "", text, flags=re.M | re.S)


def test_the_marked_sops_are_exactly_the_allowlist():
    marked = {name for name, text in _sops().items() if MARKER.search(_outside_fences(text))}
    assert marked == USER_ONLY_SOPS, (
        f"marked but not allowed: {sorted(marked - USER_ONLY_SOPS)}; "
        f"allowed but not marked: {sorted(USER_ONLY_SOPS - marked)}"
    )


def test_an_invocation_line_is_always_the_exact_marker():
    for name, text in _sops().items():
        for line in _outside_fences(text).splitlines():
            if INVOCATION_LABEL.match(line):
                assert MARKER.match(line), f"{name}: not the exact marker `Invocation: user-only (...)`: {line!r}"


def test_a_sop_that_changes_a_repository_is_on_the_allowlist():
    for name, text in _sops().items():
        found = sorted(set(SIDE_EFFECT.findall(_outside_fences(text))))
        if found and name not in USER_ONLY_SOPS:
            raise AssertionError(
                f"{name} runs {found}. Add `Invocation: user-only (...)` to it and to USER_ONLY_SOPS, "
                "or reword it if it only mentions the command."
            )


def test_the_listing_budget_test_skips_exactly_the_allowlist():
    spec = importlib.util.spec_from_file_location("budget", ROOT / "tests" / "test_skill_listing_budget.py")
    budget = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(budget)
    listed = {name[len("sop-") :] for name in budget.sop_listing_entries()}
    assert set(_sops()) - listed == USER_ONLY_SOPS
