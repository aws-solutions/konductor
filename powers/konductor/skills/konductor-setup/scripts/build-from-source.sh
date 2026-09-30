#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# build-from-source.sh -- konductor-setup step 3: the Intel Mac
# (x86_64-apple-darwin) fallback. No binary is published for this triple
# (no free-tier Intel macOS GitHub runner), so this clones the pinned
# release tag and builds the `konductor` CLI binary locally via the
# repo's own root Makefile.
#
# Only the CLI binary needs this fallback -- the packaged content artifact
# (agents/skills/SOPs) is architecture-independent and still downloads
# normally via `konductor install`'s own no-`--from` GitHub-release path,
# so this script does NOT run `synth`/`install` itself; it only produces a
# working `konductor` binary for the caller to use in place of a
# downloaded one, mirroring scripts/konductor-clone-install.sh's own
# clone+build logic but stopping short of its final `install` line.
#
# Usage:
#   build-from-source.sh <repo-url> <tag> <clone-dir>
#
#   <repo-url>   e.g. https://github.com/aws-solutions/konductor.git
#   <tag>        the v-prefixed release tag to build (see resolve-version.sh)
#   <clone-dir>  directory to clone into; must not already exist
#
# Requires a Rust toolchain (cargo) on PATH. If missing, this is a clear,
# named stop pointing at https://rustup.rs -- this script never tries to
# install a toolchain on the user's behalf.
#
# On success, sets BUILD_FROM_SOURCE_RESULT to the path of the built,
# executable `konductor` binary and returns 0. That path is under a STABLE
# location -- `${HOME}/.konductor/cli-releases/` -- not under <clone-dir>:
# the built binary is copied there once the build succeeds, before
# returning. Same reason as fetch-verify-binary.sh's identical relocation
# (see that file's header): a caller (run-onboarding.sh) treats <clone-dir>
# as disposable and removes it via an EXIT trap the moment the whole
# onboarding script finishes, success or failure alike -- returning a path
# under <clone-dir> would leave the `~/.local/bin/konductor` symlink
# dangling within moments of a SUCCESSFUL build, not just a failed one.
#
# Separately: `git clone`'s and `make build`'s own real output must stream
# straight to the terminal, not be captured away by a caller trying to
# retrieve this function's result -- same rationale as
# fetch-verify-binary.sh's FETCH_VERIFY_BINARY_RESULT.
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

  if [[ -e "$clone_dir" ]]; then
    konductor_die "${clone_dir} already exists -- refusing to clone into it. Remove it or choose a different directory."
    return 1
  fi

  # --branch "$tag" clones and checks out the pinned tag directly (the
  # same $tag resolve-version.sh built, e.g. "v1.0.2") -- never main/HEAD.
  # A tag that does not exist upstream is a real fail-stop right here:
  # `git clone --branch <nonexistent>` exits non-zero with a clear "Remote
  # branch <tag> not found in upstream origin" (verified directly), so the
  # `if ! konductor_run git clone ...` guard below already catches it.
  konductor_log "Cloning ${repo_url} at ${tag} into ${clone_dir}"
  if ! konductor_run git clone --branch "$tag" --depth 1 "$repo_url" "$clone_dir"; then
    konductor_die "failed to clone ${repo_url} at tag ${tag} -- the tag may not exist on this repository. Not building an unpinned checkout."
    return 1
  fi

  # Explicit, second verification that HEAD is EXACTLY the pinned tag --
  # not "whatever --branch happened to resolve" -- before building
  # anything. `git describe --tags --exact-match` is chosen over a
  # redundant `git checkout "$tag"` (which would silently no-op here,
  # proving nothing new) because it specifically confirms the checked-out
  # commit carries the pinned TAG, catching the one case --branch's own
  # resolution could get wrong: a same-named BRANCH shadowing the tag
  # upstream. Confirmed the tag ref is present locally even in this
  # --depth 1 shallow clone (verified directly).
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

  # Relocate to the stable release cache before returning -- see this
  # file's header for why <clone_dir> itself is never safe to hand back to
  # a caller that may remove it once the whole script exits.
  releases_dir="${HOME:?HOME must be set}/.konductor/cli-releases"
  mkdir -p "$releases_dir"
  stable_path="${releases_dir}/konductor-${tag}-source-build"
  cp -f "$built_binary" "$stable_path"
  chmod +x "$stable_path"

  BUILD_FROM_SOURCE_RESULT="$stable_path"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -ne 3 ]]; then
    konductor_die "usage: build-from-source.sh <repo-url> <tag> <clone-dir>" || exit 64
  fi
  build_from_source "$1" "$2" "$3"
  echo "$BUILD_FROM_SOURCE_RESULT"
fi
