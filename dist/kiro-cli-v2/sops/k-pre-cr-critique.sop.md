# Code Critic

## Overview

This SOP performs a lightweight, read-only pre-submission code critique on local changes. Unlike the full `k-code-review-workflow` SOP (which runs multi-skill reviews and generates a review report), this is faster, focused on local changes, and produces a structured critique document with issue-level resolution tracking.

Use this SOP before creating a CR, after finishing a feature, or when you want a quick sanity check on uncommitted work.

This SOP is **strictly read-only** — it never modifies source files, creates commits, or runs builds/tests.

## Parameters

- **critique_scope** (optional, default: uncommitted changes): What to critique. Supports:
  - `uncommitted` — uncommitted changes (`git diff` + `git diff --cached`)
  - `last N` — last N commits (`git diff HEAD~N`)
  - `branch1...branch2` — branch comparison (`git diff branch1...branch2`)
  - specific file/directory paths — read files directly
- **output_dir** (optional, default: `.agents/scratchpad`): Directory for critique output files
- **mode** (optional, default: `auto`): Resolution mode:
  - `auto` — agent selects resolutions with reasoning for each issue
  - `interactive` — present summary first, then walk through each issue with the user
- **focus_areas** (optional): Comma-separated areas of concern to prioritize (e.g., "error handling", "security", "concurrency"). When provided, findings in these areas are surfaced first.

**Constraints for parameter acquisition:**

- You MUST NOT ask for parameters that have defaults — use the defaults and proceed
- If the user provides a critique scope, You MUST validate it resolves to actual changes before proceeding
- If all parameters are resolved (explicitly or via defaults), You MUST proceed to the Steps immediately

## Steps

### 1. Resolve Parameters

Validate the critique scope, set defaults, and detect project context.

**Constraints:**

- You MUST default `critique_scope` to uncommitted changes if not provided
- You MUST default `output_dir` to `.agents/scratchpad` if not provided
- You MUST default `mode` to `auto` if not provided
- You MUST verify the working directory is a git repository (unless `critique_scope` is specific file paths)
- You MUST detect the project language/framework from project files (`package.json`, `Cargo.toml`, `Config`, `go.mod`, `pyproject.toml`) to inform critique context
- You MUST create `output_dir` if it does not exist
- You MUST determine the next critique number by scanning `output_dir` for existing `critique-NNN.md` files
- You MUST NOT ask the user for parameters that have defaults

**Expected Output:** Resolved parameters summary: scope description, output directory, mode, detected project context, critique file number

### 2. Gather Code Changes

Retrieve the diff or file contents based on `critique_scope`.

**Constraints:**

- For `uncommitted`: You MUST run `git diff` and `git diff --cached` and combine results
- For `last N`: You MUST run `git diff HEAD~N`
- For branch comparison: You MUST run `git diff branch1...branch2`
- For specific paths: You MUST read the files directly
- You MUST exclude binary files, lock files (`package-lock.json`, `yarn.lock`), build artifacts (`dist/`, `build/`, `cdk.out/`), and `.js.map` files
- You MUST report the total number of files and approximate lines changed
- If the diff is empty, You MUST inform the user and stop — there is nothing to critique
- You MUST NOT modify any files or run any build/test commands

**Expected Output:** List of changed files with diff content, total file count, approximate lines changed

### 3. Perform Critique

Analyze the changes exhaustively across six dimensions.

**Constraints:**

- You MUST critique across these 6 dimensions (derived from established code-review frameworks):
  1. Correctness — logic accuracy, edge cases, bugs, null handling, race conditions, integration correctness
  2. Performance — algorithmic complexity, memory usage, N+1 queries, scalability
  3. Security — vulnerabilities, input validation, injection risks, secrets exposure, auth gaps
  4. Maintainability — code clarity, naming, documentation, duplication, complexity
  5. Architecture — design patterns, separation of concerns, coupling, backwards compatibility
  6. Testing — whether tests exist and adequately cover the changed code (static analysis only)
- You MUST assign each finding a severity: **Critical** (bugs, vulnerabilities, data loss risks), **Important** (significant quality issues, missing error handling, performance problems), **Minor** (style, naming, minor improvements)
- You MUST assign each finding a dimension tag from the six dimensions above
- Each finding MUST include: file path, relevant code snippet from the diff, problem description, and suggested resolution
- You MUST NOT include positive observations, praise, or "looks good" comments — only actionable problems
- You MUST NOT flag style-only issues that a linter would catch (formatting, trailing whitespace, import order) unless they indicate a deeper problem
- If `focus_areas` is provided, You MUST still analyze all six dimensions but surface focus area findings first
- For large diffs (>500 lines), You MUST save findings incrementally to `output_dir/critique-NNN-findings.tmp.md` after each file or logical group to prevent context overflow
- You MUST flag production-critical issues: resource leaks, race conditions, missing error handling, input validation vulnerabilities, performance bottlenecks, security vulnerabilities

**Expected Output:** Complete list of findings, each with severity, dimension, file path, code snippet, problem description, and suggested resolution

### 4. Resolve Issues

Determine the disposition of each finding based on the selected mode.

**Constraints:**

- In `auto` mode:
  - You MUST select a resolution for each finding: `fix`, `won't fix`, or `defer`
  - You MUST provide a one-sentence rationale for each resolution
  - Critical findings MUST default to `fix` unless there is a documented reason otherwise
- In `interactive` mode:
  - You MUST first present a summary table: severity counts and a one-line description of each Critical finding
  - You MUST then walk through findings starting with Critical, then Important, then Minor
  - For each finding, You MUST present the issue and ask the user to choose: `fix`, `won't fix`, or `defer`
  - You MUST accept the user's decision without argument
- You MUST NOT modify any source files, create commits, or apply fixes — this SOP is read-only
- You MUST NOT run tests or builds to validate findings

**Expected Output:** Each finding annotated with a resolution (`fix` / `won't fix` / `defer`) and rationale

### 5. Finalize Critique

Write the executive summary and format the complete critique document.

**Constraints:**

- You MUST write the critique file to `output_dir/critique-NNN.md` using the next available number
- You MUST structure the file exactly as:

  ```markdown
  # Code Critique — {task_name or scope description}

  Date: {current date}
  Scope: {critique_scope description}
  Files Critiqued: {count}
  Mode: {auto|interactive}

  ## Executive Summary

  {2-3 sentence assessment: what was changed, overall quality, key risks}

  | Severity  | Count |
  | --------- | ----- |
  | Critical  | N     |
  | Important | N     |
  | Minor     | N     |

  ## Critical Issues

  ### Issue C1: {title} [{dimension}]

  **File:** `{path}`

  **Problem:** {description}
  ```

  {relevant code snippet}

  ```

  **Suggested Resolution:** {description}

  **Decision:** {fix|won't fix|defer} — {rationale}

  ## Important Issues

  ### Issue I1: {title} [{dimension}]

  {same structure as Critical}

  ## Minor Issues

  ### Issue M1: {title} [{dimension}]

  {same structure as Critical}
  ```

- If a severity category has no findings, You MUST include the heading with "No issues found." beneath it
- You MUST delete any temporary `critique-NNN-findings.tmp.md` file after the final critique is written
- You MUST NOT print the full critique document in your response — reference the file path

**Expected Output:** Critique file written to `output_dir/critique-NNN.md`

### 6. Present Results

Summarize the critique for the user.

**Constraints:**

- You MUST display: the critique file path, issue counts by severity, and a one-line description of each Critical finding
- You MUST state the overall assessment: "No critical issues" or "N critical issues require attention before submission"
- If there are findings with `fix` resolution, You SHOULD remind the user this SOP is read-only and they need to apply fixes manually
- You MUST NOT reprint the full critique — the file is the deliverable
- You MUST NOT offer to apply fixes, run builds, or create commits

**Expected Output:** Summary message with file path, severity counts, critical finding descriptions, and overall assessment

## Troubleshooting

### Issue: Git diff returns empty but files were changed

**Solution:** Check if changes were stashed (`git stash list`) or if the files are untracked (`git status`). For untracked files, use specific file paths as `critique_scope` instead of `uncommitted`.

### Issue: Diff is too large and critique loses context

**Solution:** Use `focus_areas` to narrow the analysis, or set `critique_scope` to specific directories or files. The SOP saves findings incrementally for large diffs, but narrowing scope produces better results.

### Issue: Findings reference code not in the diff

**Solution:** This indicates the critique analyzed surrounding context beyond the diff. Re-run with a tighter `critique_scope` (specific files) to constrain analysis to only changed code.

### Issue: Too many Minor findings obscure real problems

**Solution:** Use `focus_areas` to prioritize specific dimensions (e.g., "security, correctness"). Minor findings are still captured in the file but Critical and Important issues in focus areas are surfaced first.
