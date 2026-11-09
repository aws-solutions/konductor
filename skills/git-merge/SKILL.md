---
name: git-merge
description: 'Merges a feature or dev branch into the default branch with --no-ff --no-commit so the merge can be inspected and built before it is committed. Use for branch, release and sync merges, merge conflicts (lockfiles too), a half-done merge or a hotfix on two branches; if merges go through PRs, open a PR. The code-review skill opens PRs.'
version: 1.1.0
tags: [skill, git, merge, branch, default-branch, release]
---

# Git Merge

## Overview

Merge a feature branch into `<default-branch>` safely using `--no-ff --no-commit` for inspectable merge commits. Phases 1 and 2 are the merge itself. Phases 3 and 4 (tag, clean up) apply only when the user asks for them, so leave them out of a runbook written for someone else.

Use the repo's real branch names. If the default branch is `main`, every command and message says `main`.

## Usage

Use this skill when:

- Merging a feature branch into `<default-branch>`
- Merging dev into `<default-branch>`
- Performing release merges
- Resolving merge conflicts, including lockfiles and a merge left half-finished
- Choosing a merge strategy, such as a merge commit versus a fast-forward, or landing a hotfix on both a release branch and `<default-branch>`
- Any branch merge that should preserve history

Trigger words: `merge`, `merge branch`, `merge into main`, `merge into mainline`, `release merge`, `merge dev`

## Workflow

### Phase 1: Merge `<default-branch>` into feature branch first

Ensure the feature branch is up to date with `<default-branch>` before merging back.

```bash
git switch <default-branch>
git pull
git switch <feature_branch>
git merge --no-commit --no-ff <default-branch>
# Resolve conflicts, then run the pre-commit checks below
git commit -m "Merging <default-branch> into <feature_branch>"
git push origin <feature_branch>
```

### Phase 2: Merge feature branch into `<default-branch>`

Only when the repo merges locally rather than through PRs; otherwise open a PR (see `code-review`).

```bash
git switch <default-branch>
git pull
git merge --no-ff --no-commit <feature_branch>
# Fix any merge conflicts, verify build
git commit -m "Merging <feature_branch> into <default-branch>"
git push
```

### Before every commit and push

The merge is staged but not committed, so check it now:

```bash
git status                          # no "Unmerged paths" left
git diff --cached --check           # no leftover conflict markers or whitespace errors
git diff --cached -- <conflicted_file>   # read each file that conflicted
<build command> && <test command>   # use the repo's own, e.g. npm ci && npm test
```

Before pushing, `git log --oneline -3` should show the merge commit on top.

### Conflicts

- Source files: edit to keep both sides' intent, `git add <file>`, then read `git diff --cached -- <file>`.
- Lockfiles (`package-lock.json`, `yarn.lock`, `Cargo.lock`): don't hand-edit conflict markers. Take the default branch's copy and regenerate it, for example `git checkout --theirs package-lock.json && npm install && git add package-lock.json` when merging `<default-branch>` into the feature branch.
- To back out of a half-done merge: `git merge --abort`.

### If the push is rejected or the PR falls behind

Merge the newer work in the same way, re-check, then push again. Which ref to merge depends on what happened:

- **Push rejected:** someone pushed to the same branch first, so merge `origin/<current_branch>`.
- **PR behind:** the default branch moved on, so merge `origin/<default-branch>`.

```bash
git fetch origin
git merge --no-ff --no-commit origin/<ref>   # <current_branch> or <default-branch>, as above
# pre-commit checks again
git commit -m "Merging origin/<ref> into <current_branch>"
git push origin <current_branch>
```

Never force-push and never rebase a branch others have pulled; both rewrite history they already have. In a runbook, state that rule in words rather than as a command a reader could paste.

### Phase 3: Tag release (if applicable)

```bash
git tag v<version>
git push origin v<version>
```

### Phase 4: Clean up (optional)

```bash
git branch -d <feature_branch>        # delete local
git push -d origin <feature_branch>   # delete remote
```

## Merge Flags

| Flag          | Purpose                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| `--no-ff`     | Always create a merge commit (no fast-forward) to preserve branch history         |
| `--no-commit` | Stage the merge but don't commit, so you can inspect and build before committing |

## Quick Reference

| Task                      | Command                                            |
| ------------------------- | -------------------------------------------------- |
| Update `<default-branch>` | `git switch <default-branch> && git pull`          |
| Merge with inspection     | `git merge --no-ff --no-commit <branch>`           |
| Tag release               | `git tag v<version> && git push origin v<version>` |
| Delete local branch       | `git branch -d <branch>`                           |
| Delete remote branch      | `git push -d origin <branch>`                      |

## Quality Gate

**CRITICAL (block merge):**

- Merging into `<default-branch>` without `--no-ff` flag: branch history will be lost
- Merging into `<default-branch>` without pulling latest first: risks overwriting others' changes
- Skipping Phase 1 (merging `<default-branch>` into feature branch first): conflicts should be resolved on the feature branch, not `<default-branch>`
- Force pushing to `<default-branch>`, or rebasing a branch others have pulled

**IMPORTANT (fix before proceeding):**

- Not using `--no-commit` flag: prevents pre-commit inspection of merge result
- Not verifying build passes before committing the merge
- Merge commit message doesn't describe what was merged

**SUGGESTION:**

- Tag releases after merging to `<default-branch>` for traceability
- Clean up feature branches after successful merge to reduce clutter
- Verify tests pass on the feature branch after Phase 1 before proceeding to Phase 2
