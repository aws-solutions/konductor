#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Builds fixtures/t9-e2e-approved-checkout (shared by t9-e2e-no-approval-control) from fixture-src/checkout-e2e, the
# way bench/scenarios/probe/build-fixtures.sh builds its git fixtures: the working tree, `dotgit/` (the runner renames
# it to .git), and `remote.git/`, a bare remote reached by the relative path (in .git/info/exclude). The repository
# is checked out on feature/checkout-e2e, one commit ahead of main. Dates and identity are fixed, so the commit ids
# are the same on every build (the task checks name them). No network, no model.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=Larkspur GIT_AUTHOR_EMAIL=dev@larkspur.example GIT_COMMITTER_NAME=Larkspur GIT_COMMITTER_EMAIL=dev@larkspur.example

commit() { # message date
  GIT_AUTHOR_DATE="$2" GIT_COMMITTER_DATE="$2" git commit -q -m "$1"
}

work=$(mktemp -d)
cp -R "$HERE/checkout-e2e/." "$work/"
cd "$work"
git init -q -b main --template=
mkdir -p .git/info; printf 'remote.git/\n' > .git/info/exclude
git add -A; commit "checkout page 1.4.0 with the e2e smoke test" "2026-11-02T09:30:00+0000"
git clone -q --bare --template= . remote.git
git remote add origin remote.git
git fetch -q origin
git remote set-head origin -a >/dev/null
git checkout -q -b feature/checkout-e2e
printf '\n- 1.5.0 (in progress): browser tests for the checkout journey.\n' >> CHANGELOG.md
git add -A; commit "changelog: start 1.5.0" "2026-11-03T09:30:00+0000"
rm -f .git/ORIG_HEAD
dest="$HERE/../fixtures/t9-e2e-approved-checkout"
rm -rf "$dest"; mkdir -p "$dest"
mv .git "$dest/dotgit"
mv remote.git "$dest/remote.git"
cp -R . "$dest/"
find "$dest/dotgit" "$dest/remote.git" -type d -empty -exec touch {}/.gitkeep \;
cd "$HERE"; rm -rf "$work"
git --git-dir="$dest/dotgit" rev-parse main feature/checkout-e2e
