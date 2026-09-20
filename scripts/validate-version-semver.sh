#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# validate-version-semver.sh -- fail closed unless the given string is a
# valid X.Y.Z semver. Shared by release.yml's check-version job and
# validate-pr.yml so the regex and FATAL message live in one place instead
# of two independently-maintained inline copies. Mirrors
# versionSemverValidationSnippet() in the release-pipeline package's
# konductor-release-project.ts, which applies the same check on the CDK
# pipeline side for the same reason.
#
# Usage: validate-version-semver.sh <version-string>
#   exit 0: valid semver
#   exit 1: missing argument, or not a valid semver

set -e

VERSION="$1"
if [ -z "$VERSION" ]; then
  echo "FATAL: validate-version-semver.sh requires a version string argument. Failing closed." >&2
  exit 1
fi

# grep's ^/$ anchor to line boundaries, not the whole input -- a value with
# embedded newlines (e.g. "0.1.0\ngarbage") whose first line is valid semver
# would otherwise pass the structural check below. Reject any character
# outside [0-9.] first; that class also matches a newline.
case "$VERSION" in
  *[!0-9.]*)
    echo "FATAL: VERSION content '${VERSION}' is not a valid semver (expected X.Y.Z). Failing closed." >&2
    exit 1 ;;
esac

if ! printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "FATAL: VERSION content '${VERSION}' is not a valid semver (expected X.Y.Z). Failing closed." >&2
  exit 1
fi
