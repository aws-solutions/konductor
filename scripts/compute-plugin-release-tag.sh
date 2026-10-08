#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Decides whether a merged pull request should produce a
# claude-plugin-vX.Y.Z tag, and what that tag's name is. Pulled out of the
# tag-claude-plugin-release workflow so the guard logic (target/base/merged/
# candidate-prefix) is a single, directly testable unit instead of inline
# shell inside YAML.
#
# Usage: compute-plugin-release-tag.sh \
#          --merged <true|false> \
#          --base-ref <ref> \
#          --head-ref <ref> \
#          --version <X.Y.Z> \
#          [--base-branch <branch>] \
#          [--candidate-prefix <prefix>]
#
# Exit codes:
#   0  -- a tag should be created; the tag name is printed to stdout.
#   10 -- not an error; this PR does not qualify for tagging (wrong base,
#         not merged, or head branch doesn't match the candidate prefix).
#         A reason is printed to stderr.
#   1  -- malformed input (missing argument, bad version format). Fails
#         closed.
set -euo pipefail

MERGED=""
BASE_REF=""
HEAD_REF=""
VERSION=""
BASE_BRANCH="release/plugins"
CANDIDATE_PREFIX="plugin-candidate"

while [ $# -gt 0 ]; do
  case "$1" in
    --merged)
      [ $# -ge 2 ] || { echo "compute-plugin-release-tag.sh: --merged requires an argument" >&2; exit 1; }
      MERGED="$2"
      shift 2
      ;;
    --base-ref)
      [ $# -ge 2 ] || { echo "compute-plugin-release-tag.sh: --base-ref requires an argument" >&2; exit 1; }
      BASE_REF="$2"
      shift 2
      ;;
    --head-ref)
      [ $# -ge 2 ] || { echo "compute-plugin-release-tag.sh: --head-ref requires an argument" >&2; exit 1; }
      HEAD_REF="$2"
      shift 2
      ;;
    --version)
      [ $# -ge 2 ] || { echo "compute-plugin-release-tag.sh: --version requires an argument" >&2; exit 1; }
      VERSION="$2"
      shift 2
      ;;
    --base-branch)
      [ $# -ge 2 ] || { echo "compute-plugin-release-tag.sh: --base-branch requires an argument" >&2; exit 1; }
      BASE_BRANCH="$2"
      shift 2
      ;;
    --candidate-prefix)
      [ $# -ge 2 ] || { echo "compute-plugin-release-tag.sh: --candidate-prefix requires an argument" >&2; exit 1; }
      CANDIDATE_PREFIX="$2"
      shift 2
      ;;
    *)
      echo "compute-plugin-release-tag.sh: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$MERGED" ] || [ -z "$BASE_REF" ] || [ -z "$HEAD_REF" ] || [ -z "$VERSION" ]; then
  echo "compute-plugin-release-tag.sh: --merged, --base-ref, --head-ref, and --version are all required" >&2
  exit 1
fi

# Fail closed on a malformed version string -- this is an input error, not
# a "this PR doesn't qualify" skip.
if ! printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "FATAL: --version '$VERSION' is not a valid X.Y.Z semver. Failing closed." >&2
  exit 1
fi

# Guard 1: merged. GitHub's pull_request.closed event fires for both a
# merge and a plain close-without-merge; `merged` is the documented boolean
# that distinguishes them (see "pull_request" in GitHub's webhook payload
# reference). A closed-without-merge PR must never be tagged.
if [ "$MERGED" != "true" ]; then
  echo "Skip: pull request was closed without merging (merged=$MERGED)." >&2
  exit 10
fi

# Guard 2: target/base. Only a merge into the protected release branch
# represents a published plugin artifact.
if [ "$BASE_REF" != "$BASE_BRANCH" ]; then
  echo "Skip: merge base '$BASE_REF' is not '$BASE_BRANCH'." >&2
  exit 10
fi

# Guard 3: head branch must be a real publish candidate, not some other PR
# that happened to target release/plugins (the branch ruleset blocks direct
# writes there, but does not restrict which branch a PR's head may be).
# This also excludes a dry-run candidate branch, which uses a distinct
# prefix (see scripts/derive-plugin-candidate-branch.sh's --prefix) and must
# never produce a real tag even if someone merges its draft PR by mistake.
case "$HEAD_REF" in
  "${CANDIDATE_PREFIX}"/*) ;;
  *)
    echo "Skip: head branch '$HEAD_REF' does not start with the real candidate prefix '${CANDIDATE_PREFIX}/'." >&2
    exit 10
    ;;
esac

printf 'claude-plugin-v%s\n' "$VERSION"
