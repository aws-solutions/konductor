---
name: git-merge
description: "MUST USE for merging branches. Feature branch into mainline, dev into mainline, release merges. Triggers: 'merge', 'merge branch', 'merge into mainline', 'release merge', 'merge dev'."
version: 1.0.0
tags: [skill, git, merge, branch, mainline, release]
---

# Git Merge

## Overview

Merge a feature branch into `<default-branch>` safely using `--no-ff --no-commit` for inspectable merge commits. This skill defines the standard 4-phase merge workflow that preserves branch history and allows pre-commit inspection.

## Usage

Use this skill when:

- Merging a feature branch into `<default-branch>`
- Merging dev into `<default-branch>`
- Performing release merges
- Any branch merge that should preserve history

Trigger words: `merge`, `merge branch`, `merge into mainline`, `release merge`, `merge dev`

## Workflow

### Phase 1: Merge `<default-branch>` into feature branch first

Ensure the feature branch is up to date with `<default-branch>` before merging back.

```bash
git switch <default-branch>
git pull
git switch <feature_branch>
git merge --no-commit --no-ff <default-branch>
# Fix any merge conflicts
git commit -m "Merging <default-branch> into <feature_branch>"
git push
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
| `--no-ff`     | Always create a merge commit (no fast-forward) — preserves branch history       |
| `--no-commit` | Stage the merge but don't commit — lets you inspect and build before committing |

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
- Force pushing to `<default-branch>`

**IMPORTANT (fix before proceeding):**

- Not using `--no-commit` flag — prevents pre-commit inspection of merge result
- Not verifying build passes before committing the merge
- Merge commit message doesn't describe what was merged

**SUGGESTION:**

- Tag releases after merging to `<default-branch>` for traceability
- Clean up feature branches after successful merge to reduce clutter
- Verify tests pass on the feature branch after Phase 1 before proceeding to Phase 2
