#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# fetch-verify-binary.sh -- konductor-setup step 2: download the pinned
# release's `konductor` binary for one of the three published platform
# triples, plus its `.sha256` sidecar, and verify the download before it is
# ever executed or linked onto PATH (design §5.3 step 2, §9).
#
# Asset naming and download URL shape mirror scripts/konductor-install.sh
# exactly: `konductor-<tag>-<triple>` and `<same>.sha256`, fetched directly
# from `https://github.com/<repo>/releases/download/<tag>/<asset>` -- no
# GitHub API metadata lookup needed here, since the tag is already known
# (resolved from this Power's own plugin.json, not "latest").
#
# Usage:
#   fetch-verify-binary.sh <repo> <tag> <triple> <download-dir>
#
#   <repo>          e.g. aws-solutions/konductor (overridable for a fork/test)
#   <tag>           the v-prefixed release tag, e.g. v1.0.2 (see resolve-version.sh)
#   <triple>        one of the three published triples (see detect-platform.sh)
#   <download-dir>  scratch directory for the download + checksum verify --
#                   may be (and, from run-onboarding.sh, is) an ephemeral
#                   directory the caller removes when it's done. The final
#                   verified binary is NOT left here; see below.
#
# On success, sets FETCH_VERIFY_BINARY_RESULT to the path of the verified,
# executable binary and returns 0. That path is under a STABLE location --
# `${HOME}/.konductor/cli-releases/` -- not under <download-dir>: the
# verified binary is moved there once checksum verification passes, before
# returning. This matters beyond tidiness -- run-onboarding.sh symlinks
# `~/.local/bin/konductor` to whatever path this function returns, and its
# own <download-dir> is an ephemeral `mktemp -d` directory removed via an
# EXIT trap the moment the whole onboarding script finishes, success or
# failure alike. Returning a path under <download-dir> would leave that
# symlink dangling within moments of a SUCCESSFUL run, not just a failed
# one. `${HOME}/.konductor/cli-releases/` mirrors the exact convention
# scripts/konductor-install.sh already uses for the identical reason (see
# that script's own `KONDUCTOR_RELEASES_DIR`) -- reuse, not a new
# convention invented for this Power.
#
# Deliberately NOT "prints the path on stdout, capture with $(...)": curl's
# and sha256sum's own real output must stream straight to the terminal
# per design §9 ("visible commands only" -- never captured into a variable
# and replaced with a summary), and capturing this function's whole stdout
# to retrieve its result would swallow that same real output instead of
# showing it. A global result variable keeps the two concerns separate:
# real command output stays live on the terminal, and the actual return
# value travels through a channel a caller reads deliberately, not by
# accident. (The standalone CLI entrypoint at the bottom of this file still
# echoes the result for a human running this script directly -- that's a
# fresh process's own stdout, never captured by anything.)
#
# On any failure -- network error, missing asset (tag/platform not
# published), or checksum mismatch -- prints a clear error to stderr and
# exits non-zero. Per design §5.3 step 2's failure note: a tag that does
# not resolve (e.g. plugin.json's version has drifted from what was
# actually tagged) is a hard stop here -- this script NEVER falls back to
# "latest" as a silent substitute for a 404, since that would install a
# version this Power was not validated against.
set -euo pipefail

FETCH_VERIFY_BINARY_RESULT=""

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

fetch_verify_binary() {
  local repo="$1" tag="$2" triple="$3" dest_dir="$4"
  local asset_name sidecar_name base_url asset_path sidecar_path
  local releases_dir stable_path

  konductor_require_cmd curl "Install curl to download the konductor binary."

  asset_name="konductor-${tag}-${triple}"
  sidecar_name="${asset_name}.sha256"
  base_url="https://github.com/${repo}/releases/download/${tag}"
  asset_path="${dest_dir}/${asset_name}"
  sidecar_path="${dest_dir}/${sidecar_name}"

  mkdir -p "$dest_dir"

  konductor_log "Downloading ${asset_name} from release ${tag} of ${repo}"
  if ! curl -fsSL -o "$asset_path" "${base_url}/${asset_name}"; then
    konductor_die "release ${tag} of ${repo} does not publish a '${asset_name}' asset (the release tag may not exist, or no binary is published for ${triple} on this release). Not retrying against 'latest' -- that would install a version this Power was not validated against."
    return 1
  fi

  konductor_log "Downloading checksum sidecar ${sidecar_name}"
  if ! curl -fsSL -o "$sidecar_path" "${base_url}/${sidecar_name}"; then
    konductor_die "downloaded ${asset_name} but its checksum sidecar ${sidecar_name} is missing from release ${tag}. Refusing to install an unverified binary."
    return 1
  fi

  konductor_log "Verifying checksum for ${asset_name}"
  if ! (cd "$dest_dir" && konductor_sha256_verify "$sidecar_name"); then
    konductor_die "checksum verification failed for ${asset_name} -- the download may be corrupted or tampered with. Not installing."
    return 1
  fi

  chmod +x "$asset_path"

  # Relocate to the stable release cache before returning -- see this
  # file's header for why <dest_dir> itself is never safe to hand back to
  # a caller that may remove it once the whole script exits.
  #
  # (MINOR, noted during adversarial review): `mv -f` here is only
  # guaranteed ATOMIC when <dest_dir> and <releases_dir> are on the same
  # filesystem -- true for run-onboarding.sh's own caller, since both are
  # ordinary paths under the same $HOME/$TMPDIR mount in the common case,
  # but not a property this line enforces or verifies. A cross-filesystem
  # `mv` falls back to a copy-then-delete internally, which is NOT atomic
  # (a reader could observe a partially-written file mid-copy) -- unlike
  # link-binary.sh's own same-directory temp-symlink-then-rename, which
  # IS guaranteed atomic because a symlink's rename never crosses a
  # filesystem boundary by construction. This is an accepted, narrow gap,
  # not a fix made here: closing it would mean detecting mount boundaries
  # (a real curl download onto a different partition, e.g. a container
  # with `/tmp` and `$HOME` mounted separately, is the realistic case),
  # which this Power's own supported-environments scope does not
  # currently need to handle.
  releases_dir="${HOME:?HOME must be set}/.konductor/cli-releases"
  mkdir -p "$releases_dir"
  stable_path="${releases_dir}/${asset_name}"
  mv -f "$asset_path" "$stable_path"

  FETCH_VERIFY_BINARY_RESULT="$stable_path"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -ne 4 ]]; then
    konductor_die "usage: fetch-verify-binary.sh <repo> <tag> <triple> <download-dir>" || exit 64
  fi
  fetch_verify_binary "$1" "$2" "$3" "$4"
  echo "$FETCH_VERIFY_BINARY_RESULT"
fi
