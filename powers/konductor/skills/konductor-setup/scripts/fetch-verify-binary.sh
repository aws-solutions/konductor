#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# fetch-verify-binary.sh -- konductor-setup step 2: download the pinned
# release's `konductor` binary for one of the three published platform
# triples, plus its `.sha256` sidecar, and verify the download before it is
# ever executed or linked onto PATH.
#
# Asset naming/URL shape mirrors scripts/konductor-install.sh exactly:
# `konductor-<tag>-<triple>` and `<same>.sha256` under
# `https://github.com/<repo>/releases/download/<tag>/<asset>` -- the tag
# is already known (from plugin.json), so no "latest" API lookup.
#
# Usage:
#   fetch-verify-binary.sh <repo> <tag> <triple> <download-dir>
#
#   <repo>          e.g. aws-solutions/konductor (overridable for a fork/test)
#   <tag>           the v-prefixed release tag, e.g. v1.0.2 (see resolve-version.sh)
#   <triple>        one of the three published triples (see detect-platform.sh)
#   <download-dir>  scratch directory for the download + checksum verify;
#                   the verified binary is relocated out of it, see below.
#
# On success, sets FETCH_VERIFY_BINARY_RESULT to the verified binary's path
# under the STABLE `${HOME}/.konductor/cli-releases/` cache (same
# convention scripts/konductor-install.sh uses), not under <download-dir>:
# run-onboarding.sh symlinks `~/.local/bin/konductor` to this path, and its
# own <download-dir> is removed via an EXIT trap the moment it finishes.
#
# A global result variable, not stdout capture: curl's and sha256sum's own
# output must stream straight to the terminal, never swallowed by a
# caller capturing this function's result.
#
# Never falls back to "latest" on a missing asset -- that would install a
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

  # Validated BEFORE any use: $tag goes straight into a filename, a cache
  # path, and a download URL with zero further escaping, and may arrive
  # from --tag or KONDUCTOR_POWER_VERSION (see KONDUCTOR_CLI_TAG_REGEX in lib.sh).
  if [[ ! "$tag" =~ $KONDUCTOR_CLI_TAG_REGEX ]]; then
    konductor_die "fetch_verify_binary: '${tag}' is not a valid release tag (expected a v-prefixed semver like v1.0.2) -- refusing to use it in a download URL or path."
    return 1
  fi

  asset_name="konductor-${tag}-${triple}"
  sidecar_name="${asset_name}.sha256"
  base_url="https://github.com/${repo}/releases/download/${tag}"
  asset_path="${dest_dir}/${asset_name}"
  sidecar_path="${dest_dir}/${sidecar_name}"

  mkdir -p "$dest_dir"

  konductor_log "Downloading ${asset_name} from release ${tag} of ${repo}"
  # --proto '=https' refuses any non-https transfer regardless of the URL
  # string; --tlsv1.2 refuses to negotiate down to a weaker TLS version.
  if ! curl -fsSL --proto '=https' --tlsv1.2 -o "$asset_path" "${base_url}/${asset_name}"; then
    konductor_die "release ${tag} of ${repo} does not publish a '${asset_name}' asset (the release tag may not exist, or no binary is published for ${triple} on this release). Not retrying against 'latest' -- that would install a version this Power was not validated against."
    return 1
  fi

  konductor_log "Downloading checksum sidecar ${sidecar_name}"
  if ! curl -fsSL --proto '=https' --tlsv1.2 -o "$sidecar_path" "${base_url}/${sidecar_name}"; then
    konductor_die "downloaded ${asset_name} but its checksum sidecar ${sidecar_name} is missing from release ${tag}. Refusing to install an unverified binary."
    return 1
  fi

  konductor_log "Verifying checksum for ${asset_name}"
  if ! (cd "$dest_dir" && konductor_sha256_verify "$sidecar_name"); then
    konductor_die "checksum verification failed for ${asset_name} -- the download may be corrupted or tampered with. Not installing."
    return 1
  fi

  chmod +x "$asset_path"

  releases_dir="${HOME:?HOME must be set}/.konductor/cli-releases"
  stable_path="${releases_dir}/${asset_name}"
  if ! konductor_publish_cached_binary "$asset_path" "$stable_path"; then
    return 1
  fi

  FETCH_VERIFY_BINARY_RESULT="$stable_path"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -ne 4 ]]; then
    konductor_die "usage: fetch-verify-binary.sh <repo> <tag> <triple> <download-dir>" || exit 64
  fi
  fetch_verify_binary "$1" "$2" "$3" "$4"
  echo "$FETCH_VERIFY_BINARY_RESULT"
fi
