#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# The run steps of .github/workflows/plant-release-guard.yml, kept here so they can be tested without a runner.
# Runs release-guard.js on the full history of the current repository.
#
# Environment:
#   PLANT_RELEASE_HASHES  the release-line hash file's contents (the repository secret); may be empty
#   GUARD_BASE            the PR base SHA or the push 'before' SHA; empty or all zeros when there is none
#   RUNNER_TEMP           where the hash file is written (GitHub sets it; defaults to TMPDIR or /tmp)
#
# With the secret: the full check. Without it: a change under bench/physical or bench/runner/lib/plant (or one this
# script cannot diff) fails; any other change runs the path, type and encrypted-header checks with an empty hash list.
# Never prints the secret.
set -euo pipefail

GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-guard.js"
PLANT_PATHS=(bench/physical bench/runner/lib/plant)

fail() { echo "FATAL: $*" >&2; exit 1; }

[ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "false" ] \
  || fail "the clone is shallow or not a git repository; the release guard needs the full history (fetch-depth: 0)."
[ -n "$(git rev-list -n 1 --all HEAD 2>/dev/null)" ] || fail "the repository has no commits; the release guard needs the full history."

# Touches plant code unless a usable base shows it does not.
touches_plant=1
base="${GUARD_BASE:-}"
if [ -n "$base" ] && [ -n "${base//0/}" ] && git cat-file -e "${base}^{commit}" 2>/dev/null \
  && changed="$(git diff --name-only "${base}...HEAD" -- "${PLANT_PATHS[@]}" 2>/dev/null)" && [ -z "$changed" ]; then
  touches_plant=0
fi

if [ -z "${PLANT_RELEASE_HASHES:-}" ] && [ "$touches_plant" = 1 ]; then
  fail "the PLANT_RELEASE_HASHES secret is empty, and this change touches bench/physical or bench/runner/lib/plant (or has no base to compare). The release guard cannot check hashed release lines without it. Fork PRs never get repository secrets, so a maintainer must run this check from a branch in this repository."
fi

umask 077
hashes="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/plant-hashes.XXXXXX")"
trap 'rm -f "$hashes"' EXIT
chmod 600 "$hashes"
if [ -n "${PLANT_RELEASE_HASHES:-}" ]; then
  printf '%s\n' "$PLANT_RELEASE_HASHES" > "$hashes"
else
  echo "release guard: PLANT_RELEASE_HASHES is empty and no plant path changed; checking paths, file types and encrypted headers only, not hashed lines."
fi

node "$GUARD" check --hashes "$hashes" --repo .
