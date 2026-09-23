---
name: git-merge
description: "MUST USE for merging branches. Feature branch into mainline, dev into mainline, release merges. Triggers: 'merge', 'merge branch', 'merge into mainline', 'release merge', 'merge dev'."
version: 1.0.0
tags: [skill, git, merge, branch, mainline, release]
---

# Git Merge

## Overview

Merge a feature branch into mainline safely using `--no-ff --no-commit` for inspectable merge commits. This skill defines the standard 4-phase merge workflow that preserves branch history and allows pre-commit inspection.

## Usage

Use this skill when:

- Merging a feature branch into mainline
- Merging dev into mainline
- Performing release merges
- Any branch merge that should preserve history

Trigger words: `merge`, `merge branch`, `merge into mainline`, `release merge`, `merge dev`

## Workflow

### Phase 1: Merge mainline into feature branch first

Ensure the feature branch is up to date with mainline before merging back.

```bash
git switch mainline
git pull
git switch <feature_branch>
git merge --no-commit --no-ff mainline
# Fix any merge conflicts
git commit -m "Merging mainline into <feature_branch>"
git push
```

### Phase 2: Merge feature branch into mainline

```bash
git switch mainline
git pull
git merge --no-ff --no-commit <feature_branch>
# Fix any merge conflicts, verify build
git commit -m "Merging <feature_branch> into mainline"
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

## Anti-Patterns

1. **NEVER** fast-forward merge into mainline — always use `--no-ff`
2. **NEVER** merge into mainline without pulling latest first
3. **NEVER** skip merging mainline into feature branch first
4. **NEVER** force push to mainline

## Quick Reference

| Task                  | Command                                            |
| --------------------- | -------------------------------------------------- |
| Update mainline       | `git switch mainline && git pull`                  |
| Merge with inspection | `git merge --no-ff --no-commit <branch>`           |
| Tag release           | `git tag v<version> && git push origin v<version>` |
| Delete local branch   | `git branch -d <branch>`                           |
| Delete remote branch  | `git push -d origin <branch>`                      |

## Quality Gate

**CRITICAL (block merge):**

- Merging into mainline without `--no-ff` flag — branch history will be lost
- Merging into mainline without pulling latest first — risks overwriting others' changes
- Skipping Phase 1 (merging mainline into feature branch first) — conflicts should be resolved on the feature branch, not mainline
- Force pushing to mainline

**IMPORTANT (fix before proceeding):**

- Not using `--no-commit` flag — prevents pre-commit inspection of merge result
- Not verifying build passes before committing the merge
- Merge commit message doesn't describe what was merged

**SUGGESTION:**

- Tag releases after merging to mainline for traceability
- Clean up feature branches after successful merge to reduce clutter
- Verify tests pass on the feature branch after Phase 1 before proceeding to Phase 2
