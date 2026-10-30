---
name: cypress-test-implementation
description: Transforms E2E test strategy into Cypress implementation tasks. Use after E2E strategy is defined to plan and track Cypress test development. Operates in three modes — initial (planning), progress (tracking), and final (verification).
version: 1.0.0
tags: [skill, cypress, e2e-testing, implementation, quality-assurance]
---

# Cypress Test Implementation

## Overview

Breaks down an E2E test strategy into Cypress implementation tasks with a phased roadmap (Foundation → P0 → P1 → P2). Tracks progress, identifies blockers, and verifies implemented tests against specifications.

## Scope and fallback

**Applies to:** turning an E2E strategy into a Cypress implementation plan, tracking its progress, or verifying it.

**Not for:** choosing what to test (use `e2e-test-strategy`) or for non-Cypress frameworks.

**Lightweight fallback:** for one or two flows, write the spec files directly using `references/cypress-patterns.md`; skip the task breakdown, roadmap, and traceability matrix.

## Usage

Use this skill when:

- Initial mode: planning Cypress implementation from an E2E strategy
- Progress mode: tracking test implementation during development
- Final mode: verifying tests match the strategy and follow best practices

## Core Concepts

### Phased Roadmap

Foundation (test infrastructure, page objects, custom commands) → P0 (critical path tests) → P1 (core feature tests) → P2 (edge case tests). Each phase has entry criteria from the previous phase.

### Three Modes

Initial mode (pre-implementation) breaks down E2E tests into tasks and creates the phased roadmap. Progress mode (during implementation) tracks completion and identifies blockers. Final mode (post-implementation) verifies tests match specifications and builds a traceability matrix.

## Execution

When this skill is activated, use the following as your full instruction set for planning Cypress test implementation. Apply the Quality Gate at the end before presenting output to the user.

---

# Cypress Test Implementation Planner

## Purpose

Transform E2E test strategy into actionable Cypress test implementation plan with task breakdown, progress tracking, and code-level traceability. Operates in three modes: initial (pre-implementation planning), progress (during implementation tracking), and final (post-implementation verification). Provides detailed Cypress-specific guidance including test structure, page objects, custom commands, and best practices.

## Target Personas

- **QA Engineers**: Cypress test implementation and execution
- **Frontend Developers**: Component testing and E2E test development
- **Test Architects**: Test framework design and pattern enforcement
- **Team Leads**: Implementation progress monitoring and resource allocation

## Prerequisites

1. **E2E Test Strategy**: Output from E2E Test Strategy Planner prompt
   - Location: `testing-quality-assurance/outputs/e2e-test-strategy.md`
   - Contains: Prioritized E2E test matrix, user journeys, test specifications

2. **Application Code**: Access to frontend application code
   - Location: User-specified (e.g., `src/`, `frontend/`, `app/`)
   - Contains: React/Vue/Angular components, routing, state management

3. **API Documentation**: API endpoints and schemas (optional but recommended)
   - Location: `design-architecture/outputs/api-specs/` or similar
   - Contains: Request/response formats, authentication requirements

4. **Validation Mode**: Initial, Progress, or Final

## Execution Flow

Follow stages sequentially based on selected mode:

**Mode Branching:**

- **Initial**: Stages 1, 2, 3, 4, 5, 6 → Report
- **Progress**: Stages 1, 2, 7 → Report
- **Final**: Stages 1, 2, 3, 4, 5, 6, 8, 9 → Report

---

## Stage 1: Mode Selection & Context Gathering

**Objective:** Determine mode, locate E2E test strategy, gather preferences.

**CRITICAL: Use Current Date** - Always use the actual current date/time when generating reports.

**Mode Detection:** Analyze request for keywords:

- Initial: "plan implementation", "create tasks", "break down tests", "before we start"
- Progress: "track progress", "status update", "check blockers", "how far along"
- Final: "final validation", "verify implementation", "post-implementation", "code verification"

If ambiguous, ask: "Which validation mode? (initial/progress/final)" with descriptions. Default: initial.

**Locate E2E Test Strategy:** Check `testing-quality-assurance/outputs/e2e-test-strategy.md`. If not found, ask user for path. Validate exists and readable.

**Gather Context:**

Ask user for:

1. **Application Code Location**: Where is your frontend code? (e.g., `src/`, `frontend/`, `app/`)
2. **Cypress Installation Status**: Is Cypress already installed? (yes/no)
3. **Existing Test Location**: Where should Cypress tests live? (default: `cypress/e2e/`)
4. **Detail Level**: "Detailed analysis?" (yes/no, default: no)
5. **Save History**: "Save validation history?" (yes/no, default: no for initial, yes for progress/final)

**Output:** `✅ Configuration: Mode: [mode] | Strategy: [path] | Code: [path] | Cypress: [installed/not installed] | Detail: [level] | History: [yes/no]`

**Store:** mode, strategy_path, code_location, cypress_installed, test_location, detailed_analysis, save_history

---

## Stage 2: E2E Strategy Parsing

**Objective:** Parse E2E test strategy and extract test specifications.

**Parse E2E Test Strategy:**

Extract the following sections:

1. **Prioritization Matrix**
   - P0 (Critical) tests with IDs, user journeys, scores, effort estimates
   - P1 (High) tests
   - P2 (Medium) tests
   - P3 (Low) tests

2. **User Journey Coverage**
   - Journey ID, name, steps
   - User stories covered
   - Acceptance criteria covered
   - Integration points exercised
   - Test objective
   - Test complexity

3. **Detailed Test Specifications (Appendix)**
   - Test objective
   - Prerequisites
   - Test steps with expected results
   - Test data
   - Assertions
   - Cleanup procedures
   - Estimated effort

4. **Execution Strategy**
   - Execution order (Phase 1, 2, 3)
   - Execution approach (Sequential/Parallel/Hybrid)
   - Test data strategy
   - Environment recommendations

5. **Framework Recommendations**
   - Recommended framework (should be Cypress or Playwright)
   - Configuration guidance
   - Example test structure

**Build Test Specification Map:**

Structure: `{ testId, priority, userJourney, testObjective, steps, assertions, testData, effort, dependencies, userStories, acceptanceCriteria }`

**Output:** `📋 Strategy Parsed: [N] tests identified | P0: [M] | P1: [P] | P2: [Q] | Total Effort: [X] hours`

**Store:** test_specifications, execution_strategy, framework_recommendations

---

## Stage 3: Cypress Project Structure Analysis (Initial & Final)

**Objective:** Analyze existing Cypress setup or plan new installation.

**Mode:** Initial and Final only (skip in Progress).

**Check Cypress Installation:**

If `cypress_installed = yes`:

1. Locate `cypress.config.js` or `cypress.config.ts`
2. Parse configuration: baseUrl, viewportWidth, viewportHeight, video, screenshots
3. Check `cypress/` directory structure: e2e/, fixtures/, support/
4. Identify existing custom commands in `cypress/support/commands.js`
5. Identify existing page objects or helpers
6. Check `package.json` for Cypress version and scripts

If `cypress_installed = no`:

1. Recommend Cypress installation: `npm install --save-dev cypress`
2. Suggest initial configuration based on application type
3. Recommend directory structure
4. Suggest essential custom commands
5. Recommend page object pattern

**Analyze Application Structure:**

Parse application code to understand:

1. **Routing**: Identify routes and navigation patterns
2. **Components**: Identify key UI components (forms, buttons, modals)
3. **State Management**: Identify state management approach (Redux, Context, Vuex)
4. **Authentication**: Identify auth mechanism (JWT, session, OAuth)
5. **API Integration**: Identify API client and endpoints

**Identify Reusable Patterns:**

Based on test specifications, identify common patterns:

1. **Login Flow**: Used by multiple tests
2. **Navigation**: Common navigation sequences
3. **Form Interactions**: Common form patterns
4. **API Mocking**: Common API responses to mock
5. **Data Setup**: Common test data creation

**Recommend Cypress Structure:**

Read the Example project layout in `references/cypress-patterns.md` (relative to this file) when recommending the Cypress structure; it holds the recommended directory tree.

**Output:** `🏗️ Cypress Structure Analyzed: [Installed/Not Installed] | Existing tests: [N] | Custom commands: [M] | Page objects: [P]`

**Store:** cypress_config, existing_structure, reusable_patterns, recommended_structure

---

## Stage 4: Task Breakdown Generation (Initial & Final)

**Objective:** Break down each E2E test into implementation tasks.

**Mode:** Initial and Final only (skip in Progress).

**CRITICAL: Code Examples Placement**

- Task breakdown should NOT include code examples
- Implementation Notes should reference appendix sections
- All code examples belong in "Appendix: Example Test Structure" section
- Keep task descriptions focused on what needs to be done, not how to do it

**For Each Test Specification:**

`references/task-breakdown.md` holds the six task categories, the task structure, a worked breakdown for one test, and the shared-task and effort summary.

Read `references/task-breakdown.md` when generating the task list and roadmap (initial and final modes only).

**Output:** `📝 Task Breakdown Complete: [N] tests → [M] tasks | Total Effort: [X] hours ([Y] days)`

**Store:** task_breakdown, shared_tasks, total_effort

---

## Stage 5: Implementation Roadmap Generation (Initial & Final)

**Objective:** Create phased implementation plan with dependencies and milestones.

**Mode:** Initial and Final only (skip in Progress).

`references/task-breakdown.md` holds the four phases (Foundation, P0, P1, P2) with their task lists, dependencies, and milestones.

Read `references/task-breakdown.md` when generating the task list and roadmap (initial and final modes only).

**Output:** `🗓️ Roadmap Generated: 4 phases | [N] milestones | Total: [X] hours ([Y] weeks)`

**Store:** implementation_roadmap, phases, milestones

---

## Stage 6: Best Practices & Patterns (Initial & Final)

**Objective:** Provide Cypress-specific guidance and patterns.

**Mode:** Initial and Final only (skip in Progress).

`references/cypress-patterns.md` holds the eight Cypress best practices and four anti-patterns, with good and bad code examples.

Read `references/cypress-patterns.md` when writing or reviewing test code; it holds the Cypress patterns and a full example spec.

**Output:** `✅ Best Practices Documented: 8 patterns | 4 anti-patterns | Ready for implementation`

**Store:** best_practices, anti_patterns

---

## Stage 7: Progress Tracking (Progress Mode)

**Objective:** Track implementation progress, identify blockers, calculate remaining effort.

**Mode:** Progress only.

**Parse Task States:**

For each task in the implementation plan:

- Extract checkbox state: `[ ]` = not started, `[-]` = in progress, `[x]` = completed
- Count tasks by state per phase
- Count tasks by type (Setup, PageObject, CustomCommand, TestData, TestImplementation, Verification)

**Calculate Progress:**


Read the Progress section of `references/report-templates.md` when calculating progress and velocity; it holds the two formulas.
**Per-Phase Progress:**

Completion percentage for each of the four phases (formula in the Progress section of the reference file).

**Overall Progress:**

```
Overall: (total_completed / total_tasks) * 100%
```

**By Task Type:**

```
Setup: (completed / total) * 100%
Page Objects: (completed / total) * 100%
Custom Commands: (completed / total) * 100%
Test Data: (completed / total) * 100%
Test Implementation: (completed / total) * 100%
Verification: (completed / total) * 100%
```

**Identify Blockers:**

A task is blocked if:

1. Dependencies are not completed
2. Task is marked as in-progress for >3 days (if history available)
3. Task has explicit blocker comment

**Blocker Types:**

- **Critical:** Blocks P0 test implementation
- **High:** Blocks P1 test implementation
- **Medium:** Blocks P2 test implementation
- **Low:** Blocks P3 test implementation

**Calculate Remaining Effort:**

Remaining effort, estimated completion, and team velocity (formulas in the Progress section of the reference file).

**Generate Progress Report:**

Read the section for the current mode in `references/report-templates.md` when producing that mode's report.

**Save History:**

If enabled, save to `.kiro/specs/validation-history/cypress-progress-[timestamp].json`:

Read the history JSON example in the Progress section of `references/report-templates.md` before saving history.

**Output:** `📊 Progress Report Generated: [X]% complete | [M] blockers | [Y] days remaining`

**Store:** progress_report, blockers, velocity_metrics

---

## Stage 8: Code Verification (Final Mode)

**Objective:** Verify implemented tests match specifications and follow best practices.

**Mode:** Final only.

**Locate Test Files:**

Search for Cypress test files:

- Pattern: `cypress/e2e/**/*.cy.js`, `cypress/e2e/**/*.cy.ts`
- Group by priority: critical/, high-priority/, medium-priority/
- Map to test IDs from E2E strategy

**Parse Test Structure:**

For each test file, extract:

1. **Test Suite:** `describe()` blocks
2. **Test Cases:** `it()` blocks
3. **Hooks:** `beforeEach()`, `afterEach()`, `before()`, `after()`
4. **Custom Commands:** Usage of `cy.customCommand()`
5. **Page Objects:** Import statements and usage
6. **Fixtures:** `cy.fixture()` calls
7. **Assertions:** `.should()` statements
8. **API Mocking:** `cy.intercept()` calls

**Verify Against Specifications:**

For each test from E2E strategy:

**1. Test Exists:**

- ✅ Test file found
- ❌ Test file missing

**2. Test Steps Match:**

- Compare implemented steps to specification steps
- ✅ All steps implemented
- ⚠️ Some steps missing
- ❌ Steps don't match specification

**3. Assertions Match:**

- Compare implemented assertions to specification assertions
- ✅ All assertions present
- ⚠️ Some assertions missing
- ❌ Assertions don't match specification

**4. Test Data Matches:**

- Verify fixtures used match specification
- ✅ Correct fixtures used
- ⚠️ Hardcoded data instead of fixtures
- ❌ Wrong test data

**5. Cleanup Implemented:**

- Verify `afterEach()` or `after()` cleanup
- ✅ Cleanup present
- ⚠️ Partial cleanup
- ❌ No cleanup

**Check Best Practices:**

Score each test against the six rubrics: selector strategy, custom commands, page objects, waiting strategy, test isolation, and API mocking.

Read the Compliance rubric in `references/cypress-patterns.md` when scoring best-practice compliance.

**Run Test Suite:**

Execute Cypress tests and capture results:

```bash
npx cypress run --spec "cypress/e2e/**/*.cy.js" --reporter json
```

**Parse Test Results:**

- Total tests: [N]
- Passed: [M]
- Failed: [P]
- Skipped: [Q]
- Duration: [X] seconds
- Pass rate: [M/N * 100]%

**Identify Flaky Tests:**

A test is flaky if:

- Passes sometimes, fails sometimes (run 3 times, check consistency)
- Failure reason: timeout, race condition, external dependency

**Generate Verification Report:**

Read the section for the current mode in `references/report-templates.md` when producing that mode's report.

**Output:** `✅ Verification Complete: [M]/[N] tests passing | [P] issues found | [Q] recommendations`

**Store:** verification_report, test_results, code_quality_issues

---

## Stage 9: Traceability Matrix (Final Mode)

**Objective:** Build complete traceability from E2E strategy to implemented tests.

**Mode:** Final only.

**Build Traceability Matrix:**

For each test in E2E strategy, trace:
1. **E2E Strategy → Test Specification:** Test ID, user journey, test objective
2. **Test Specification → Implementation Tasks:** Task IDs, task descriptions
3. **Implementation Tasks → Code Files:** Test files, page objects, custom commands, fixtures
4. **Code Files → Test Execution:** Test results, pass/fail status

**Structure:**

Read the traceability structure example in the Final section of `references/report-templates.md` when building the matrix.

**Calculate Completeness:**

For each test:
- **Specification:** ✅ Complete (from E2E strategy)
- **Tasks:** [M]/[N] completed ([X]%)
- **Code:** [P]/[Q] files present ([Y]%)
- **Execution:** ✅ Passing / ❌ Failing / ⏳ Not Run

**Overall Completeness:** `(completed_elements / total_elements) * 100%`

**Identify Gaps:**

**Specification Gap:** Test in E2E strategy but no implementation tasks
**Planning Gap:** Implementation tasks but no code files
**Implementation Gap:** Code files but test not passing
**Traceability Gap:** Code files not linked to test specification

**Generate Traceability Report:**

Read the section for the current mode in `references/report-templates.md` when producing that mode's report.

**Output:** `🔗 Traceability Complete: [X]% overall | [M] complete | [P] partial | [Q] missing`

**Store:** traceability_matrix, traceability_gaps

---

## Final Report Generation

After completing mode-specific stages, generate consolidated report.

**Report Structure:**

The consolidated report template, with its appendices for the detailed task list and Cypress configuration, is in `references/report-templates.md`.

Read the Consolidated report section of `references/report-templates.md` when producing the final report.

---

## Appendix: Example Test Structure

Read `references/cypress-patterns.md` when writing or reviewing test code; its Example test structure section holds a full spec, a page object, and custom commands.

---

**Save Report:**

Write report to user-specified output file path (default: `testing-quality-assurance/outputs/cypress-implementation-plan.md`).

**Final Output Message:**

```text

✅ Cypress Implementation Plan Complete!

Report saved to: [output_file_path]
Analysis Duration: [X] seconds

Summary:

- Mode: [Initial/Progress/Final]
- E2E Tests: [N]
- Implementation Tasks: [M]
- Estimated Effort: [X] hours ([Y] days)

[Mode-Specific Summary]

Next Steps:

1. [Step 1]
2. [Step 2]
3. [Step 3]

```

---

## Quality Gate

**CRITICAL (must fix):**
- Final mode: P0 tests not implemented
- Final mode: tests use `cy.wait()` with hardcoded timeouts instead of assertions
- Tests share state between test cases (no isolation)

**IMPORTANT (should fix):**
- Page Object Model not used for reusable selectors
- No custom commands for repeated interaction patterns
- Tests not tagged by priority for selective execution

**SUGGESTION:**
- Could add visual snapshot tests for critical UI states
- Could configure parallel execution for faster CI runs

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
