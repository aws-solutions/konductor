#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# resolve-version.sh -- finds this Power's own pinned `plugin.json`, reads
# its bare-semver `version` field, and constructs the matching GitHub
# release tag by prepending "v".
#
# Tag construction is NOT optional and must match exactly: `plugin.json`'s
# `version` is bare semver (e.g. "1.0.2"); GitHub's release tags carry a "v"
# prefix (e.g. "v1.0.2"); `install/github.rs`'s tag-fetch endpoint uses
# whatever string it is given verbatim, with zero normalization -- a bare
# "1.0.2" 404s. This is the same construction `.github/workflows/
# release.yml`'s `check-version` job uses: `RELEASE_VERSION="v${RAW_VERSION}"`
# from the repo-root VERSION file's bare value. "1.0.2" and "v1.0.2" are two
# different strings; only one of them resolves.
#
# Usage:
#   resolve-version.sh                  # auto-locates plugin.json, prints the tag
#   KONDUCTOR_POWER_VERSION=1.2.3 resolve-version.sh   # explicit override
#
# Prints the constructed tag (e.g. "v1.0.2") to stdout on success. Exits
# non-zero with a message on stderr if no version could be resolved --
# never guesses or falls back to a hardcoded default.
set -euo pipefail

# Computed once and reused below (for sourcing lib.sh, and as the explicit
# argument to resolve_plugin_version's own standalone-invocation call site)
# rather than re-running the same `dirname`/`pwd` subshell twice in this
# file. Deliberately NOT named the generic "SCRIPT_DIR": this file is also
# sourced (not just run standalone) by run-onboarding.sh, which already
# declares its own top-level "SCRIPT_DIR" before sourcing this file --
# reusing that name here would silently overwrite the caller's variable
# the moment this file is sourced into the same shell.
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
  echo "v${version}"
}

# resolve_plugin_version [script-dir]
# Walks upward from the scripts/ directory looking for the Power's own
# plugin.json (identified by "name": "konductor" so an unrelated plugin.json
# elsewhere on disk is never mistaken for this one), bounded to 5 levels so
# a search miss fails fast rather than walking to filesystem root. Known
# layout: scripts/ -> konductor-setup/ -> skills/ -> <power-root>/plugin.json
# is 3 levels up; the extra headroom (5) tolerates a harness that nests the
# installed skill one or two directories deeper than the source tree does,
# without searching indefinitely.
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
    # Stop walking once we hit the filesystem root -- dirname("/") == "/".
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
    # Pass the already-computed script dir explicitly rather than relying
    # on resolve_plugin_version's own [script-dir] default: this is the
    # only call site in this file, so leaving it bare made ShellCheck
    # 0.9.0 (the version pinned on GitHub-hosted ubuntu-latest runners --
    # see the Makefile's own kiro-power-check comment) flag SC2120 on the
    # function definition and SC2119 here, even though a newer local
    # ShellCheck (0.11.0+) no longer flags a $1 with a ${1:-default}
    # fallback. The function keeps its own default -- it is still a
    # legitimate, documented [script-dir] optional argument for any other
    # caller that sources this file and calls it bare -- this call site
    # just stops being that caller.
    PLUGIN_VERSION="$(resolve_plugin_version "$RESOLVE_VERSION_SCRIPT_DIR")"
  fi
  construct_tag "$PLUGIN_VERSION"
fi
