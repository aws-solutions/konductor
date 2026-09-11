# SPDX-License-Identifier: Apache-2.0
"""Pins this package's `.konductor/` gitignore semantics: runtime state is
ignored, shared configuration is not.

Two rules carry that split, and they must be read together:

- `.konductor/*` ignores every direct child of the repo-root `.konductor/`,
  so per-developer runtime state (`memory/MEMORY.md`, `memory/USER.md`, and
  the CLI's `.config.lock`) cannot be accidentally staged.
- `!.konductor/memory-config.json` is the sole re-inclusion. It is not the
  only shared configuration under that root -- `konductor init` also writes
  `config.yml` and `.gitignore` there (cli/konductor-rs/src/cli/init.rs) and
  both stay ignored; whether either should be re-included too is a separate
  question, not settled here.

There are no legacy-root guards to test. This package has never shipped, so
no consumer can hold pre-rename `.asdlc/` or `.memory/` state.

The first two assertions below are mutation-sensitive only as a pair.
Deleting `.konductor/*` outright would leave the "config is not ignored"
assertion green -- nothing would be ignored -- so the "runtime state IS
ignored" assertion is what catches that. Do not drop one and keep the other.

Everything is verified through `git check-ignore` against a real (copied)
`.gitignore`, never by reasoning about gitignore precedence rules.

Fixture design: every probe file is built inside pytest's `tmp_path`,
seeded with a COPY of the real `.gitignore` and initialised as its own
scratch git repo (`git check-ignore` needs a repo to resolve patterns
against). Nothing is written under the real working tree.

Run:  cd tests && pytest test_gitignore_konductor_memory_semantics.py
"""

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
GITIGNORE_CONTENT = (REPO_ROOT / ".gitignore").read_text()


@pytest.fixture
def sandbox(tmp_path):
    """Builds an isolated scratch git repo under pytest's `tmp_path`, seeded
    with a COPY of this repo's real `.gitignore`, and returns `(root, make)`
    where `make()` creates probe files under `root`."""
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / ".gitignore").write_text(GITIGNORE_CONTENT)

    def make(relpath: str) -> Path:
        p = tmp_path / relpath
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("probe\n")
        return p

    return tmp_path, make


def _is_ignored(root: Path, relpath: str) -> bool:
    """Ground truth: would `git add` skip this path?"""
    result = subprocess.run(
        ["git", "check-ignore", "-q", relpath],
        cwd=root,
        capture_output=True,
    )
    return result.returncode == 0


def test_konductor_runtime_state_is_ignored(sandbox):
    """Per-developer memory state must stay untrackable. This is also the
    assertion that catches outright deletion of the `.konductor/*` rule.

    The third probe is a dot-prefixed DIRECT child of `.konductor/`, unlike
    the two nested `memory/` probes: a gitignore `*` matches dotfiles, so
    `.konductor/*` covers it, and narrowing that rule to `.konductor/memory/`
    would leave it trackable while the first two probes stayed green.
    `.config.lock` is the real such file this package writes -- see
    `cli/konductor-rs/src/cli/config_lock.rs`, which names
    `.konductor/.config.lock` as its stable `config.yml` write lock.

    Probed at the repo root, which is as far as the rule reaches. Unlike
    `memory/`, this file's location is not toplevel-derived: `config set`
    resolves its target directory from the process CWD (`dispatch.rs`'s
    `resolve_cwd`), so running it from a subdirectory writes
    `sub/.konductor/.config.lock`, which these rules deliberately do not
    cover -- see `test_konductor_rule_is_anchored_to_the_repo_root`."""
    root, make = sandbox
    for probe in (
        ".konductor/memory/MEMORY.md",
        ".konductor/memory/USER.md",
        ".konductor/.config.lock",
    ):
        f = make(probe)
        assert _is_ignored(root, str(f.relative_to(root))), (
            f"{probe} holds per-developer state and must stay gitignored"
        )


def test_konductor_memory_config_json_is_not_ignored(sandbox):
    """`memory-config.json` is shared configuration, so the `.konductor/*`
    rule must not shadow it. Probed by path -- `git check-ignore` evaluates
    patterns without requiring the file to exist, and no such file is
    currently tracked in this package (only the
    `skills/persistent-memory/memory-config.json.template` it is created
    from)."""
    root, _make = sandbox
    assert not _is_ignored(root, ".konductor/memory-config.json"), (
        ".konductor/memory-config.json is shared config and must stay trackable"
    )


def test_konductor_rule_is_anchored_to_the_repo_root(sandbox):
    """The internal slash in `.konductor/*` anchors it to the repo root, so a
    nested `.konductor/` is not covered -- pinned here so the anchoring stays
    a deliberate choice rather than something a future edit silently widens.

    The anchoring is a scope decision, not a claim that no nested write can
    happen. It does match memory-validator.sh, which resolves its target via
    `git rev-parse --show-toplevel`. It does NOT match the Rust CLI, whose
    `init` and `config set` resolve theirs from the process CWD, so a nested
    `.konductor/` -- and the `.config.lock` inside it -- can appear if the CLI
    is run from a subdirectory. Leaving that trackable is the intended trade:
    stray nested state shows up in `git status` instead of being silently
    ignored, which a depth-agnostic `**/.konductor/*` would do instead."""
    root, make = sandbox
    f = make("sub/.konductor/memory/MEMORY.md")
    assert not _is_ignored(root, str(f.relative_to(root)))


def test_no_legacy_root_guards_remain(sandbox):
    """This package has no legacy state to guard, so the pre-rename roots
    must NOT be ignored -- a lingering guard is dead configuration that
    implies legacy is still a supported state. Asserted behaviourally: if
    a `.memory/` or `.asdlc/` rule were reintroduced, these probes would
    become ignored and this test would fail."""
    root, make = sandbox
    for probe in (".memory/MEMORY.md", ".asdlc/memory/MEMORY.md"):
        f = make(probe)
        assert not _is_ignored(root, str(f.relative_to(root))), (
            f"{probe} is ignored, meaning a legacy-root guard was "
            f"reintroduced into .gitignore"
        )


def test_sandbox_fixture_never_touches_the_real_repo_working_tree(sandbox):
    """Defensive isolation pin: probe fixtures must live under pytest's
    `tmp_path`, never under the real repo root."""
    root, make = sandbox
    assert root != REPO_ROOT
    assert REPO_ROOT not in (root, *root.parents)
    f = make(".konductor/memory/MEMORY.md")
    assert REPO_ROOT not in (f, *f.parents), (
        "probe fixture escaped tmp_path and would have written under the "
        "real repo working tree"
    )
