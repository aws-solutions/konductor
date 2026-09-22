# Code Review Workflow

## Overview

This SOP runs a comprehensive multi-skill code review across backend, frontend, and infrastructure files. It discovers changed files, categorizes them, runs the appropriate review skill per category, critiques findings to eliminate false positives, and consolidates into a single prioritized report.

## Parameters

- **source_dir** (required): Path to the source directory to review
- **review_type** (optional, default: `all`): Scope — `backend`, `frontend`, `infra`, or `all`
- **output_file** (optional, default: `code-review-report.md`): File to write the consolidated report
- **cr_url** (optional): URL of the code review, forwarded to `k-adversarial-pull-request-review` as its `pr_url` in Step 6. When absent, Step 6 runs without a URL and its review is diff-only.
- **base_branch** (optional): Branch to diff against. If not provided, You MUST resolve the remote's default branch first and use it if found, falling back to `main` only if the remote default cannot be resolved. Trying `main` first would let a stale, abandoned `main` win over a repo's real trunk whenever both exist. To resolve the remote's default branch, You MUST run `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` and strip the `origin/` prefix; if that returns nothing, You MUST fall back to `git ls-remote --symref origin HEAD` and parse the branch name from its `ref: refs/heads/<branch>` line, since the local symref is frequently unset in shallow or single-ref checkouts. If neither lookup resolves a branch name, You MUST fall back to `main`.

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding

## Steps

### 1. Discover Changed Files

Identify files to review via git diff or directory scan.

**Constraints:**

- You MUST run `git diff base_branch...HEAD` (three-dot, merge-base form) if `base_branch` is provided, else `git diff <default_branch>...HEAD` using the remote's resolved default branch, falling back to `git diff main...HEAD` only if that cannot be resolved, within `source_dir`, to capture the full diff content (hunks), from which the changed-file list is derived
- If not in a git repository at all (`git rev-parse --is-inside-work-tree` fails or returns false), You MUST fall back to listing all files under `source_dir` recursively (e.g. via `find` or a recursive glob), applying the same exclusions as the line below, and treating every remaining file as "changed" for categorization purposes in Step 2. If in a git repository, treat the diff target as unresolved only when running the resolved `git diff <target>...HEAD` command itself fails because that target does not exist as a ref. When that happens, You MUST report it explicitly rather than silently falling through to this recursive-scan fallback, then ask the caller for `base_branch` if a reply channel is available; in an unattended run with no reply channel, You MUST use the recursive-scan fallback above instead, stating in the report that the diff target was unresolved and every file under `source_dir` was treated as changed.
- You MUST exclude: `node_modules/`, `build/`, `dist/`, `cdk.out/`, lock files, `.js.map` files

**Expected Output:** Full diff content (hunks) and the list of changed files derived from it for categorization

### 2. Categorize Files

Sort files into backend, frontend, and infra categories.

**Constraints:**

- **Backend**: `.ts`/`.js` files in paths matching `**/handler*`, `**/service*`, `**/repository*`, `**/lambda*`, `**/util*`, `**/middleware*`
- **Frontend**: `.tsx`/`.jsx` files, and `.ts` files in `**/component*`, `**/page*`, `**/hook*`
- **Infra**: `.ts` files in `**/cdk*`, `**/stack*`, `**/construct*`, `**/infra*`
- Files matching multiple categories: apply priority **infra > frontend > backend**
- If `review_type` is not `all`, You MUST only include files matching that category

**Expected Output:** Categorized file lists: backend, frontend, infra, uncategorized

### 3. Run Applicable Review Skills

Run `backend-review`, `frontend-review`, and/or `infra-validation` on their respective file categories.

**Constraints:**

- You MUST run `backend-review` on backend files (skip if none found or excluded by `review_type`)
- You MUST run `frontend-review` on frontend files (skip if none found or excluded by `review_type`)
- You MUST run `infra-validation` on infra files (skip if none found or excluded by `review_type`)

**Expected Output:** Review findings per category with severity levels

### 4. Consolidate Findings

Merge all findings into a single prioritized list.

**Constraints:**

- You MUST sort findings: CRITICAL → IMPORTANT → SUGGESTION
- You MUST deduplicate findings that appear across multiple skills
- You MUST include file path and line reference for each finding

**Expected Output:** Consolidated, deduplicated, prioritized findings list

### 5. Critique Findings

Validate each finding to eliminate false positives. When in doubt, reject — false positives erode trust.

**Constraints:**

- You MUST reject findings that: praise correct code, speculate about unseen code, flag style-only issues, duplicate findings already reported by a linter run in this workflow, or give vague suggestions without concrete fixes
- You MUST reject findings where the referenced code doesn't match the actual diff
- You MUST verify each finding is actionable — it must state the problem, why it matters, and a concrete fix
- You MUST re-sort surviving findings: CRITICAL → IMPORTANT → SUGGESTION

**Expected Output:** Filtered findings list with false positives removed

### 6. Adversarial Review

If `k-adversarial-pull-request-review` is available, spawn `k-architect` in adversarial mode with it, passing the same diff used in Step 1 as `diff_input`, to surface gaps missed by standard review.

**Constraints:**

- You MUST skip this step if `k-adversarial-pull-request-review` is unavailable, or if `review_type` is `frontend` only (adversarial review targets backend/infra gaps)
- You MUST pass the same diff used in Step 1 as `diff_input`
- If the k-code-review-workflow was invoked with a CR URL, You MUST also pass it to `k-adversarial-pull-request-review` as its `pr_url` parameter — that is the name that SOP declares, and passing `cr_url` instead leaves it unset so the review degrades to diff-only. Do not send it to `adversarial-cr-review`, a different SOP that declares `cr_url`; on agents where both are loadable, name the target by filename.
- You MUST apply the same false-positive criteria from Step 5 to adversarial findings before merging them
- You MUST merge any new CRITICAL or IMPORTANT findings into the consolidated list from Step 5
- You MUST NOT re-report findings already present in the consolidated list

**Expected Output:** Consolidated findings list updated with any adversarial CRITICAL/IMPORTANT additions

### 7. Generate Review Report

Write the consolidated report to the output file.

**Constraints:**

- You MUST write the report to `output_file` structured as:

  ```
  # Code Review Report
  Date: [current date]
  Files reviewed: [count by category]
  ## Summary
  [CRITICAL: N | IMPORTANT: N | SUGGESTION: N]
  ## Critical Issues
  [Numbered list with file:line references]
  ## Important Issues
  [Numbered list]
  ## Suggestions
  [Numbered list]
  ```

- You MUST state the verdict: READY FOR CR / NEEDS FIXES
- You MUST NOT print the full report in your response — reference the file

**Expected Output:** Report file at `output_file` with verdict and finding counts
