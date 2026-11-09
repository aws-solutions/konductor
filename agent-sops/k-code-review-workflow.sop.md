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

Write the Step 7 report from the Step 5 list, then end your result with a handoff note for the orchestrator: "Run `k-adversarial-pull-request-review` on the Step 1 diff with `diff_input` = that diff and `output_file` = this report's `output_file` with `-adversarial` added before its extension (for the default `code-review-report.md`, `code-review-report-adversarial.md`); then state its verdict and report path next to this report's verdict and update this report's two lines yourself or through the report's owner (`k-developer`), as your direct-work rules allow: replace this report's `Adversarial pass:` line with `Adversarial pass: complete (<path>)` and, when this report's `Verdict:` line reads `PENDING ADVERSARIAL PASS`, set it by the Step 7 rule: `NEEDS FIXES` if the adversarial report lists any CRITICAL or IMPORTANT finding, otherwise `READY FOR CR`." Include in the note the Step 1 diff as `diff_input` or the command that reproduces it, and `pr_url` set to the `cr_url` value if one was given, since that is the name `k-adversarial-pull-request-review` declares. The orchestrator coordinates that SOP; on a direct run with no orchestrator, the note goes to the user.

**Constraints:**

- You MUST skip this step only if `review_type` is `frontend` only (adversarial review targets backend/infra gaps); then continue to Step 7 with `Adversarial pass: skipped (frontend only)` and no note
- You MUST NOT spawn `k-architect` or run the adversarial SOP yourself, whatever your tools allow; the note is the only path
- You MUST write the report to `output_file` before returning the note, using the Step 7 structure with the verdict from the Step 5 list and the line `Adversarial pass: not run (the orchestrator runs k-adversarial-pull-request-review on this diff)`
- You MUST pass the same diff used in Step 1 as `diff_input`
- Do not send the CR URL to `adversarial-cr-review`, a different SOP that declares `cr_url`; on agents where both are loadable, name the target by filename.

**Expected Output:** Report written from the Step 5 list, then a handoff note asking the orchestrator to run the adversarial review

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
  Verdict: [NEEDS FIXES | READY FOR CR | PENDING ADVERSARIAL PASS]
  Adversarial pass: [not run (the orchestrator runs k-adversarial-pull-request-review on this diff) | complete (<path>) | skipped (frontend only)]
  ## Critical Issues
  [Numbered list with file:line references]
  ## Important Issues
  [Numbered list]
  ## Suggestions
  [Numbered list]
  ```

- You MUST state the verdict from the findings in the report: `NEEDS FIXES` if any CRITICAL or IMPORTANT finding is open, in this report or in a completed adversarial report; otherwise `READY FOR CR` when the adversarial pass is complete or skipped, or `PENDING ADVERSARIAL PASS` while it has not run. `READY FOR CR` never appears while the pass has not run.
- The line after the verdict MUST read `Adversarial pass: not run (the orchestrator runs k-adversarial-pull-request-review on this diff)`, `Adversarial pass: complete (<path>)` or `Adversarial pass: skipped (frontend only)`
- You MUST NOT print the full report in your response — reference the file

**Expected Output:** Report file at `output_file` with verdict and finding counts
