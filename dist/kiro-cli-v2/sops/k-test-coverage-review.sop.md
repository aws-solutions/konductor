# Test Coverage Review

## Overview

This SOP guides a structured review of test coverage after implementation. It identifies test gaps, plans E2E tests, and generates security test plans using three QA skills in sequence.

Use this SOP after implementation is complete and before release.

## Parameters

- **source_dir** (required): Path to the application source code (e.g., `src/`)
- **test_dir** (required): Path to the test files (e.g., `test/` or `__tests__/`)
- **stories_file** (optional): Path to user stories or acceptance criteria file
- **design_file** (optional): Path to system design document (used for security test generation)
- **output_dir** (optional, default: `test-coverage-review/`): Directory for output files
- **dry_run** (optional, default: false): If true, show what would be analyzed without generating reports
- **scope_confirmed** (optional, default: false): Set true when the caller has already authorized E2E planning for whatever gaps the analysis finds. Step 3 then reports the gap summary and proceeds without prompting. This flag also suppresses downstream scope/tool questions in delegated skills (including `security-test-generation`), which report their findings without asking instead of prompting the caller — it does not authorize any skill to change code. A parallel or unattended caller MUST set this — the prompt has no one to answer it.
- **scope_declined** (optional, default: false): Set true when the caller has already asked the engineer whether to plan E2E tests for this analysis and the engineer said no. Step 3 then reports the gap summary and skips Step 4 without asking again. Mutually exclusive with `scope_confirmed` — a caller MUST NOT set both true. Leaving both false is not equivalent to declining: Step 3 has no way to distinguish "not yet asked" from "asked and declined" and will ask again, so a caller that already has the engineer's answer MUST set the matching flag rather than leaving both false.

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding
- When asking for parameters, You MUST request all parameters in a single prompt
- When asking for parameters, You MUST use the exact parameter names as defined

## Steps

### 1. Discover Source and Test Files

Scan the source and test directories to understand the codebase structure.

**Constraints:**

- You MUST scan `source_dir` for implementation files (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`)
- You MUST scan `test_dir` for test files (`.test.ts`, `.spec.ts`, `.test.tsx`, `.test.py`)
- You MUST report: total source files, total test files, test-to-source ratio
- You SHOULD identify which source files have no corresponding test file
- You MUST NOT proceed if `source_dir` or `test_dir` do not exist

**Expected Output:**

- Source file count and test file count
- List of source files with no test coverage
- Test-to-source ratio

### 2. Run Test Coverage Analysis

Apply the test-coverage-analysis skill to identify gaps.

**Constraints:**

- You MUST use the `test-coverage-analysis` skill for this step
- You MUST pass `source_dir`, `test_dir`, `stories_file`, and `design_file` through to the skill, and `output_dir/test-gap-analysis.md` as its output file, so it uses your paths instead of searching its own default locations
- You MUST analyze coverage across unit, integration, and E2E test types
- If `stories_file` is provided, you MUST map tests to acceptance criteria
- You MUST categorize gaps by severity: CRITICAL (core user journeys untested), IMPORTANT (error paths untested), SUGGESTION (edge cases)
- You MUST write the gap analysis to `output_dir/test-gap-analysis.md`

**Expected Output:**

- `test-gap-analysis.md` with coverage analysis and prioritized gaps

### 3. Confirm Scope with User

Present the gap analysis and confirm whether to proceed with E2E planning.

**Constraints:**

- You MUST display a summary of the gap analysis (total gaps by severity)
- If `dry_run` is true, You MUST stop here and report what would be planned — `dry_run` takes precedence over `scope_confirmed` and `scope_declined`, and always stops at this step regardless of either flag's value.
- Otherwise: if `scope_confirmed` is true, You MUST proceed to Step 4 without asking — the caller already authorized E2E planning for whatever the analysis found. If `scope_declined` is true, You MUST skip Step 4 without asking — the caller already asked the engineer and they declined, so asking again would repeat a question already answered. Otherwise You MUST ask: "Plan E2E tests for these gaps? [y/n]" and MUST NOT proceed without explicit user confirmation; treat a "no" answer the same as `scope_declined=true` and skip Step 4

### 4. Plan E2E Test Strategy

_Skip if `scope_declined` is true, or if the user declined at Step 3._

Apply the e2e-test-strategy skill to create a prioritized test plan.

**Constraints:**

- You MUST use the `e2e-test-strategy` skill for this step
- You MUST pass `output_dir/test-gap-analysis.md` from Step 2, `stories_file`, and `design_file` through to the skill, and `output_dir/e2e-test-strategy.md` as its output file, so it does not prompt for paths it has already been given. The skill also declares Feature Plan, Change Type, and Release Type as required; pass whatever you have and let it apply its documented defaults for the rest, so an unattended run does not stall on them.
- You MUST use the gap analysis from Step 2 as input
- You MUST classify tests by priority: P0 (critical path), P1 (core features), P2 (edge cases), P3 (nice-to-have)
- You MUST recommend an execution strategy (sequential, parallel, or hybrid)
- You MUST write the strategy to `output_dir/e2e-test-strategy.md`

**Expected Output:**

- `e2e-test-strategy.md` with prioritized test matrix and execution strategy

### 5. Generate Security Test Plan

Apply the security-test-generation skill to create security test coverage.

**Constraints:**

- You MUST use the `security-test-generation` skill for this step
- You MUST pass `output_dir` to the skill as its own `output_dir` so its task list lands with your other outputs rather than at its default `.kiro/specs/security-testing/`, and pass `scope_confirmed` through so it does not stop to ask about tool type, stack, or approach when no engineer is available to answer
- If `design_file` is provided, you MUST use it for threat context
- You MUST cover all 7 security domains: authentication, input validation, API security, data protection, session management, error handling, infrastructure
- You MUST organize tests by layer: frontend, backend, infrastructure
- The skill writes its own output under `output_dir` — `tasks.md` for Kiro callers, or per-category files plus `security-test-overview.md` and `best-practices-reference.md` for non-Kiro callers (see `skills/security-test-generation/SKILL.md`'s Output section) — you MUST NOT expect a separate `security-test-plan.md` file
- You MUST count the CRITICAL and IMPORTANT findings the skill reports from its own Quality Gate and carry those counts into Step 6's report — a CRITICAL security finding is a coverage gap and MUST reach the same gate as the other CRITICAL gaps this SOP surfaces.
- If the skill ran in Kiro stub mode — `tasks.md` written with no `security-test-overview.md`, `best-practices-reference.md`, or `[domain]-[layer].md` file alongside it — there is no real findings count to carry forward: real test content is deferred to a human clicking "Start task" in the Kiro IDE. You MUST record Critical and Important findings in Step 6's report as NOT EVALUATED, not as 0, so the report does not misrepresent an unevaluated pass as a clean one.

**Expected Output:**

- The skill's own output files under `output_dir` (see above) with security tests by domain and layer

### 6. Generate Consolidated Report

Write a summary report combining all three analyses.

**Constraints:**

- You MUST write the report to `output_dir/test-coverage-review-report.md`
- You MUST structure the report as:

  ```
  # Test Coverage Review Report
  Date: [current date]

  ## Executive Summary
  [2-3 sentences: overall test readiness, critical gaps]

  ## Coverage Analysis
  - Source files: [count]
  - Test files: [count]
  - Test-to-source ratio: [ratio]
  - Critical gaps: [count]
  - Important gaps: [count]

  ## E2E Test Strategy
  - P0 tests: [count]
  - P1 tests: [count]
  - Execution strategy: [sequential/parallel/hybrid]

  ## Security Test Plan
  - Domains covered: [count]/7
  - Total security tests: [count]
  - Critical findings: [count, or NOT EVALUATED if the skill ran in Kiro stub mode]
  - Important findings: [count, or NOT EVALUATED if the skill ran in Kiro stub mode]

  ## Recommendation
  [READY FOR RELEASE / NOT READY — reason. NOT READY if critical gaps exist in either Coverage Analysis or Security Test Plan, or if Security Test Plan is NOT EVALUATED.]

  ## Next Steps
  [Prioritized list of what to implement first]
  ```

- You MUST NOT print the full report in your response
- You MUST inform the user of the file locations and overall recommendation

**Expected Output:**

- `test-gap-analysis.md`, `e2e-test-strategy.md`, `test-coverage-review-report.md`, plus the security-test-generation skill's own output files (see Step 5) — all in `output_dir/`
- Summary message with recommendation

### 7. Present Recommendation

Summarize findings and recommend next steps.

**Constraints:**

- You MUST state clearly: READY FOR RELEASE or NOT READY
- You MUST treat a Security Test Plan reported as NOT EVALUATED the same as a critical gap for this determination — recommend NOT READY, not READY, when its findings were never actually evaluated
- If NOT READY, you MUST list the critical gaps that must be addressed
- You SHOULD offer to spawn `k-developer` subagent to implement missing tests
- You MAY offer to re-run the review after tests are added

## Examples

### Example 1: Full Review

**Input:**

- source_dir: `src/`
- test_dir: `test/`
- stories_file: `requirements/user-stories.md`
- design_file: `design/system-design.md`

**Expected Output:**

```
Test coverage review complete. Reports saved to test-coverage-review/

Files generated:
- test-gap-analysis.md
- e2e-test-strategy.md
- security test files (see Step 5 — Kiro: `tasks.md`; non-Kiro: per-category files plus `security-test-overview.md`/`best-practices-reference.md`)
- test-coverage-review-report.md

Recommendation: NOT READY FOR RELEASE
3 critical gaps: PaymentHandler has no tests, auth flow missing E2E coverage, no SQL injection tests.
```

### Example 2: Dry Run

**Input:**

- source_dir: `src/`
- test_dir: `test/`
- dry_run: true

**Expected Output:**

```
DRY RUN — would analyze:
- 47 source files in src/
- 23 test files in test/
- Test-to-source ratio: 0.49

No reports generated (dry_run=true).
```

## Troubleshooting

### Issue: Test directory structure doesn't match source

**Solution:** The skill maps test files to source files by name convention (e.g., `handler.ts` → `handler.test.ts`). If your project uses a different convention, specify the mapping in your request.

### Issue: Too many gaps identified

**Solution:** Focus on CRITICAL gaps first (core user journeys). P0 E2E tests and authentication security tests should be the first priority. SUGGESTION-level gaps can be deferred.

### Issue: Security test plan references services not in the architecture

**Solution:** Provide the `design_file` parameter so the security test generator uses the actual architecture instead of inferring services from code.
