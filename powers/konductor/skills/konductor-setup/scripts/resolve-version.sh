#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# resolve-version.sh -- finds this Power's own pinned `plugin.json`, reads
# its bare-semver `version` field, and constructs the matching GitHub
# release tag by prepending "v".
#
# `plugin.json`'s `version` is bare semver (e.g. "1.0.2"); GitHub's release
# tags carry a "v" prefix (e.g. "v1.0.2"), and the tag-fetch endpoint uses
# whatever string it is given verbatim -- a bare "1.0.2" 404s. Same
# construction as release.yml's check-version job
# (`RELEASE_VERSION="v${RAW_VERSION}"`).
#
# Usage:
#   resolve-version.sh                  # auto-locates plugin.json, prints the tag
#   KONDUCTOR_POWER_VERSION=1.2.3 resolve-version.sh   # explicit override
#
# Prints the constructed tag (e.g. "v1.0.2") to stdout on success. Exits
# non-zero with a message on stderr if no version could be resolved --
# never guesses or falls back to a hardcoded default.
set -euo pipefail

# Not named the generic "SCRIPT_DIR": run-onboarding.sh sources this file
# after declaring its own top-level "SCRIPT_DIR", and reusing that name
# would silently overwrite the caller's variable.
RESOLVE_VERSION_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib.sh
source "${RESOLVE_VERSION_SCRIPT_DIR}/lib.sh"

# construct_tag <bare-semver>
# Pure string function: "1.0.2" -> "v1.0.2". Rejects empty input rather
# than silently producing a bare "v".
construct_tag() {
  local version="$1"
  if [[ -z "$version" ]]; then
    konductor_die "construct_tag: empty version given -- refusing to build a bare 'v' tag."
    return 1
  fi
  # Validated before it is embedded in the tag this function returns, which
  # other scripts use in a download URL, a cache path, and a
  # `git clone --branch` ref (see KONDUCTOR_CLI_VERSION_REGEX in lib.sh) --
  # catches a bad hand-edited plugin.json/KONDUCTOR_POWER_VERSION at its source.
  if [[ ! "$version" =~ $KONDUCTOR_CLI_VERSION_REGEX ]]; then
    konductor_die "construct_tag: '${version}' is not a valid bare semver (expected X.Y.Z, e.g. 1.0.2) -- refusing to build a tag from it."
    return 1
  fi
  echo "v${version}"
}

# resolve_plugin_version [script-dir]
# Walks upward looking for the Power's own plugin.json (identified by
# "name": "konductor", never an unrelated plugin.json elsewhere on disk),
# bounded to 5 levels: the known layout is 3 levels up
# (scripts/ -> konductor-setup/ -> skills/ -> plugin.json), with headroom
# for a harness that nests the installed skill deeper.
resolve_plugin_version() {
  local start_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  local dir="$start_dir" candidate name version i

  for ((i = 0; i < 5; i++)); do
    dir="$(dirname "$dir")"
    candidate="${dir}/plugin.json"
    if [[ -f "$candidate" ]]; then
      konductor_require_cmd jq
      name="$(jq -r '.name // empty' "$candidate" 2>/dev/null || true)"
      if [[ "$name" == "konductor" ]]; then
        version="$(jq -r '.version // empty' "$candidate" 2>/dev/null || true)"
        if [[ -n "$version" && "$version" != "null" ]]; then
          echo "$version"
          return 0
        fi
        konductor_die "found this Power's plugin.json at ${candidate} but it has no non-empty 'version' field."
        return 1
      fi
    fi
    # dirname("/") == "/" -- stop walking at the filesystem root.
    if [[ "$dir" == "/" ]]; then
      break
    fi
  done

  konductor_die "could not locate this Power's own plugin.json (searched upward from ${start_dir}). Set KONDUCTOR_POWER_VERSION=<x.y.z> to override."
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ -n "${KONDUCTOR_POWER_VERSION:-}" ]]; then
    PLUGIN_VERSION="$KONDUCTOR_POWER_VERSION"
  else
    # Passed explicitly, not relying on resolve_plugin_version's own
    # [script-dir] default: ShellCheck 0.9.0 (pinned in CI) flags SC2119/
    # SC2120 on a bare call to a function whose only param has a
    # ${1:-default} fallback, even though 0.11.0+ no longer does. The
    # function keeps its default for any other caller that sources this
    # file and calls it bare.
    PLUGIN_VERSION="$(resolve_plugin_version "$RESOLVE_VERSION_SCRIPT_DIR")"
  fi
  construct_tag "$PLUGIN_VERSION"
fi
