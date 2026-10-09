---
name: git-merge
description: 'Use when merging branches, every time: a feature or dev branch into main, or a release merge ("merge", "merge branch", "merge into main", "release merge", "merge dev"). Runs the standard four-phase merge with `--no-ff --no-commit`, so the merge can be inspected before it is committed; mandatory for merges.'
version: 1.0.0
tags: [skill, git, merge, branch, main, release]
---

# Git Merge

## Overview

Merge a feature branch into main safely using `--no-ff --no-commit` for inspectable merge commits. The commands use `main` for the default branch; use the repository's own default branch name if it differs. This skill defines the standard 4-phase merge workflow that preserves branch history and allows pre-commit inspection.

## Usage

Use this skill when:

- Merging a feature branch into main
- Merging dev into main
- Performing release merges
- Any branch merge that should preserve history

Trigger words: `merge`, `merge branch`, `merge into main`, `release merge`, `merge dev`

## Workflow

### Phase 1: Merge main into feature branch first

Ensure the feature branch is up to date with main before merging back.

```bash
git switch main
git pull
git switch <feature_branch>
git merge --no-commit --no-ff main
# Fix any merge conflicts
git commit -m "Merging main into <feature_branch>"
git push
```

### Phase 2: Merge feature branch into main

```bash
git switch main
git pull
git merge --no-ff --no-commit <feature_branch>
# Fix any merge conflicts, verify build
git commit -m "Merging <feature_branch> into main"
git push
```

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

| Flag          | Purpose                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| `--no-ff`     | Always create a merge commit (no fast-forward), preserving branch history       |
| `--no-commit` | Stage the merge but don't commit, so you can inspect and build before committing |

## Anti-Patterns

1. **NEVER** fast-forward merge into main. Always use `--no-ff`
2. **NEVER** merge into main without pulling latest first
3. **NEVER** skip merging main into feature branch first
4. **NEVER** force push to main

## Quick Reference

| Task                  | Command                                            |
| --------------------- | -------------------------------------------------- |
| Update main       | `git switch main && git pull`                  |
| Merge with inspection | `git merge --no-ff --no-commit <branch>`           |
| Tag release           | `git tag v<version> && git push origin v<version>` |
| Delete local branch   | `git branch -d <branch>`                           |
| Delete remote branch  | `git push -d origin <branch>`                      |

## Quality Gate

**CRITICAL (block merge):**

- Merging into main without `--no-ff` flag: branch history will be lost
- Merging into main without pulling latest first: risks overwriting others' changes
- Skipping Phase 1 (merging main into feature branch first): conflicts should be resolved on the feature branch, not main
- Force pushing to main

**IMPORTANT (fix before proceeding):**

- Not using `--no-commit` flag: prevents pre-commit inspection of merge result
- Not verifying build passes before committing the merge
- Merge commit message doesn't describe what was merged

**SUGGESTION:**

- Tag releases after merging to main for traceability
- Clean up feature branches after successful merge to reduce clutter
- Verify tests pass on the feature branch after Phase 1 before proceeding to Phase 2
