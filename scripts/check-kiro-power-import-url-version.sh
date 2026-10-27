#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# check-kiro-power-import-url-version.sh -- fails closed if any concrete
# github.com/aws-solutions/konductor/tree/<tag>/powers/konductor URL
# committed in this repo (outside CHANGELOG.md) names a tag other than
# v$(cat VERSION).
#
# Users import the Kiro Power from a tagged release, not from `main`'s
# moving HEAD, so every doc that tells a user which URL to visit must
# name the exact tag matching the current VERSION. Without this check, a
# VERSION bump (and the plugin.json edit check-plugin-json-version-drift.sh
# already guards) can land with every one of these URLs still pointing at
# the OLD tag, silently sending users to a release that predates whatever
# the PR actually changed.
#
# Matches only a literal `main` or a real `vX.Y.Z` tag -- never a
# placeholder like `v<VERSION>` used in prose explaining the convention
# (see check-plugin-json-version-drift.sh/validate-pr.yml), so this never
# flags its own documentation of the rule.
#
# Wired into `make kiro-power-check`, same as check-plugin-json-version-drift.sh.
#
# Usage: check-kiro-power-import-url-version.sh
# Exits 0 if every URL's tag matches; exits 1 naming every mismatch.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${REPO_ROOT}/VERSION"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "error: [check-kiro-power-import-url-version] ${VERSION_FILE} not found" >&2
  exit 1
fi

VERSION_VALUE="$(tr -d '[:space:]' < "$VERSION_FILE")"
EXPECTED_TAG="v${VERSION_VALUE}"
URL_PATTERN='aws-solutions/konductor/tree/(main|v[0-9]+\.[0-9]+\.[0-9]+)/powers/konductor'

cd "$REPO_ROOT"

# git ls-files, not a plain grep -r: this repo's gitignored dist/ and
# build/ directories can contain a stale copy of a doc (or this exact URL
# baked into a generated artifact) that would otherwise be flagged here
# for content nobody actually ships or reviews as source.
# CHANGELOG.md is skipped: release notes keep the version they describe.
MATCHES="$(git ls-files -z -- ':!CHANGELOG.md' | xargs -0 grep -lE "$URL_PATTERN" 2>/dev/null || true)"

bad=0
if [[ -n "$MATCHES" ]]; then
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    while IFS= read -r found_tag; do
      [[ -z "$found_tag" ]] && continue
      if [[ "$found_tag" != "$EXPECTED_TAG" ]]; then
        echo "error: [check-kiro-power-import-url-version] ${file}: URL names '${found_tag}', expected '${EXPECTED_TAG}' (from VERSION)" >&2
        bad=1
      fi
    done < <(grep -oE "$URL_PATTERN" "$file" | sed -E 's#.*tree/(main|v[0-9]+\.[0-9]+\.[0-9]+)/powers/konductor#\1#')
  done <<< "$MATCHES"
fi

if [[ "$bad" -ne 0 ]]; then
  echo "error: [check-kiro-power-import-url-version] one or more import URLs do not name the current release tag. Update them to tree/${EXPECTED_TAG}/powers/konductor." >&2
  exit 1
fi

echo "=== [check-kiro-power-import-url-version] OK -- every import URL names ${EXPECTED_TAG} ==="
