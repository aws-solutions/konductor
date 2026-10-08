#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Builds the candidate-branch commit shared by release.yml's
# publish-claude-plugin job and plugin-publish-dry-run.yml: a new branch,
# based on the base branch's (release/plugins) current remote tip, whose
# tree is replaced wholesale with an already-assembled flat plugin tree.
#
# A prior revision built this commit with `git init` in a throwaway
# directory, so the candidate shared no history with release/plugins and
# `gh pr create` had no common ancestor to diff against. This script fixes
# that: the candidate is checked out directly on top of
# <remote>/<base-branch>, so the resulting commit's parent is release/
# plugins' own tip -- a real merge base, not a disconnected root.
#
# Every previously tracked path is removed before the assembled tree is
# copied in, so the resulting commit's tree is exactly the assembled
# tree's contents regardless of what release/plugins currently contains --
# a merge of this candidate always leaves release/plugins an artifact-only
# tree, never retaining source-tree leftovers from its own history.
#
# This script never pushes anything and never writes to the base branch:
# it only builds a commit on a new local branch. The caller pushes that
# branch, by its own name only, after this script succeeds.
#
# Usage: build-plugin-candidate-commit.sh \
#          --base-branch <branch> --candidate-branch <branch> \
#          --assemble-dir <dir> --commit-message <msg> \
#          [--repo-root <dir>] [--remote <name>] \
#          [--author-name <name>] [--author-email <email>]
set -euo pipefail

REPO_ROOT="."
REMOTE="origin"
BASE_BRANCH=""
CANDIDATE_BRANCH=""
ASSEMBLE_DIR=""
COMMIT_MESSAGE=""
AUTHOR_NAME="github-actions[bot]"
AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo-root)
      [ $# -ge 2 ] || { echo "build-plugin-candidate-commit.sh: --repo-root requires an argument" >&2; exit 64; }
      REPO_ROOT="$2"
      shift 2
      ;;
    --remote)
      [ $# -ge 2 ] || { echo "build-plugin-candidate-commit.sh: --remote requires an argument" >&2; exit 64; }
      REMOTE="$2"
      shift 2
      ;;
    --base-branch)
      [ $# -ge 2 ] || { echo "build-plugin-candidate-commit.sh: --base-branch requires an argument" >&2; exit 64; }
      BASE_BRANCH="$2"
      shift 2
      ;;
    --candidate-branch)
      [ $# -ge 2 ] || { echo "build-plugin-candidate-commit.sh: --candidate-branch requires an argument" >&2; exit 64; }
      CANDIDATE_BRANCH="$2"
      shift 2
      ;;
    --assemble-dir)
      [ $# -ge 2 ] || { echo "build-plugin-candidate-commit.sh: --assemble-dir requires an argument" >&2; exit 64; }
      ASSEMBLE_DIR="$2"
      shift 2
      ;;
    --commit-message)
      [ $# -ge 2 ] || { echo "build-plugin-candidate-commit.sh: --commit-message requires an argument" >&2; exit 64; }
      COMMIT_MESSAGE="$2"
      shift 2
      ;;
    --author-name)
      [ $# -ge 2 ] || { echo "build-plugin-candidate-commit.sh: --author-name requires an argument" >&2; exit 64; }
      AUTHOR_NAME="$2"
      shift 2
      ;;
    --author-email)
      [ $# -ge 2 ] || { echo "build-plugin-candidate-commit.sh: --author-email requires an argument" >&2; exit 64; }
      AUTHOR_EMAIL="$2"
      shift 2
      ;;
    *)
      echo "build-plugin-candidate-commit.sh: unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [ -z "$BASE_BRANCH" ] || [ -z "$CANDIDATE_BRANCH" ] || [ -z "$ASSEMBLE_DIR" ] || [ -z "$COMMIT_MESSAGE" ]; then
  echo "build-plugin-candidate-commit.sh: --base-branch, --candidate-branch, --assemble-dir, and --commit-message are all required" >&2
  exit 64
fi

if [ ! -d "$ASSEMBLE_DIR" ]; then
  echo "FATAL: --assemble-dir '$ASSEMBLE_DIR' does not exist or is not a directory. Failing closed." >&2
  exit 1
fi
# Resolve before cd'ing into --repo-root below -- a relative --assemble-dir
# would otherwise point at the wrong place once the working directory
# changes.
ASSEMBLE_DIR="$(cd "$ASSEMBLE_DIR" && pwd)"

if [ "$CANDIDATE_BRANCH" = "$BASE_BRANCH" ]; then
  echo "FATAL: --candidate-branch must not equal --base-branch ('$BASE_BRANCH'). Failing closed." >&2
  exit 1
fi
# Same defense-in-depth protected-ref check derive-plugin-candidate-branch.sh
# and validate-plugin-publish-preconditions.sh already apply before this
# script runs -- repeated here because this script must not trust that an
# earlier step enforced it correctly.
case "$CANDIDATE_BRANCH" in
  main|mainline|release/plugins)
    echo "FATAL: --candidate-branch '$CANDIDATE_BRANCH' equals a protected ref name. Failing closed." >&2
    exit 1
    ;;
esac

cd "$REPO_ROOT"

# Discard any uncommitted tracked-file changes earlier workflow steps left
# behind (e.g. release.yml writes a release-tag-derived VERSION into the
# checkout before this script runs) -- without this, switching to the base
# branch's tip below can conflict with those local modifications.
git reset -q --hard

# Explicit refspec, not a bare `git fetch <remote> <branch>` (which lands
# in FETCH_HEAD under some remote configs, not necessarily
# refs/remotes/<remote>/<branch>) -- this guarantees the remote-tracking
# ref below resolves regardless of how the caller's checkout configured
# origin's own fetch refspec.
git fetch -q "$REMOTE" "+refs/heads/$BASE_BRANCH:refs/remotes/$REMOTE/$BASE_BRANCH"
BASE_SHA="$(git rev-parse "$REMOTE/$BASE_BRANCH")"

if git show-ref --verify --quiet "refs/heads/$CANDIDATE_BRANCH"; then
  echo "FATAL: local branch '$CANDIDATE_BRANCH' already exists. Refusing to overwrite it. Failing closed." >&2
  exit 1
fi

# Base the candidate directly on the base branch's current tip, not a
# disconnected root -- this is what gives the branch a real merge base
# with release/plugins, so GitHub can diff and open a pull request
# against it.
git checkout -q -b "$CANDIDATE_BRANCH" "$REMOTE/$BASE_BRANCH"

# Clear every tracked path from the new branch before overlaying the
# assembled artifact, so the resulting tree is exactly the artifact's
# contents -- never a mix of the artifact and whatever release/plugins
# happened to contain already.
if [ -n "$(git ls-files)" ]; then
  git rm -rq .
fi

cp -a "$ASSEMBLE_DIR"/. .
git add -A

if git diff --cached --quiet; then
  echo "Candidate branch '$CANDIDATE_BRANCH' has no changes relative to $REMOTE/$BASE_BRANCH ($BASE_SHA); nothing to commit."
  exit 0
fi

git -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" commit -q -m "$COMMIT_MESSAGE"
echo "Built candidate commit $(git rev-parse HEAD) on branch '$CANDIDATE_BRANCH', based on $REMOTE/$BASE_BRANCH ($BASE_SHA)."
