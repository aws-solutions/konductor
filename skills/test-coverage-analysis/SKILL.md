---
name: test-coverage-analysis
description: Analyzes test coverage across unit, integration, and E2E tests to identify gaps. Use after implementation to find missing test scenarios before release. Operates in two modes — coverage (test analysis) and release readiness (deployment validation).
version: 1.0.0
tags: [skill, testing, coverage, gap-analysis, quality-assurance]
---

# Test Coverage Analysis

## Overview

Compares implementation code against existing test suites to identify missing test scenarios. Maps tests to acceptance criteria and generates specific recommendations for additional tests needed.

## Scope and fallback

**Applies to:** assessing test coverage or release readiness across a codebase's test suite.

**Not for:** writing tests (use `cypress-test-implementation` or `playwright-test-implementation`) or analyzing a single file.

**Lightweight fallback:** for one module or one PR, list the uncovered behaviours and their severity in a short table; skip Stages 0, 3, 8 and the full report.

## Usage

Use this skill when:

- Checking test coverage after implementation before release
- Identifying which acceptance criteria lack test coverage
- Validating release readiness before production deployment

## Core Concepts

### Two Modes

Coverage mode analyzes test distribution, maps tests to acceptance criteria, and identifies gaps by feature and test type (unit, integration, E2E). Release Readiness mode validates deployment readiness, checks operational requirements, and assesses production preparedness.

Read `references/usage-examples.md` (relative to this file) only if unsure what a mode's output should look like; it holds three worked examples.

## Execution

When this skill is activated, use the following as your full instruction set for analyzing test coverage. Apply the Quality Gate at the end before presenting output to the user.

---

# Test Gap Analyzer (Checker)

## Purpose

Evaluate current codebase test coverage against Requirements & Planning acceptance criteria and Implementation & Development test plans. Analyze existing unit, integration, and E2E tests to identify coverage gaps for new features and enhancements. Generate detailed test status reports with specific recommendations for manual testing when automated tests are missing. Create pre-release readiness reports with actionable gap analysis and testing recommendations.

## Target Personas

- **QA Engineers**: Test coverage validation and gap identification
- **Developers**: Test implementation guidance and pattern alignment
- **Team Leads**: Release readiness assessment and risk evaluation

## Prerequisites

Required artifacts:

1. **Requirements & Planning**: Acceptance criteria from user stories
2. **Implementation & Development**: Test plans and test strategy
3. **Design & Architecture**: Non-functional requirements (NFRs), system design with integration points
4. **Codebase Access**: Test files (unit, integration, E2E)
5. **Analysis Mode**: Coverage or Readiness
6. **Kiro Environment**: For subagent-powered parallel code analysis (uses `invokeSubAgent` tool)

## Execution Flow

Follow stages sequentially based on selected mode:

**Mode Branching:**

- **Coverage**: Stages 0, 1, 2, 3, 4, 5, 6, 7, 8 → Report
- **Readiness**: Stages 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 → Report

---

## Common Reference Sections

Read `references/report-templates.md` when creating the report file in Stage 1 (it holds the data structures, the progress tracker and the standard report template) and again, for the current mode only, when assembling the final report.

### Visual Indicators

Use consistently across all reports:

- ✅ Covered/Pass | ❌ Missing/Fail | ⚠️ Partial/Warning | 🔍 Manual Required
- 🧪 Unit Test | 🔗 Integration Test | 🌐 E2E Test | 📋 Test Plan
- 🚨 Critical Gap | ⚠️ Warning Gap | 💡 Suggestion

**Coverage Bar:** `[████████░░] 80% (8/10)` (each block = 10%)

### Error Handling Patterns

**File System:** Missing test directories → scan common locations, report findings | Permission errors → report issue, suggest alternatives | Invalid paths → provide error, suggest correction

**Parsing:** Malformed test files → report file, skip, continue | Missing test metadata → log warning, extract available | Invalid test syntax → skip test, log line, show correct format

**Validation:** Coverage gaps → identify, provide remediation, continue with warnings | Missing test plans → report features, suggest creation | Invalid test patterns → report issues, suggest corrections

**General:** Fail gracefully with partial data | Provide context (file paths, line numbers, test names) | Suggest concrete fixes | Prioritize: Critical (blocks release) vs Warnings (should fix) vs Info (nice to have)

---

## Stage 0: Testing Philosophy Detection

**Objective:** Determine application architecture and recommend appropriate testing model.

**CRITICAL:** This stage establishes the foundation for all subsequent analysis. The testing model determines what "good coverage" means.

Read the Stage 0 section of `references/stage-details.md` when you reach this stage; it holds the architecture indicators, the four testing models with their expected distributions, and the philosophy report template.

**Update Progress Tracker:** Mark "Testing philosophy detected" as complete and update timestamp.

**Store:** testing_philosophy

**Requirements:** 0.1, 0.2, 0.3

---

## Stage 1: Mode Selection & Context Gathering

**Objective:** Determine analysis mode, locate artifacts, gather preferences, and get output file location.

**CRITICAL: Use Current Date** - Always use the actual current date/time when generating reports.

**CRITICAL: Output File Location**

**If a calling SOP supplied an output path or `output_dir`, use it and do not ask.** Only when no caller supplied one, ask the user:

"Where would you like me to save the test gap analysis report? Please provide the full file path (e.g., `test-analysis-reports/coverage-2025-01-15.md` or `docs/testing/gap-analysis.md`)."

**Once you have the file path:**

1. Validate the path is writable
2. Create the report file at the specified location
3. Include a progress tracker at the top of the file
4. Update the progress tracker as you complete each stage
5. Save incremental progress so work is not lost

**Mode Detection:** Analyze request for keywords:

- Coverage: "test coverage", "what's tested", "coverage gaps", "test analysis"
- Readiness: "release ready", "pre-release", "readiness report", "can we ship"

If ambiguous, ask: "Which analysis mode? (coverage/readiness)" with descriptions. Default: coverage.

**Locate Artifacts:**

Before searching, check what the caller supplied. If a calling SOP passed `stories_file`, `design_file`, `nfr_file`, `test_plan_file`, `source_dir`, `test_dir`, or `output_dir`, You MUST use those values and skip the corresponding search below. A caller that collects its artifacts under its own output directory knows where they are; searching would find nothing and stall on a prompt. Search only for what the caller did not supply.

1. **Acceptance Criteria**: Check common locations:
   - `requirements-planning/outputs/user-stories.md`
   - `requirements/user-stories.md`
   - `docs/requirements/user-stories.md`
   - `user-stories.md`

   If not found, ask user for path.

2. **Test Plans**: Check common locations:
   - `implementation-development/outputs/test-strategy.md`
   - `implementation/test-strategy.md`
   - `docs/testing/test-strategy.md`
   - `test-strategy.md`

   If not found, ask user for path.

3. **Non-Functional Requirements**: Check common locations:
   - `design-architecture/outputs/non-functional-requirements.md`
   - `design/non-functional-requirements.md`
   - `docs/design/nfr.md`
   - `quality-requirements.md`
   - `nfrs.md`

   If not found, ask user for path.

4. **System Design**: Check common locations:
   - `design-architecture/outputs/system-design.md`
   - `design/system-design.md`
   - `docs/design/architecture.md`
   - `technical-design.md`
   - `architecture.md`

   If not found, ask user for path.

5. **Test Directories**: Auto-detect common patterns:
   - `tests/`, `test/`, `__tests__/`, `spec/`, `specs/`

   If not found, ask user for paths.

Validate all paths exist and are readable.

**Gather Preferences:**

1. Analysis Depth: "Detailed analysis?" (yes/no, default: no) → Yes: all tests, examples, recommendations | No: summary only
2. Test Types: "Which test types to analyze?" (unit/integration/e2e/all, default: all)

**Output:** `✅ Configuration: Mode: [mode] | Depth: [level] | Types: [types] | Report: [file_path]`

Store: mode, analysis_depth, test_directories, artifact_paths, output_file_path

**Requirements:** 1.1, 1.2

---

## Stage 2: Artifact Collection & Parsing

**Objective:** Load and parse acceptance criteria, test plans, and test files.

**Parse Acceptance Criteria:**

- Extract from user stories: requirement ID, acceptance criteria list, priority
- Build structure: `{ requirementId, userStory, acceptanceCriteria: [{ id, text, priority }] }`
- Criteria IDs: requirement + item (e.g., "1.1", "1.2")

**Parse Test Plans:**

- Extract from test strategy: test plan ID, type (unit/integration/e2e), description, requirements coverage
- Build structure: `{ planId, type, description, requirementRefs, testCases: [{ id, description, steps }] }`
- Identify test types and expected coverage

**Discover Test Files:**

**CRITICAL: Run Test Suite for Accurate Counts**

**Step 1: Execute Test Runner**

Run the project's test command to get accurate test counts:

```bash
# For JavaScript/TypeScript projects
npm run test 2>&1 | tee test-output.log

# For Python projects
pytest --collect-only

# For Java projects
mvn test -DskipTests=false

# For Go projects
go test -v ./...
```

**Extract Test Metrics from Output:**

- Total test files
- Total test cases (individual tests)
- Passed/failed counts
- Test duration
- Coverage percentage (if available)

**IMPORTANT:** Test FILES ≠ Test CASES

- A single test file may contain 10-50 test cases
- Always use test case count from test runner, not file count
- Example: 123 test files = 1,236 test cases

**Step 2: Discover Test File Patterns**

Scan test directories for common test file patterns:

**JavaScript/TypeScript:**

- `*.test.ts`, `*.test.tsx`, `*.test.js`, `*.test.jsx`
- `*.spec.ts`, `*.spec.tsx`, `*.spec.js`, `*.spec.jsx`
- `*.cy.ts`, `*.cy.js` (Cypress E2E)
- `*.e2e.ts`, `*.e2e.js` (E2E tests)

**Python:**

- `*_test.py`, `test_*.py`

**Java:**

- `*Test.java`, `*Tests.java`

**Go:**

- `*_test.go`

Group by type based on directory structure or naming:

- Unit: `unit/`, `__tests__/unit/`, `*.unit.test.*`, `*.unit.spec.*`
- Integration: `integration/`, `__tests__/integration/`, `*.integration.test.*`, `*.int.test.*`
- E2E: `e2e/`, `__tests__/e2e/`, `*.e2e.test.*`, `*.cy.*`, `cypress/`, `playwright/`, `tests/e2e/`

**Step 3: Parse Test Files**

Extract test metadata:

- Test name, describe blocks, test assertions
- Coverage comments: `// Tests: AC-1.1`, `// Covers: Req 2.3`
- Test patterns: `describe()`, `it()`, `test()`, `expect()`, `assert()`
- Build structure: `{ file, testName, type, requirementRefs, assertions, status }`

Apply error handling patterns for missing files, malformed tests, invalid formats.

**Step 4: Build Coverage Map**

Combine parsed data per feature. Calculate initial stats using test case counts from test runner.

**Report:** `Parsing Complete: [N] criteria | [M] test plans | [P] test files | [Q] test cases discovered`

**Example Output:**

```
Test Discovery Results:
- Test Files: 123 files
- Test Cases: 1,236 individual tests
- Test Suites: 8 packages
- Duration: 32.98s
- Status: 1,236 passed
```

**Update Progress Tracker:** Mark "Artifacts parsed" as complete and update timestamp.

**Store:** features_map, test_coverage_map, parsing_errors, nfr_map, integration_points_map

**Requirements:** 2.1, 2.2, 3.1

---

## Stage 3: Test Distribution Analysis

**Objective:** Analyze current test distribution and compare against recommended model.

Read the Stage 3 section of `references/stage-details.md` when you reach this stage; it holds the test-type categories, the percentage and delta formulas, the alignment statuses, and the distribution issues to look for.

**Report:** Use standard template. Summary: current vs expected distribution, alignment status, delta analysis. Distribution Comparison: table with current/expected/delta. Issues Identified: list with severity, impact, recommendations. Detailed mode: test file breakdown, specific examples. Summary mode: alignment status, critical issues.

**Update Progress Tracker:** Mark "Test distribution analyzed" as complete and update timestamp.

**Store:** validation_results.philosophy_analysis

**Requirements:** 0.4, 0.5

---

## Stage 4: Functional Test Coverage Analysis

**Objective:** Map tests to acceptance criteria and test plans, calculate functional coverage.

**Build Coverage Mapping:**

- For each acceptance criterion: find tests with matching requirement refs
- For each test plan: find implemented tests matching plan description
- Match strategies:
  1. Explicit refs in test comments (`// Tests: AC-1.1`)
  2. Test name similarity to criterion text (fuzzy match >70%)
  3. Test file location matching feature structure
  4. Test assertions matching expected behavior

**Calculate Coverage:**

- **Acceptance Criteria Coverage:** `(covered_criteria / total_criteria) * 100`
- **Test Plan Coverage:** `(implemented_plans / total_plans) * 100`
- **Test Type Coverage:** Per type (unit/integration/e2e)
- **Feature Coverage:** Per feature aggregation

**Coverage Status:**

- ✅ Covered: Automated test exists and passes
- ⚠️ Partial: Test exists but incomplete or failing
- ❌ Missing: No automated test found
- Manual: Requires manual testing (complex UI, external integrations)

**Report:** Use standard template. Summary: overall coverage %, criteria/plans breakdown, test type distribution. Feature Coverage: per-feature with progress bars, covered/partial/missing lists. Detailed mode: all mappings, test names, file paths. Summary mode: stats, critical gaps only.

**Update Progress Tracker:** Mark "Functional test coverage calculated" as complete and update timestamp.

**Store:** validation_results.functional_coverage_analysis

**Requirements:** 3.2, 3.3, 4.1

---

## Stage 5: Non-Functional Test Coverage Analysis

**Objective:** Validate non-functional requirements have corresponding tests.

**CRITICAL:** This stage identifies quality attribute gaps that functional tests miss (performance, security, reliability, scalability).

Read the Stage 5 section of `references/stage-details.md` when you reach this stage; it holds the NFR document lookup, the NFR-to-test-type mapping, the NFR test file patterns, and the coverage and gap rules.

**Report:** Use standard template. Summary: NFR coverage by category, total NFR coverage %. NFR Coverage by Category: table with category, total, covered, missing, coverage %. Critical NFR Gaps: list with NFR ID, requirement, missing test type, impact. Warning NFR Gaps: list with wrong test types. Recommendations: specific test implementations needed. Detailed mode: all NFRs with test mapping. Summary mode: category coverage, critical gaps.

**Update Progress Tracker:** Mark "Non-functional test coverage analyzed" as complete and update timestamp.

**Store:** validation_results.nfr_coverage_analysis

**Requirements:** 4.2, 4.3

---

## Stage 6: Integration Point Analysis

**Objective:** Validate all system integration points have corresponding integration tests.

**CRITICAL:** Use subagent to extract integration points from system design. This handles varied document structures, implicit integrations, and any AWS architecture.

Read the Stage 6 section of `references/stage-details.md` when you reach this stage; it holds Steps 1 and 2 (design document lookup and the integration extraction subagent prompt) and Steps 4 to 7 (test discovery, coverage map, coverage calculation, gap rules). Run Steps 1 and 2 from there, then Step 3 below, then Steps 4 to 7.

**Step 3: Validate Extraction**

After subagent completes:

1. Review extracted integration points for completeness
2. Check against architecture diagram (if available)
3. Identify any missing integrations
4. If unclear integrations found, ask user for clarification

**Report:** Use standard template. Summary: integration coverage by type, total integration coverage %. Integration Coverage by Type: table with type, total, covered, partial, missing, coverage %. Critical Integration Gaps: list with integration point, source, target, missing test, impact. Warning Integration Gaps: list with partial coverage, mock usage. Recommendations: specific integration tests needed with test approach. Detailed mode: all integration points with test mapping, error scenario coverage. Summary mode: type coverage, critical gaps.

**Update Progress Tracker:** Mark "Integration points analyzed" as complete and update timestamp.

**Store:** validation_results.integration_point_analysis

**Requirements:** 4.4, 4.5

---

## Stage 7: Gap Identification

**Objective:** Identify coverage gaps and categorize by severity using Kiro subagent-powered code analysis. Enhanced with negative test case analysis.

**CRITICAL:** Use Kiro's `invokeSubAgent` tool for detailed code analysis. This enables parallel analysis of different code types and provides file-level specificity.

**Subagent-Powered Analysis:**

Use the `invokeSubAgent` tool with `general-task-execution` agent to analyze code in parallel:

Read `references/gap-identification.md` when you reach this stage and before classifying gaps; it holds Steps 1 and 2 (code directory detection and the four subagent prompts), the gap classification heuristics, the recommendation guidance, a worked gap entry, and the subagent usage note. Run Steps 1 and 2 from there, then Step 3 below, then the classification.

**Step 3: Consolidate Subagent Results**

After all subagents complete:

1. Parse structured output from each subagent
2. Merge recommendations into unified gap list
3. Deduplicate overlapping recommendations
4. Prioritize by severity and testing philosophy alignment
5. Group by feature and test type
6. Add subagent attribution to track source

**Report:** Use standard template. Summary: gap counts by severity, manual test count, subagent usage. Critical Gaps: list with feature, criterion, impact, recommendation, file paths (from subagent analysis). Warning Gaps: list with improvement suggestions. Manual Testing Requirements: detailed procedures with steps. Detailed mode: all gaps, example tests, full procedures, subagent attribution. Summary mode: counts, critical gaps, high-priority manual tests.

**Update Progress Tracker:** Mark "Gaps identified (with subagent analysis)" as complete and update timestamp.

**Store:** validation_results.gap_analysis

**Requirements:** 4.2, 4.3, 5.1, 5.2

---

## Stage 8: Pattern Analysis

**Objective:** Analyze test patterns and quality indicators.

**Analyze Test Patterns:**

**Test Structure:**
- Naming conventions: descriptive vs cryptic
- Organization: grouped by feature vs scattered
- Setup/teardown: proper cleanup vs resource leaks
- Assertions: specific vs vague

**Test Quality Indicators:**
- Assertion count per test (target: 1-3)
- Test independence (no shared state)
- Mock usage (appropriate vs excessive)
- Test data management (fixtures vs inline)
- Error message clarity

**Anti-Patterns Detected:**
- ❌ Tests testing implementation details (especially in frontend)
- ❌ Flaky tests (timing dependencies)
- ❌ Overly complex tests (>50 lines)
- ❌ Missing assertions
- ❌ Commented-out tests
- ❌ Wrong test type for the scenario (unit test for integration scenario)
- ❌ Shallow rendering tests (testing component in isolation when integration needed)

**Best Practices Found:**
- ✅ Clear test names (Given-When-Then)
- ✅ Proper mocking and stubbing
- ✅ Complete edge case coverage (happy path, errors, boundaries)
- ✅ Good test data management
- ✅ Effective use of test helpers

**Calculate Quality Score:**
- Structure: 0-25 points
- Independence: 0-25 points
- Assertions: 0-25 points
- Patterns: 0-25 points
- Total: 0-100 (Excellent: 80+, Good: 60-79, Fair: 40-59, Poor: <40)

**Report:** Use standard template. Summary: quality score, pattern compliance %, anti-patterns count. Test Patterns: structure, quality indicators, best practices. Anti-Patterns: list with examples, impact, remediation. Quality Score: breakdown by category. Recommendations: pattern improvements with examples. Detailed mode: all patterns, code examples, refactoring guidance. Summary mode: score, critical anti-patterns, top recommendations.

**Update Progress Tracker:** Mark "Pattern analysis complete" as complete and update timestamp.

**Store:** validation_results.pattern_analysis

**Evaluate Test Value:**

Assign value scores to existing tests based on testing philosophy:

**High Value Tests:**
- E2E tests of critical user journeys (login, checkout, payment)
- Integration tests of core business workflows
- Integration tests of service + database interactions
- Contract tests between microservices

**Medium Value Tests:**
- Unit tests of complex business logic
- Integration tests of secondary features
- E2E tests of non-critical paths

**Low Value Tests:**
- Unit tests of simple utility functions
- Unit tests of React components (testing implementation)
- Unit tests of getters/setters
- Tests with no assertions

**Identify Low-Value Tests to Consider Removing:**

For frontend (Trophy model):
- Component unit tests that only test rendering
- Snapshot tests of component structure
- Tests of CSS class names or styling

For backend (Pyramid model):
- Tests of trivial getters/setters
- Tests of framework behavior (not your code)
- Duplicate tests at multiple levels

**Report:** Include test value assessment in pattern analysis section. List high-value tests to maintain, low-value tests to consider removing or refactoring.

**Requirements:** 6.1, 6.2, 6.3

---

## Stage 9: Readiness Assessment (Readiness Mode Only)

**Objective:** Evaluate release readiness based on test coverage and quality.

**Mode:** Readiness only.

**Calculate Readiness Metrics:**

**Coverage Thresholds:**

Apply thresholds based on testing philosophy:

**For Frontend (Trophy Model):**
- Critical user flows: 100% integration test coverage required
- High priority features: 90% integration test coverage required
- Complex business logic: 80% unit test coverage required
- Critical journeys: 100% E2E coverage required

**For Backend (Pyramid Model):**
- Business logic: 90% unit test coverage required
- Service layer: 80% integration test coverage required
- Critical API workflows: 100% E2E coverage required
- Utility functions: 80% unit test coverage required

**For Serverless (Hybrid Model):**
- Lambda handlers: 85% unit test coverage required
- AWS service integration: 80% integration test coverage required
- API workflows: 90% E2E coverage required

**For Microservices:**
- Service logic: 85% unit test coverage required
- Service integration: 75% integration test coverage required
- Inter-service contracts: 100% contract test coverage required
- Critical workflows: 90% E2E coverage required

**Quality Gates:**
- No failing tests
- No critical gaps
- Test distribution aligned with philosophy (within ±15%)
- Test quality score ≥60
- All security tests passing
- Performance tests within SLA
- High-value tests present for critical features

**Readiness Status:**
- ✅ Ready: All gates passed, coverage meets thresholds
- ⚠️ At Risk: Minor gaps, coverage slightly below threshold, quality concerns
- ❌ Not Ready: Critical gaps, failing tests, coverage significantly below threshold

**Risk Assessment:**
- **High Risk:** Critical gaps, no tests for core functionality, failing security tests
- **Medium Risk:** Warning gaps, partial coverage, quality score <60
- **Low Risk:** Minor gaps, coverage meets minimum, quality acceptable

**Generate Release Checklist:**
- [ ] All critical acceptance criteria covered
- [ ] All test plans implemented
- [ ] No failing tests
- [ ] Security tests passing
- [ ] Performance tests within SLA
- [ ] Manual testing completed
- [ ] Test quality score ≥60
- [ ] Critical gaps addressed

**Report:** Use standard template. Summary: readiness status, risk level, gates passed. Coverage vs Thresholds: per-feature comparison. Quality Gates: checklist with status. Risk Assessment: high/medium/low risks with mitigation. Release Checklist: items with status. Blocking Issues: must-fix before release. Recommendations: prioritized actions. Detailed mode: all metrics, detailed risks, full checklist. Summary mode: status, blocking issues, critical actions.

**Update Progress Tracker:** Mark "Readiness assessment complete" as complete and update timestamp.

**Store:** validation_results.readiness_assessment

**Requirements:** 7.1, 7.2, 7.3

---

## Stage 10: Risk Evaluation (Readiness Mode Only)

**Objective:** Evaluate risks associated with identified gaps.

**Mode:** Readiness only.

**Categorize Risks:**

**Technical Risks:**
- Untested code paths leading to runtime errors
- Missing integration tests causing system failures
- Inadequate E2E coverage missing user-facing bugs
- Performance issues not caught by tests
- Wrong test types providing false confidence (unit tests when integration needed)
- Testing implementation details instead of behavior

**Business Risks:**
- Core features failing in production
- Security vulnerabilities exploited
- Data loss or corruption
- Poor user experience
- Compliance violations

**Operational Risks:**
- Difficult troubleshooting without proper test coverage
- Regression introduction during maintenance
- Increased support burden
- Delayed hotfix deployment

**Calculate Risk Scores:**
- Probability: High (>70%), Medium (30-70%), Low (<30%)
- Impact: Critical (system down), High (feature broken), Medium (degraded), Low (minor)
- Risk Score: Probability × Impact
- Priority: Critical (>70), High (50-70), Medium (30-50), Low (<30)

**Generate Mitigation Strategies:**
For each high/critical risk:
- Immediate actions (before release)
- Short-term mitigations (post-release monitoring)
- Long-term solutions (test coverage improvements)

**Report:** Use standard template. Summary: risk count by category, critical risks count. Risk Matrix: probability vs impact grid. Technical Risks: list with score, mitigation. Business Risks: list with impact, mitigation. Operational Risks: list with likelihood, mitigation. Mitigation Strategies: prioritized actions with timeline. Detailed mode: all risks, detailed mitigations, cost-benefit analysis. Summary mode: critical risks, immediate actions.

**Update Progress Tracker:** Mark "Risk evaluation complete" as complete and update timestamp.

**Store:** validation_results.risk_evaluation

**Requirements:** 7.4, 7.5

---

## Final Report Generation

After completing mode-specific stages, finalize the consolidated report:

**Executive Summary:** Overall coverage, readiness status (if applicable), critical gaps count, manual tests required.

**Validation Results:** Include completed stages based on mode (Coverage: 0, 1, 2, 3, 4, 5, 6, 7, 8 | Readiness: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10).

**Consolidated Recommendations:** Critical actions (must fix), warnings (should fix), manual testing requirements, quality improvements.

**Next Steps:** Mode-specific guidance (Coverage: address gaps, align distribution with philosophy, implement recommended test types | Readiness: fix blocking issues, complete checklist, ensure test distribution alignment).

**Update Progress Tracker:** Mark "Report finalized" as complete and update timestamp.

**Report Location:** Confirm file saved at user-specified path: `[output_file_path]`

Print the final output message from `references/report-templates.md`.

**Requirements:** 9.1, 9.2, 9.3

---

## Usage Examples

The three worked examples are in `references/usage-examples.md`.

---

## Output Formats

The coverage and readiness report formats are in `references/report-templates.md`.

---

## Limitations and lessons

**Known Limitations:**

- Test discovery relies on common naming patterns
- Requirement reference extraction depends on comment format
- Manual test identification requires explicit markers
- Test case count accuracy depends on test runner output parsing
- File count vs test case count distinction must be clear in reports
- Subagent analysis requires Kiro environment (falls back to pattern-based otherwise)

**Critical Lessons Learned:**

- **Always run test suite** to get accurate test case counts
- **Test files ≠ test cases** - a single file may contain 10-50 tests
- **Use test runner output** as source of truth, not file system scanning
- **Example:** 123 test files = 1,236 test cases (10x difference)
- **Classification matters:** Different definitions of "integration test" lead to different distributions

---

## Quality Gate

**CRITICAL (must fix):**

- Happy path for core user journeys has no test coverage
- Error handling paths have no tests
- Security-sensitive operations (auth, data access) have no tests

**IMPORTANT (should fix):**

- Edge cases and boundary conditions not tested
- Integration tests missing for external service dependencies
- Performance tests missing for operations with SLA targets

**SUGGESTION:**

- Could add contract tests for API boundaries
- Could identify flaky test patterns in existing suite

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
