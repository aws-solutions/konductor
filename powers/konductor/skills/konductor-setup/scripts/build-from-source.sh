#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# build-from-source.sh -- konductor-setup step 3: Intel Mac
# (x86_64-apple-darwin) fallback. No binary is published for this triple
# (no free-tier Intel macOS GitHub runner), so this clones the pinned
# release tag and builds the `konductor` CLI binary via the repo's own
# root Makefile.
#
# Only the CLI binary needs this -- the content artifact
# (agents/skills/SOPs) is architecture-independent and still downloads via
# `konductor install`'s own no-`--from` GitHub-release path, so this script
# never runs `synth`/`install` itself; it only produces a working
# `konductor` binary.
#
# Usage:
#   build-from-source.sh <repo-url> <tag> <clone-dir>
#
#   <repo-url>   e.g. https://github.com/aws-solutions/konductor.git
#   <tag>        the v-prefixed release tag to build (see resolve-version.sh)
#   <clone-dir>  directory to clone into; must not already exist
#
# Requires cargo on PATH; if missing, stops with a named pointer to
# https://rustup.rs rather than installing a toolchain itself.
#
# On success, sets BUILD_FROM_SOURCE_RESULT to the built binary's path
# under the STABLE `${HOME}/.konductor/cli-releases/` cache, not under
# <clone-dir>: run-onboarding.sh removes <clone-dir> via an EXIT trap the
# moment it finishes, which would leave a path under it dangling.
#
# `git clone`'s and `make build`'s own output streams straight to the
# terminal, never captured.
set -euo pipefail

BUILD_FROM_SOURCE_RESULT=""

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

build_from_source() {
  local repo_url="$1" tag="$2" clone_dir="$3"
  local built_binary releases_dir stable_path checked_out_ref

  if ! command -v cargo >/dev/null 2>&1; then
    konductor_die "no prebuilt konductor binary is published for this platform, and no Rust toolchain (cargo) was found on PATH to build one from source. Install one via https://rustup.rs, then re-run."
    return 1
  fi
  konductor_require_cmd git "Install git to clone aws-solutions/konductor."

  # Validated BEFORE any use: $tag goes straight into `git clone --branch`
  # and a cache path with zero further escaping, and may arrive from
  # --tag or KONDUCTOR_POWER_VERSION (see KONDUCTOR_CLI_TAG_REGEX in lib.sh).
  if [[ ! "$tag" =~ $KONDUCTOR_CLI_TAG_REGEX ]]; then
    konductor_die "build_from_source: '${tag}' is not a valid release tag (expected a v-prefixed semver like v1.0.2) -- refusing to use it as a git ref or in a path."
    return 1
  fi

  if [[ -e "$clone_dir" ]]; then
    konductor_die "${clone_dir} already exists -- refusing to clone into it. Remove it or choose a different directory."
    return 1
  fi

  # --branch "$tag" clones and checks out the pinned tag directly, never
  # main/HEAD. A nonexistent tag exits non-zero with a clear "Remote
  # branch <tag> not found", caught by the guard below.
  konductor_log "Cloning ${repo_url} at ${tag} into ${clone_dir}"
  if ! konductor_run git clone --branch "$tag" --depth 1 "$repo_url" "$clone_dir"; then
    konductor_die "failed to clone ${repo_url} at tag ${tag} -- the tag may not exist on this repository. Not building an unpinned checkout."
    return 1
  fi

  # Second verification that HEAD is EXACTLY the pinned tag, not whatever
  # --branch resolved: `git describe --tags --exact-match` catches a
  # same-named BRANCH shadowing the tag upstream, which a bare
  # `git checkout "$tag"` would silently miss.
  konductor_log "Verifying the clone is checked out at the pinned tag ${tag}"
  if ! checked_out_ref="$(cd "$clone_dir" && git describe --tags --exact-match 2>/dev/null)"; then
    konductor_die "cloned ${repo_url} but could not verify HEAD is exactly tag ${tag} (git describe --tags --exact-match found no exact tag match) -- refusing to build an unverified checkout."
    return 1
  fi
  if [[ "$checked_out_ref" != "$tag" ]]; then
    konductor_die "cloned ${repo_url} but HEAD is at '${checked_out_ref}', not the pinned tag '${tag}' -- refusing to build the wrong version."
    return 1
  fi

  konductor_log "Building konductor via 'make build' in ${clone_dir}"
  if ! (cd "$clone_dir" && konductor_run make build); then
    konductor_die "'make build' failed in ${clone_dir} -- see output above."
    return 1
  fi

  built_binary="${clone_dir}/build/cli/konductor"
  if [[ ! -x "$built_binary" ]]; then
    konductor_die "'make build' reported success but ${built_binary} is not executable."
    return 1
  fi

  releases_dir="${HOME:?HOME must be set}/.konductor/cli-releases"
  stable_path="${releases_dir}/konductor-${tag}-source-build"
  if ! konductor_publish_cached_binary "$built_binary" "$stable_path"; then
    return 1
  fi

  BUILD_FROM_SOURCE_RESULT="$stable_path"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -ne 3 ]]; then
    konductor_die "usage: build-from-source.sh <repo-url> <tag> <clone-dir>" || exit 64
  fi
  build_from_source "$1" "$2" "$3"
  echo "$BUILD_FROM_SOURCE_RESULT"
fi
