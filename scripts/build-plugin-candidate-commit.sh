#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Builds the candidate-branch commit for release.yml's publish-claude-plugin
# job: a new branch, based on the base branch's (release/plugins) current
# remote tip, whose tree is exactly an already-assembled flat plugin tree.
#
# A prior revision built this commit with `git init` in a throwaway
# directory, so the candidate shared no history with release/plugins and
# `gh pr create` had no common ancestor to diff against. A later revision
# fixed that by checking the candidate branch out directly on top of
# <remote>/<base-branch>, then running `git rm -rq .` + `cp -a
# "$ASSEMBLE_DIR"/. .` + `git add -A` in the job's own checkout. That
# checkout is the same one `make -C cli build` and
# scripts/generate-claude-plugin.sh already ran in, so it carries
# untracked build output (cli/konductor-rs/target/, build/cli/konductor,
# dist/, generated/claude-plugin/). `git rm -rq .` also deletes the
# checked-out .gitignore, so `git add -A` picks that untracked output up
# alongside the assembled tree.
#
# This script builds the tree from --assemble-dir alone, through a scratch
# index the job's checkout never touches: `git add -A -f` (so no ignore rule
# can drop a file), then `git write-tree` and `git commit-tree`. Untracked
# output in the checkout can never reach the candidate. Before the no-op
# check, the tree must match --assemble-dir exactly: same paths, modes, and
# blob IDs from `git hash-object --no-filters`. A file dropped by an ignore
# rule or rewritten by git attributes fails the build.
#
# This script never pushes anything and never writes to the base branch:
# it only builds a commit on a new local branch ref in --repo-root's
# repository. The caller pushes that branch, by its own name only, after
# this script succeeds.
#
# If the assembled tree already matches the base branch's tip exactly,
# there's nothing to commit -- that's a legitimate outcome (e.g. a
# re-release of unchanged plugin content), not an error. This script
# reports which case happened via a `committed=true|false` line on stdout
# and, when $GITHUB_OUTPUT is set, as a step output of the same name, so a
# caller running as a GitHub Actions step can skip pushing a branch and
# opening a PR when there's nothing to publish.
#
# Usage: build-plugin-candidate-commit.sh \
#          --base-branch <branch> --candidate-branch <branch> \
#          --assemble-dir <dir> --commit-message <msg> \
#          [--repo-root <dir>] [--remote <name>] \
#          [--author-name <name>] [--author-email <email>]
set -euo pipefail

# shellcheck source=lib/protected-branches.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/protected-branches.sh"

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
"$(dirname "${BASH_SOURCE[0]}")/check-claude-plugin-tree.sh" "$ASSEMBLE_DIR"

if [ "$CANDIDATE_BRANCH" = "$BASE_BRANCH" ]; then
  echo "FATAL: --candidate-branch must not equal --base-branch ('$BASE_BRANCH'). Failing closed." >&2
  exit 1
fi
# Same defense-in-depth protected-ref check derive-plugin-candidate-branch.sh
# and validate-plugin-publish-preconditions.sh already apply before this
# script runs -- repeated here because this script must not trust that an
# earlier step enforced it correctly.
if is_protected_branch "$CANDIDATE_BRANCH"; then
  echo "FATAL: --candidate-branch '$CANDIDATE_BRANCH' equals a protected ref name. Failing closed." >&2
  exit 1
fi

cd "$REPO_ROOT"

# Resolved once, up front: every plumbing command below targets this
# repository's object store and refs explicitly via GIT_DIR, regardless of
# which directory it's invoked from (including the --assemble-dir subshell
# below).
GIT_DIR_ABS="$(git rev-parse --absolute-git-dir)"

# Explicit refspec, not a bare `git fetch <remote> <branch>` (which lands
# in FETCH_HEAD under some remote configs, not necessarily
# refs/remotes/<remote>/<branch>) -- this guarantees the remote-tracking
# ref below resolves regardless of how the caller's checkout configured
# origin's own fetch refspec.
git fetch -q "$REMOTE" "+refs/heads/$BASE_BRANCH:refs/remotes/$REMOTE/$BASE_BRANCH"
BASE_SHA="$(git rev-parse "$REMOTE/$BASE_BRANCH")"
BASE_TREE="$(git rev-parse "$BASE_SHA^{tree}")"

if git show-ref --verify --quiet "refs/heads/$CANDIDATE_BRANCH"; then
  echo "FATAL: local branch '$CANDIDATE_BRANCH' already exists. Refusing to overwrite it. Failing closed." >&2
  exit 1
fi

# The scratch index is never associated with $REPO_ROOT's own index or work
# tree, so nothing untracked in the checkout can be picked up.
SCRATCH_DIR="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_DIR"' EXIT
SCRATCH_INDEX="$SCRATCH_DIR/index"
(
  cd "$ASSEMBLE_DIR"
  GIT_INDEX_FILE="$SCRATCH_INDEX" GIT_DIR="$GIT_DIR_ABS" GIT_WORK_TREE="$ASSEMBLE_DIR" \
    git -c core.autocrlf=false -c core.fileMode=true -c core.symlinks=true add -A -f
)
ASSEMBLED_TREE="$(GIT_INDEX_FILE="$SCRATCH_INDEX" GIT_DIR="$GIT_DIR_ABS" git write-tree)"

# Prints "<mode> <blob>\t<path>" for each file and symlink under $1, like
# `git ls-tree -r` without the object type.
dir_listing() (
  cd "$1"
  hash_files() {
    local mode="$1" paths
    shift
    paths="$(find . -type f "$@" | sed 's|^\./||')"
    [ -n "$paths" ] || return 0
    printf '%s\n' "$paths" | GIT_DIR="$GIT_DIR_ABS" git hash-object --no-filters --stdin-paths \
      | sed "s/^/$mode /" | paste - <(printf '%s\n' "$paths")
  }
  hash_files 100755 -perm -u+x
  hash_files 100644 ! -perm -u+x
  find . -type l | sed 's|^\./||' | while IFS= read -r link; do
    printf '120000 %s\t%s\n' "$(printf '%s' "$(readlink "$link")" | GIT_DIR="$GIT_DIR_ABS" git hash-object --stdin)" "$link"
  done
)

TREE_LISTING="$(git -c core.quotePath=false ls-tree -r "$ASSEMBLED_TREE" | sed 's/^\([0-7]*\) [a-z]* /\1 /' | LC_ALL=C sort)"
ASSEMBLE_DIR_LISTING="$(dir_listing "$ASSEMBLE_DIR" | LC_ALL=C sort)"
if [ "$TREE_LISTING" != "$ASSEMBLE_DIR_LISTING" ]; then
  echo "FATAL: the candidate tree does not match --assemble-dir's paths, modes, and contents exactly. Failing closed." >&2
  echo "--- only in candidate tree ---" >&2
  comm -23 <(printf '%s\n' "$TREE_LISTING") <(printf '%s\n' "$ASSEMBLE_DIR_LISTING") >&2
  echo "--- only in --assemble-dir ---" >&2
  comm -13 <(printf '%s\n' "$TREE_LISTING") <(printf '%s\n' "$ASSEMBLE_DIR_LISTING") >&2
  exit 1
fi

if [ "$ASSEMBLED_TREE" = "$BASE_TREE" ]; then
  echo "Candidate branch '$CANDIDATE_BRANCH' has no changes relative to $REMOTE/$BASE_BRANCH ($BASE_SHA); nothing to commit."
  echo "committed=false"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "committed=false" >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi

# Based directly on the base branch's current tip, not a disconnected
# root -- this is what gives the branch a real merge base with
# release/plugins, so GitHub can diff and open a pull request against it.
NEW_COMMIT="$(git -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" commit-tree "$ASSEMBLED_TREE" -p "$BASE_SHA" -m "$COMMIT_MESSAGE")"

# The empty old value makes update-ref fail if the branch appeared meanwhile.
git update-ref "refs/heads/$CANDIDATE_BRANCH" "$NEW_COMMIT" ""
echo "Built candidate commit $NEW_COMMIT on branch '$CANDIDATE_BRANCH', based on $REMOTE/$BASE_BRANCH ($BASE_SHA)."
echo "committed=true"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "committed=true" >> "$GITHUB_OUTPUT"
fi
