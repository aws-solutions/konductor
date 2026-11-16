#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# The run steps of .github/workflows/plant-release-guard.yml, kept here so they can be tested without a runner.
# Runs release-guard.js on the full history of the current repository.
#
# Environment:
#   PLANT_RELEASE_HASHES  the release-line hash file's contents (the repository secret); may be empty
#   RUNNER_TEMP           where the hash file is written (GitHub sets it; defaults to TMPDIR or /tmp)
#
# With the secret: the full check. Without it (a fork PR, or a repository that never set it): the path, file type and
# encrypted-header checks with an empty hash list, and a note that the hashed-line check is off. Never prints the secret.
set -euo pipefail

GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-guard.js"

fail() { echo "FATAL: $*" >&2; exit 1; }

[ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "false" ] \
  || fail "the clone is shallow or not a git repository; the release guard needs the full history (fetch-depth: 0)."
[ -n "$(git rev-list -n 1 --all HEAD 2>/dev/null)" ] || fail "the repository has no commits; the release guard needs the full history."

umask 077
hashes="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/plant-hashes.XXXXXX")"
trap 'rm -f "$hashes"' EXIT
chmod 600 "$hashes"
if [ -n "${PLANT_RELEASE_HASHES:-}" ]; then
  printf '%s\n' "$PLANT_RELEASE_HASHES" > "$hashes"
else
  echo "release guard: note: PLANT_RELEASE_HASHES is not set, so the hashed-line check is off; checking paths, file types and encrypted headers only."
fi

node "$GUARD" check --hashes "$hashes" --repo .
