#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# konductor-clone-install.sh
#
# ── WHAT THIS DOES ───────────────────────────────────────────────────────────
# A single-command convenience installer: clones the `main` branch of
# this repo's public GitHub mirror into a persistent directory under
# `~/.konductor/git`, builds it via the root `Makefile` (`make build`,
# which compiles both `cli/` and `mcp/`), symlinks the resulting
# `konductor` binary onto `PATH` via `make link`, synthesizes the
# runtime-ready output tree via `konductor synth --from .`, and then runs
# `konductor install --from .` from inside that checkout -- the same
# `make build` / `make link` / `synth` / `install` sequence as this
# repo's README "From source" walkthrough. This exists as a stopgap --
# once `konductor` ships via `brew`/`npm`, that package manager becomes
# the one-step install path and this script is no longer needed.
#
# `mcp/` is built here too, not skipped: `install` auto-discovers a
# pre-built `skill-lookup-mcp` binary at the fixed, convention-based path
# `mcp/target/release/skill-lookup-mcp` relative to `--from <repo-root>`
# (see `cli/konductor-rs/src/cli/install/mcp_server.rs`'s
# `mcp_binary_source_path` -- no explicit path is passed to `install`,
# and none is needed). That binary is how installed agents load skills
# at runtime, so building only `cli/` here would produce agents that
# can't load skills at all -- `make build` at the root is required, not
# a style preference.
#
# Because the clone directory is persistent (not a throwaway /tmp path),
# re-running this script reuses and updates it rather than re-cloning
# from scratch: if it already exists and is a git checkout of the
# expected repo, this script fetches and fast-forwards it to
# `origin/main` -- never a force-reset -- and stops with a clear error
# if the fast-forward isn't possible (e.g. local commits ahead of
# `origin/main`) rather than clobbering anything. If it exists and is
# NOT a git checkout, the script fails rather than deleting or writing
# into a directory it doesn't recognize.
#
# `install` reads exclusively from the `dist/` tree `synth` produces
# (see `cli/konductor-rs/src/cli/install/kiro_cli.rs`'s module
# docstring) -- it never reads `agents/`/`skills/`/`context/` source
# directly, so the `synth` step below is required, not optional: without
# it, `install` has nothing to copy but the already-built MCP server
# binary and reports 0 agents/skills/context files rather than failing.
#
# `install` requires an explicit `--harness <kiro-cli-v2|kiro-v3|claude>`
# flag -- there is no destination-marker auto-detection and no upstream
# default. This script defaults to `kiro-cli-v2`, since this is a
# convenience installer for `kiro-cli` users (it mirrors the "From source"
# walkthrough's no-`--target` Kiro CLI path in README.md's "How installing
# Konductor works"). Override with the `KONDUCTOR_HARNESS` environment
# variable if you want `claude` instead (`kiro-v3` has no install
# strategy yet and will exit with a scope-gap error).
#
# `install` is called with no `--target` flag, so it resolves its
# destination to `$HOME` (see `cli/konductor-rs/src/cli/install.rs`'s
# `resolve_destination`). Running this script therefore writes real
# agent/skill content into the invoking user's actual home directory --
# under `~/.kiro/` by default, or under `~/.claude/` if `KONDUCTOR_HARNESS=claude`
# is set. This is a genuine, intentional side effect of running the script
# as-is, not an accident to guard against -- override `HOME` for the
# invocation if you want the install to land somewhere else instead.
#
# ── USAGE ────────────────────────────────────────────────────────────────────
#   scripts/konductor-clone-install.sh [clone-dir]
#
# `clone-dir` is optional; it defaults to `~/.konductor/git/konductor`.
# `KONDUCTOR_HARNESS` is optional; it defaults to `kiro-cli-v2` and is passed
# through verbatim to `konductor install --harness`.

set -euo pipefail

# The public GitHub mirror this repo publishes to. Overridable for anyone
# testing against a fork.
REPO_URL="${REPO_URL:-https://github.com/aws-solutions/konductor.git}"
BRANCH="main"
CLONE_DIR="${1:-${HOME}/.konductor/git/konductor}"
# Harness passed to `konductor install --harness`. Defaults to kiro-cli-v2
# since this script is a kiro-cli convenience installer; override with
# KONDUCTOR_HARNESS=claude for Claude Code. `install` itself validates the
# value (kiro-cli-v2, kiro-v3, or claude) and exits 64 on anything else.
HARNESS="${KONDUCTOR_HARNESS:-kiro-cli-v2}"

# Order matters: stripping ".git" first misses a slash-terminated form
# like "repo.git/" (it doesn't end in ".git", it ends in "/"), so
# "repo.git" and "repo.git/" would normalize to different values and
# produce a spurious origin mismatch below. Stripping the slash(es)
# first makes every trailing-slash/`.git` combination collapse to the
# same value.
normalize_url() {
  local u="$1"
  while [[ "${u}" == */ ]]; do u="${u%/}"; done
  echo "${u%.git}"
}

CLONE_ACTION="cloned"
if [[ -e "${CLONE_DIR}" ]]; then
  if [[ -e "${CLONE_DIR}/.git" ]]; then
    echo "=== [konductor-clone-install] ${CLONE_DIR} already exists -- updating in place ==="
    existing_origin="$(git -C "${CLONE_DIR}" remote get-url origin 2>/dev/null || true)"
    if [[ -n "${existing_origin}" && "$(normalize_url "${existing_origin}")" != "$(normalize_url "${REPO_URL}")" ]]; then
      echo "error: existing checkout at ${CLONE_DIR} has origin=${existing_origin}, expected ${REPO_URL}. Remove the directory or pass a different [clone-dir]." >&2
      exit 1
    fi
    git -C "${CLONE_DIR}" fetch origin "${BRANCH}"
    git -C "${CLONE_DIR}" checkout "${BRANCH}"
    if ! git -C "${CLONE_DIR}" merge --ff-only "origin/${BRANCH}"; then
      echo "error: could not fast-forward ${CLONE_DIR} to origin/${BRANCH} (local commits ahead of the remote branch?). Resolve manually or remove the directory and re-run." >&2
      exit 1
    fi
    CLONE_ACTION="updated"
  else
    echo "error: ${CLONE_DIR} already exists and is not a git checkout (no .git found). Remove it, or pass a different [clone-dir], then re-run." >&2
    exit 1
  fi
else
  echo "=== [konductor-clone-install] Cloning ${BRANCH} into ${CLONE_DIR} ==="
  mkdir -p "$(dirname "${CLONE_DIR}")"
  git clone --branch "${BRANCH}" --single-branch "${REPO_URL}" "${CLONE_DIR}"
fi

cd "${CLONE_DIR}"

echo "=== [konductor-clone-install] Building via the root Makefile (cli/ + mcp/) ==="
if ! make build; then
  echo "error: 'make build' failed in ${CLONE_DIR} -- see output above" >&2
  exit 1
fi

echo "=== [konductor-clone-install] Symlinking konductor into \${HOME}/.local/bin ==="
LOCAL_BIN="${HOME}/.local/bin"
# `make link` resolves the actual build output path via `cargo metadata`
# (correct under both a plain standalone build and a build wrapper that
# redirects cargo's target dir -- see cli/Makefile's own RUST_BIN comment),
# verifies it's executable, and symlinks it here -- not a copy, so a
# later re-run that rebuilds this same clone (via the fetch/fast-forward
# path above) automatically updates what `konductor` resolves to, with
# no separate symlink step to re-run.
if ! make link; then
  echo "error: 'make link' failed in ${CLONE_DIR} -- see output above" >&2
  exit 1
fi
KONDUCTOR_BIN="${LOCAL_BIN}/konductor"
# `make link` now verifies this itself as a post-condition (see cli/Makefile's
# `link` target), but re-check here too: this script and `make link` can drift
# apart from that Makefile in the future, and a script-local check gives a
# specific, actionable error at the exact point this script is about to
# dereference ${KONDUCTOR_BIN}, rather than a generic "command not found"
# several lines later.
if [[ ! -x "${KONDUCTOR_BIN}" ]]; then
  echo "error: 'make link' reported success but ${KONDUCTOR_BIN} is not executable -- see output above" >&2
  exit 1
fi

echo "=== [konductor-clone-install] Synthesizing agent/skill/SOP output (dist/) ==="
if ! "${KONDUCTOR_BIN}" synth --from .; then
  echo "error: 'konductor synth --from .' failed -- see output above" >&2
  exit 1
fi

echo "=== [konductor-clone-install] Installing to \$HOME (${HOME:-<unset>}) with harness=${HARNESS} ==="
"${KONDUCTOR_BIN}" install --from . --harness "${HARNESS}" --verbose

echo ""
echo "=== [konductor-clone-install] Done ==="
if [[ "${CLONE_ACTION}" == "updated" ]]; then
  echo "Updated:     ${CLONE_DIR} (branch ${BRANCH})"
else
  echo "Cloned:      ${CLONE_DIR} (branch ${BRANCH})"
fi
echo "Built:       cli/ + mcp/ via 'make build'"
echo "Linked:      ${KONDUCTOR_BIN} -> $(readlink "${KONDUCTOR_BIN}")"
echo "Synthesized: ${CLONE_DIR}/dist"
echo "Harness:     ${HARNESS}"
echo "Installed:   see the 'konductor install' report above for what was written and where."

if ! echo "${PATH}" | tr ':' '\n' | grep -qx "${LOCAL_BIN}"; then
  echo ""
  echo "NOTE: ${LOCAL_BIN} is not on your \$PATH, so the 'konductor' command above"
  echo "      won't resolve yet. Add it to your shell profile (e.g. ~/.bashrc or"
  echo "      ~/.zshrc), then open a new shell:"
  echo "        export PATH=\"${LOCAL_BIN}:\$PATH\""
fi
