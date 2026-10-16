---
name: git-workflow
description: Git workflow patterns for atomic commits, branch management, and history operations. Use when committing changes, managing branches, or searching git history.
version: 1.0.0
tags: [skill, git, workflow, commits, branches]
---

# Git Workflow

## Overview

Standard git workflow patterns for atomic commits, branch management, and history operations. Ensures clean, traceable history across projects.

## Usage

Use this skill when:

- Committing changes to a repository
- Creating or managing feature branches
- Searching git history for debugging or auditing
- Reviewing what changed before submitting a pull request

## Commit Standards

### Atomic Commits

Each commit must contain exactly one logical change. Split work into separate commits:

- One commit per bug fix
- One commit per feature addition
- One commit per refactor
- Never mix formatting changes with logic changes

### Conventional Commit Messages

Format: `<type>(<scope>): <description>`

| Type       | When to Use                                |
| ---------- | ------------------------------------------ |
| `feat`     | New feature or capability                  |
| `fix`      | Bug fix                                    |
| `refactor` | Code restructuring without behavior change |
| `test`     | Adding or updating tests                   |
| `docs`     | Documentation changes                      |
| `chore`    | Build config, dependencies, tooling        |

Examples:

- `feat(api): add ListNetworkDevices operation`
- `fix(dynamodb): add condition expression to prevent overwrites`
- `refactor(handler): extract validation into shared utility`

### Commit Hygiene

- Imperative mood: "add feature" not "added feature"
- Subject line under 72 characters
- Every commit must compile and pass tests

## Branch Management

- Branch from `main` for new work
- Naming: `<type>/<short-description>` (e.g., `feat/network-monitoring`, `fix/throttling-retry`)
- Keep branches short-lived — merge within days, not weeks
- Rebase on main before submitting a PR

## History Operations

| Command                     | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `git log --oneline -20`     | Recent commit history                    |
| `git log --author=<alias>`  | Commits by author                        |
| `git blame <file>`          | Line-by-line attribution                 |
| `git bisect start/bad/good` | Binary search for regression             |
| `git log -S "<string>"`     | Find commits that added/removed a string |

Use `git status` and `git diff` first to get current status, then targeted git commands for deeper investigation.

## Tools

| Tool          | Purpose                                        |
| ------------- | ---------------------------------------------- |
| Shell (`git`) | Direct git commands for history, blame, bisect |

## Quality Gate

**CRITICAL:** Non-atomic commit mixing unrelated changes. Commit that breaks compilation or tests. Committing secrets or credentials.

**IMPORTANT:** Commit message not following conventional format. Branch not rebased before PR. Feature branch older than 2 weeks without merge.

**SUGGESTION:** Could improve commit message description. Could split large commit further.
