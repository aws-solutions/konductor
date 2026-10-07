#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Fail-closed precondition checks run before the plugin-publish workflow
# pushes a candidate branch. Each check queries the remote directly (no
# local clone state is trusted) so a stale checkout can never mask a real
# collision. Every failure path exits non-zero with a message on stderr and
# never echoes GH_TOKEN or any other credential.
#
# Usage: validate-plugin-publish-preconditions.sh \
#          --repo <owner/name> \
#          --expected-ref <tag-or-branch> \
#          --candidate-branch <branch> \
#          --tag <tag-name> \
#          [--remote-url <url>]
#
# --remote-url overrides the derived https://github.com/<repo>.git URL --
# intended for tests, which point it at a disposable local bare repo instead
# of the real remote. Omit it in production use; --repo alone is sufficient
# there.
#
# --expected-ref is compared by commit SHA, not by name: release.yml checks
# out the release tag (detached HEAD), so comparing `git rev-parse
# --abbrev-ref HEAD` against a branch name would always fail there. SHA
# equality is also the stronger property -- it confirms the checkout really
# is the commit the caller thinks it is, not just a same-named ref that
# could have moved.
#
# Requires GH_TOKEN in the environment (used only by `gh`, never printed).
set -euo pipefail

REPO=""
EXPECTED_REF=""
CANDIDATE_BRANCH=""
TAG=""
REMOTE_URL_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      [ $# -ge 2 ] || { echo "validate-plugin-publish-preconditions.sh: --repo requires an argument" >&2; exit 64; }
      REPO="$2"
      shift 2
      ;;
    --expected-ref)
      [ $# -ge 2 ] || { echo "validate-plugin-publish-preconditions.sh: --expected-ref requires an argument" >&2; exit 64; }
      EXPECTED_REF="$2"
      shift 2
      ;;
    --candidate-branch)
      [ $# -ge 2 ] || { echo "validate-plugin-publish-preconditions.sh: --candidate-branch requires an argument" >&2; exit 64; }
      CANDIDATE_BRANCH="$2"
      shift 2
      ;;
    --tag)
      [ $# -ge 2 ] || { echo "validate-plugin-publish-preconditions.sh: --tag requires an argument" >&2; exit 64; }
      TAG="$2"
      shift 2
      ;;
    --remote-url)
      [ $# -ge 2 ] || { echo "validate-plugin-publish-preconditions.sh: --remote-url requires an argument" >&2; exit 64; }
      REMOTE_URL_OVERRIDE="$2"
      shift 2
      ;;
    *)
      echo "validate-plugin-publish-preconditions.sh: unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [ -z "$REPO" ] || [ -z "$EXPECTED_REF" ] || [ -z "$CANDIDATE_BRANCH" ] || [ -z "$TAG" ]; then
  echo "validate-plugin-publish-preconditions.sh: --repo, --expected-ref, --candidate-branch, and --tag are all required" >&2
  exit 64
fi
if [ -z "${GH_TOKEN:-}" ]; then
  echo "FATAL: GH_TOKEN is not set. Failing closed." >&2
  exit 1
fi

if [ -n "$REMOTE_URL_OVERRIDE" ]; then
  REMOTE_URL="$REMOTE_URL_OVERRIDE"
else
  REMOTE_URL="https://github.com/${REPO}.git"
fi

# 1. Expected source/base ref check: the checked-out commit must be exactly
# the commit --expected-ref resolves to locally (the caller's checkout step
# must already have fetched it, e.g. via fetch-depth: 0). Catches a
# misconfigured `ref:` or an accidental run against the wrong checkout.
if ! EXPECTED_SHA="$(git rev-parse "$EXPECTED_REF" 2>&1)"; then
  echo "FATAL: expected ref '$EXPECTED_REF' does not resolve in the local checkout. Failing closed." >&2
  echo "$EXPECTED_SHA" >&2
  exit 1
fi
ACTUAL_SHA="$(git rev-parse HEAD)"
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "FATAL: checked-out commit '$ACTUAL_SHA' does not match expected ref '$EXPECTED_REF' ('$EXPECTED_SHA'). Failing closed." >&2
  exit 1
fi

# 2. The candidate branch must never equal a protected ref. Redundant with
# derive-plugin-candidate-branch.sh's own check, but this script is the
# single fail-closed gate immediately before the push -- it must not trust
# that an earlier step enforced this correctly.
case "$CANDIDATE_BRANCH" in
  main|mainline|release/plugins)
    echo "FATAL: candidate branch '$CANDIDATE_BRANCH' equals a protected ref name. Failing closed." >&2
    exit 1
    ;;
esac
if ! git check-ref-format "refs/heads/$CANDIDATE_BRANCH" >/dev/null 2>&1; then
  echo "FATAL: candidate branch '$CANDIDATE_BRANCH' is not a valid git ref name. Failing closed." >&2
  exit 1
fi

# 3. Existing candidate branch collision check: the derived name includes
# the run id/attempt specifically to make this exceedingly unlikely, but a
# manually created branch of the same name (or a retained branch from a
# dry run that was not cleaned up) must still block the push rather than be
# silently overwritten.
#
# `git ls-remote --exit-code` returns 0 (ref found), 2 (ref not found -- the
# only "safe to proceed" outcome), or any other code for a real error
# (network, auth, repo-not-found). Checking only the `if` truthiness of the
# command would treat exit 2 and, say, exit 128 identically as "no
# collision" -- that is fail-open on an infra error, the opposite of this
# script's purpose. Capture the exit code explicitly and branch on it.
set +e
BRANCH_LOOKUP_OUTPUT="$(git ls-remote --exit-code --heads "$REMOTE_URL" "refs/heads/$CANDIDATE_BRANCH" 2>&1)"
BRANCH_LOOKUP_STATUS=$?
set -e
case "$BRANCH_LOOKUP_STATUS" in
  0)
    echo "FATAL: candidate branch '$CANDIDATE_BRANCH' already exists on the remote. Refusing to overwrite it. Failing closed." >&2
    exit 1
    ;;
  2)
    : # Not found -- safe to proceed.
    ;;
  *)
    echo "FATAL: could not confirm candidate branch '$CANDIDATE_BRANCH' is available (ls-remote exited $BRANCH_LOOKUP_STATUS). Failing closed rather than risk a false negative on an infra error." >&2
    echo "$BRANCH_LOOKUP_OUTPUT" >&2
    exit 1
    ;;
esac

# 4. Tag collision check: plugin-release-tags only permits tag creation
# (update/delete/non-fast-forward are blocked by that ruleset), so a
# preexisting tag of this name means a prior release already claimed it --
# the workflow must not attempt to reuse it. Same exit-code handling as the
# branch check above.
set +e
TAG_LOOKUP_OUTPUT="$(git ls-remote --exit-code --tags "$REMOTE_URL" "refs/tags/$TAG" 2>&1)"
TAG_LOOKUP_STATUS=$?
set -e
case "$TAG_LOOKUP_STATUS" in
  0)
    echo "FATAL: tag '$TAG' already exists. Refusing to reuse an existing plugin release tag. Failing closed." >&2
    exit 1
    ;;
  2)
    : # Not found -- safe to proceed.
    ;;
  *)
    echo "FATAL: could not confirm tag '$TAG' is available (ls-remote exited $TAG_LOOKUP_STATUS). Failing closed rather than risk a false negative on an infra error." >&2
    echo "$TAG_LOOKUP_OUTPUT" >&2
    exit 1
    ;;
esac

echo "All plugin-publish preconditions passed: checkout matches expected ref '$EXPECTED_REF' ('$EXPECTED_SHA'), candidate branch '$CANDIDATE_BRANCH' is available, tag '$TAG' is available."
