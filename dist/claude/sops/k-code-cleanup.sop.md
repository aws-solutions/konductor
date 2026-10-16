# Code Cleanup

## Overview

This SOP removes AI-generated slop from code before CR submission. It diffs the current branch against main/mainline, identifies unnecessary artifacts, cleans them, and runs review skills on the result.

## Parameters

- **source_dir** (required): Path to the source directory to clean
- **branch** (optional, default: current branch): Branch to diff against main/mainline
- **output_file** (optional, default: `cleanup-report.md`): File to write the cleanup summary

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding

## Steps

### 1. Get Changed Files

Run git diff of the current branch against main/mainline to identify changed files.

**Constraints:**

- You MUST diff `branch` against `main` or `mainline` (whichever exists)
- You MUST list only files within `source_dir`
- You MUST skip binary files, lock files, and build artifacts

**Expected Output:** List of changed files with diff hunks

### 2. Identify AI Slop

Scan changed files for common AI-generated artifacts.

**Constraints:**

- You MUST flag: unnecessary comments restating code, defensive checks duplicating existing validation, `as any` casts, style inconsistencies with surrounding code, over-abstraction (wrappers adding no value)
- You MUST NOT flag: TODO comments, error handling/catch blocks, comments explaining _why_ (business rationale)
- You MUST NOT change any logic or behavior

**Expected Output:** Findings per file with line references and category

### 3. Apply Cleanup

Remove or fix identified slop items.

**Constraints:**

- You MUST make only the changes identified in Step 2
- You MUST preserve all intentional comments, logging, and error handling
- You MUST NOT alter control flow, return values, or function signatures

**Expected Output:** Modified files with slop removed, shown as before/after diffs

### 4. Run Review Skills

Run the appropriate review skill(s) on the cleaned code.

**Constraints:**

- You MUST run `backend-review` on `.ts`/`.js` service/handler files
- You MUST run `frontend-review` on `.tsx`/`.jsx` files, and `.ts` files in component/page/hook paths
- You MUST skip file types with no matching skill

**Expected Output:** Review findings from each applicable skill

### 5. Present Summary

Write the cleanup report and present results.

**Constraints:**

- You MUST write the report to `output_file` with sections: Removed Items, Preserved Items, Review Findings
- You MUST state the count of items removed per category
- You MUST include any CRITICAL or IMPORTANT findings from review skills

**Expected Output:** Report file at `output_file` with summary message
