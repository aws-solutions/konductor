---
name: test-coverage-analysis
description: Analyzes test coverage across unit, integration, and E2E tests to identify gaps. Use after implementation to find missing test scenarios before release. Operates in two modes — coverage (test analysis) and release readiness (deployment validation).
version: 1.0.0
tags: [skill, testing, coverage, gap-analysis, quality-assurance]
---

# Test Coverage Analysis

## Overview

Compares implementation code against existing test suites to identify missing test scenarios. Maps tests to acceptance criteria and generates specific recommendations for additional tests needed.

## Usage

Use this skill when:

- Checking test coverage after implementation before release
- Identifying which acceptance criteria lack test coverage
- Validating release readiness before production deployment

## Core Concepts

### Two Modes

Coverage mode analyzes test distribution, maps tests to acceptance criteria, and identifies gaps by feature and test type (unit, integration, E2E). Release Readiness mode validates deployment readiness, checks operational requirements, and assesses production preparedness.

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

### Data Structures

**Test Coverage Map:**

```typescript
coverage_map: Map<
  featureName,
  {
    acceptance_criteria: [{ id; text; priority }];
    test_plans: [{ id; type; description; requirements }];
    discovered_tests: {
      unit: [{ file; testName; coverage; status }];
      integration: [{ file; testName; coverage; status }];
      e2e: [{ file; testName; coverage; status }];
    };
    coverage_stats: {
      total_criteria;
      covered_criteria;
      coverage_percentage;
      total_plans;
      covered_plans;
      plan_coverage_percentage;
      test_counts: { unit; integration; e2e };
      test_distribution: { unit_pct; integration_pct; e2e_pct };
    };
    gaps: [{ type; severity; description; recommendation }];
  }
>;
```

**Testing Philosophy:**

```typescript
{
  architecture_type: "frontend"|"backend"|"fullstack"|"serverless"|"microservices",
  recommended_model: "pyramid"|"trophy"|"hybrid",
  expected_distribution: { unit_pct, integration_pct, e2e_pct },
  rationale: string,
  focus_areas: string[]
}
```

**Validation State:**

```typescript
{
  mode: "coverage"|"readiness",
  analysis_depth: "summary"|"detailed",
  test_directories: string[],
  testing_philosophy: TestingPhilosophy,
  features_map, test_coverage_map,
  validation_results: {
    philosophy_analysis?, coverage_analysis?, gap_analysis?,
    pattern_analysis?, readiness_assessment?, risk_evaluation?,
    recommendations?
  }
}
```

### Visual Indicators

Use consistently across all reports:

- ✅ Covered/Pass | ❌ Missing/Fail | ⚠️ Partial/Warning | 🔍 Manual Required
- 🧪 Unit Test | 🔗 Integration Test | 🌐 E2E Test | 📋 Test Plan
- 🚨 Critical Gap | ⚠️ Warning Gap | 💡 Suggestion

**Coverage Bar:** `[████████░░] 80% (8/10)` (each block = 10%)

### Standard Report Template

All reports follow this structure (customize sections per mode):

**CRITICAL: Progress Tracker**

Include at the top of the report file and update as stages complete:

```markdown
## Progress Tracker

- [x] Analysis started
- [ ] Testing philosophy detected
- [ ] Artifacts parsed
- [ ] Test distribution analyzed
- [ ] Functional test coverage calculated
- [ ] Non-functional test coverage analyzed
- [ ] Integration points analyzed
- [ ] Gaps identified (with subagent analysis)
- [ ] Pattern analysis complete
- [ ] Readiness assessment complete (Readiness mode only)
- [ ] Risk evaluation complete (Readiness mode only)
- [ ] Report finalized

**Last Updated:** [TIMESTAMP]
```

**Report Structure:**

```
═══════════════════════════════════════════════════
TEST GAP ANALYSIS REPORT
═══════════════════════════════════════════════════

Analysis Date: [CURRENT_DATE] | Mode: [mode] | Features: [N]

## EXECUTIVE SUMMARY

**Overall Test Coverage:** [X]%
**Release Readiness:** [Ready/At Risk/Not Ready]

| Test Type     | Total | Covered | Missing | Coverage |
|---------------|-------|---------|---------|----------|
| Unit          | [N]   | [M]     | [P]     | [X]%     |
| Integration   | [N]   | [M]     | [P]     | [Y]%     |
| E2E           | [N]   | [M]     | [P]     | [Z]%     |

**Critical Gaps:** [N] | **Warnings:** [M] | **Manual Tests Required:** [P]

## [MODE-SPECIFIC SECTIONS]
[Content varies by analysis mode]

## RECOMMENDATIONS

### Critical Actions (Must Address Before Release)
[numbered list with specific test implementations needed]

### Warnings (Should Address)
[numbered list with recommended improvements]

### Manual Testing Requirements
[specific scenarios requiring manual validation]

## NEXT STEPS
[Mode-specific guidance]
```

### Error Handling Patterns

**File System:** Missing test directories → scan common locations, report findings | Permission errors → report issue, suggest alternatives | Invalid paths → provide error, suggest correction

**Parsing:** Malformed test files → report file, skip, continue | Missing test metadata → log warning, extract available | Invalid test syntax → skip test, log line, show correct format

**Validation:** Coverage gaps → identify, provide remediation, continue with warnings | Missing test plans → report features, suggest creation | Invalid test patterns → report issues, suggest corrections

**General:** Fail gracefully with partial data | Provide context (file paths, line numbers, test names) | Suggest concrete fixes | Prioritize: Critical (blocks release) vs Warnings (should fix) vs Info (nice to have)

---

## Stage 0: Testing Philosophy Detection

**Objective:** Determine application architecture and recommend appropriate testing model.

**CRITICAL:** This stage establishes the foundation for all subsequent analysis. The testing model determines what "good coverage" means.

**Detect Architecture Type:**

Analyze codebase structure and design documents to identify:

**Frontend Application Indicators:**

- Presence of: `src/components/`, `src/pages/`, `public/`, `package.json` with React/Vue/Angular
- UI framework dependencies: react, vue, angular, svelte
- Build tools: webpack, vite, create-react-app
- State management: redux, mobx, zustand, pinia
- Design docs mention: UI components, user interface, frontend

**Backend Application Indicators:**

- Presence of: `src/services/`, `src/controllers/`, `src/models/`, API routes
- Backend frameworks: express, fastify, nestjs, flask, django, spring
- Database clients: prisma, typeorm, mongoose, sqlalchemy
- Design docs mention: API endpoints, services, business logic, backend

**Serverless Indicators:**

- Presence of: Lambda handlers, `serverless.yml`, `template.yaml`, CDK stacks
- AWS SDK usage: @aws-sdk, boto3
- Event-driven patterns: SQS, SNS, EventBridge handlers
- Design docs mention: Lambda, serverless, event-driven

**Microservices Indicators:**

- Multiple service directories with independent deployments
- Service mesh configuration: istio, linkerd
- Inter-service communication: gRPC, REST APIs, message queues
- Design docs mention: microservices, service boundaries, distributed

**Full-Stack Indicators:**

- Both frontend and backend directories present
- Monorepo structure with multiple packages
- Shared types/models between frontend and backend
- Design docs mention: full-stack, end-to-end

**Recommend Testing Model:**

**Testing Pyramid (Backend/API/Libraries):**

```
Expected Distribution:
- Unit Tests: 70-80% (business logic, utilities, pure functions)
- Integration Tests: 15-20% (service layer, database, external APIs)
- E2E Tests: 5-10% (critical API workflows)

Rationale:
- Backend logic is deterministic and easily unit tested
- Integration tests validate service interactions
- E2E tests ensure API contracts work end-to-end
- Fast feedback loop with mostly unit tests

Focus Areas:
- Business logic correctness
- Service layer integration with databases
- API contract validation
- Error handling and edge cases
```

**Testing Trophy (Frontend/UI Applications):**

```
Expected Distribution:
- Unit Tests: 20-30% (complex business logic, utilities only)
- Integration Tests: 50-60% (component integration, user flows)
- E2E Tests: 15-20% (critical user journeys)
- Static Analysis: Foundation (TypeScript, ESLint)

Rationale:
- Frontend components work together, not in isolation
- Integration tests provide highest confidence
- Unit tests for components test implementation details
- E2E tests validate critical user experiences

Focus Areas:
- User interaction flows
- Component integration with state/context
- Form validation and submission
- Navigation and routing
- API integration from UI perspective
```

**Hybrid Model (Full-Stack/Serverless):**

```
Expected Distribution:
- Unit Tests: 40-50% (business logic, utilities, Lambda handlers)
- Integration Tests: 35-45% (service integration, API flows, AWS services)
- E2E Tests: 10-15% (critical user journeys, API workflows)

Rationale:
- Balance between backend logic testing and integration validation
- Serverless requires more integration tests with AWS services
- Full-stack needs both component and API testing

Focus Areas:
- Lambda handler logic
- AWS service integration (DynamoDB, S3, SQS)
- API Gateway → Lambda → Database flows
- Frontend component integration
- End-to-end user workflows
```

**Microservices Model:**

```
Expected Distribution:
- Unit Tests: 40-50% (service business logic)
- Integration Tests: 30-40% (service integration, database)
- Contract Tests: 15-20% (inter-service contracts)
- E2E Tests: 5-10% (critical cross-service workflows)

Rationale:
- Each service needs strong unit test coverage
- Contract tests prevent breaking changes between services
- Integration tests validate service boundaries
- E2E tests ensure distributed workflows function

Focus Areas:
- Service business logic
- Database integration per service
- API contracts between services
- Message queue integration
- Distributed transaction flows
```

**Generate Philosophy Report:**

Create or update the report file with philosophy analysis:

```
═══════════════════════════════════════════════════
TESTING PHILOSOPHY ANALYSIS
═══════════════════════════════════════════════════

Architecture Detected: [Type]
Recommended Model: [Pyramid|Trophy|Hybrid|Microservices]

Expected Test Distribution:
- Unit Tests: [X]%
- Integration Tests: [Y]%
- E2E Tests: [Z]%
[- Contract Tests: [W]%] (if microservices)

Rationale:
[Explanation of why this model fits the architecture]

Focus Areas:
1. [Primary focus area]
2. [Secondary focus area]
3. [Tertiary focus area]

This philosophy will guide coverage analysis and gap identification.
```

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

**Calculate Current Distribution:**

**CRITICAL: Use Test Runner Output for Accurate Counts**

**Step 1: Get Test Counts from Test Runner**

Use the test runner output from Stage 2 to get accurate test case counts:

- Total test cases (not files)
- Test cases by package/module
- Passed/failed status

**Step 2: Categorize Tests by Type**

Analyze test files to categorize by type:

**Unit Tests:**

- Tests in `unit/`, `__tests__/unit/`, `*.unit.test.*`
- Tests of single functions/classes in isolation
- All dependencies mocked
- Fast execution (<100ms per test)
- Examples: utility functions, business logic, data transformations

**Integration Tests:**

- Tests in `integration/`, `__tests__/integration/`, `*.integration.test.*`
- Tests of multiple components working together
- May use mocked or real services
- Test component interactions
- Examples: facade + services, handler + middleware, component + API

**E2E Tests:**

- Tests in `e2e/`, `__tests__/e2e/`, `*.e2e.test.*`, `*.cy.*`, `cypress/`, `playwright/`
- Tests of complete user workflows
- Test full stack (UI → API → Database)
- Use real or near-real environments
- Examples: login flow, checkout process, complete lease lifecycle

**Step 3: Calculate Percentages**

Using test case counts (not file counts):

- `unit_pct = (unit_test_cases / total_test_cases) * 100`
- `integration_pct = (integration_test_cases / total_test_cases) * 100`
- `e2e_pct = (e2e_test_cases / total_test_cases) * 100`

**Example Calculation:**

```
Test Runner Output: 1,236 total test cases
- Unit test files: 25 files with ~250 test cases (20%)
- Integration test files: 97 files with ~900 test cases (73%)
- E2E test files: 11 files with ~86 test cases (7%)

Distribution: 20% unit, 73% integration, 7% E2E
```

**Compare Against Expected Distribution:**

From Stage 0 testing philosophy, get expected distribution.

Calculate alignment:

- `unit_delta = current_unit_pct - expected_unit_pct`
- `integration_delta = current_integration_pct - expected_integration_pct`
- `e2e_delta = current_e2e_pct - expected_e2e_pct`

**Alignment Status:**

- ✅ Aligned: All deltas within ±10%
- ⚠️ Misaligned: One or more deltas between ±10% and ±25%
- ❌ Severely Misaligned: One or more deltas > ±25%

**Identify Distribution Issues:**

**Too Many Unit Tests:**

- Symptom: `unit_delta > +15%`
- Problem: Testing implementation details instead of behavior
- Common in: Frontend apps with component unit tests
- Recommendation: Convert component unit tests to integration tests

**Too Few Integration Tests:**

- Symptom: `integration_delta < -15%`
- Problem: Not testing how components work together
- Common in: All application types
- Recommendation: Add integration tests for user flows and service interactions

**Too Many/Few E2E Tests:**

- Symptom: `e2e_delta > +10%` or `< -10%`
- Problem: Either too slow (too many) or insufficient confidence (too few)
- Recommendation: Focus E2E on critical user journeys only

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

**Parse Non-Functional Requirements:**

**Step 1: Locate NFR Document**

Check for common names:

- `non-functional-requirements.md`
- `nfr.md`
- `quality-requirements.md`
- `nfrs.md`
- `non-functional-reqs.md`

If not found, ask user for path.

**Step 2: Extract NFR Data**

Load NFR document and extract:

- NFR ID (e.g., NFR-P1, NFR-S1)
- Category (Performance, Security, Reliability, Scalability, etc.)
- Requirement text with measurable criteria
- Build structure: `{ nfrId, category, requirement, measurableCriteria }`

**Map NFR Categories to Required Test Types:**

**Performance NFRs → Load/Performance Tests:**

- Response time requirements → Latency validation tests
- Throughput requirements → Load tests with concurrent users
- Resource utilization → Performance profiling tests

**Security NFRs → Security Tests:**

- Encryption requirements → Encryption validation tests
- Authentication requirements → Auth flow tests
- Authorization requirements → RBAC tests
- Audit logging → Log validation tests

**Reliability NFRs → Reliability Tests:**

- Availability requirements → Uptime monitoring tests
- Retry logic → Failure injection tests
- Backup/recovery → Disaster recovery tests
- Error handling → Error scenario tests

**Scalability NFRs → Scalability Tests:**

- Concurrent user requirements → Concurrency tests
- Auto-scaling requirements → Scale-up/down tests
- Capacity limits → Stress tests

**Usability NFRs → Usability Tests:**

- UI responsiveness → UI interaction tests
- Accessibility → Screen reader/keyboard tests
- Error messages → Error display tests

**Maintainability NFRs → Code Quality Tests:**

- Logging requirements → Log format validation
- Monitoring requirements → Metrics emission tests
- Code coverage → Coverage threshold tests

**Compliance NFRs → Compliance Tests:**

- Data residency → Region validation tests
- Regulatory standards → Compliance validation tests

**Discover NFR-Related Tests:**

Search for test files matching NFR categories (language-agnostic patterns):

**Performance Tests:**

- `*performance*.test.*`, `*perf*.test.*`
- `*load*.test.*`, `*load-test*.*`
- `*latency*.test.*`, `*benchmark*.test.*`
- `test/performance/`, `tests/load/`

**Security Tests:**

- `*security*.test.*`, `*sec*.test.*`
- `*auth*.test.*`, `*authentication*.test.*`, `*authorization*.test.*`
- `*encryption*.test.*`, `*crypto*.test.*`
- `test/security/`, `tests/auth/`

**Reliability Tests:**

- `*retry*.test.*`, `*resilience*.test.*`
- `*failover*.test.*`, `*recovery*.test.*`
- `*chaos*.test.*`, `*fault*.test.*`
- `test/reliability/`, `tests/resilience/`

**Scalability Tests:**

- `*concurrency*.test.*`, `*concurrent*.test.*`
- `*scale*.test.*`, `*scaling*.test.*`
- `*stress*.test.*`, `*capacity*.test.*`
- `test/scalability/`, `tests/load/`

**Accessibility Tests:**

- `*accessibility*.test.*`, `*a11y*.test.*`
- `*wcag*.test.*`, `*aria*.test.*`
- `test/accessibility/`, `tests/a11y/`

**Compliance Tests:**

- `*compliance*.test.*`, `*audit*.test.*`
- `*gdpr*.test.*`, `*hipaa*.test.*`
- `test/compliance/`

**Build NFR Coverage Map:**

For each NFR:

- Identify required test type based on category
- Search for matching tests
- Status: Covered (test exists), Wrong Type (unit test for performance NFR), Missing (no test)

**Calculate NFR Coverage:**

Per category:

- `(covered_nfrs / total_nfrs) * 100`

Overall:

- `(total_covered_nfrs / total_nfrs) * 100`

**Identify NFR Gaps:**

**Critical NFR Gaps:**

- Performance NFRs with no load tests
- Security NFRs with no security tests
- Scalability NFRs with no concurrency tests

**Warning NFR Gaps:**

- NFRs tested with wrong test type (unit test for performance NFR)
- Reliability NFRs with partial coverage
- Compliance NFRs with no validation

**Report:** Use standard template. Summary: NFR coverage by category, total NFR coverage %. NFR Coverage by Category: table with category, total, covered, missing, coverage %. Critical NFR Gaps: list with NFR ID, requirement, missing test type, impact. Warning NFR Gaps: list with wrong test types. Recommendations: specific test implementations needed. Detailed mode: all NFRs with test mapping. Summary mode: category coverage, critical gaps.

**Update Progress Tracker:** Mark "Non-functional test coverage analyzed" as complete and update timestamp.

**Store:** validation_results.nfr_coverage_analysis

**Requirements:** 4.2, 4.3

---

## Stage 6: Integration Point Analysis

**Objective:** Validate all system integration points have corresponding integration tests.

**CRITICAL:** Use subagent to extract integration points from system design. This handles varied document structures, implicit integrations, and any AWS architecture.

**Step 1: Locate System Design Document**

Check for common names:

- `system-design.md`
- `architecture.md`
- `technical-design.md`
- `design-doc.md`

If not found, ask user for path.

**Step 2: Invoke Integration Extraction Subagent**

Use `invokeSubAgent` with `general-task-execution` to extract integration points:

```
Tool: invokeSubAgent
Parameters:
  name: "general-task-execution"
  prompt: "Analyze the system design document at [path] and extract all integration points:

1. Read the entire document carefully, including:
   - Architecture Overview section
   - Components section (each component's inputs/outputs)
   - Data Flow descriptions
   - API Design section
   - Cross-Cutting Concerns section

2. Identify all component interactions, data flows, and service dependencies

3. Look for both explicit integrations (clearly stated) and implicit integrations (inferred from context)

For each integration point, extract:
- Source component (what initiates the interaction)
- Target component (what receives/responds)
- Protocol or mechanism (HTTP, REST, gRPC, SDK call, event, message queue, direct invocation)
- Description of the interaction
- Whether it's synchronous or asynchronous
- Criticality (critical path, secondary, monitoring)

Include all types of integrations:

**Frontend to Backend:**
- React/Vue/Angular → API Gateway
- SPA → REST API
- Web UI → GraphQL API
- Mobile App → Backend API

**Backend to Database:**
- Lambda → DynamoDB
- ECS → RDS
- EC2 → Aurora
- Lambda → S3 (object storage)
- ECS → ElastiCache

**Service to AWS Service:**
- Lambda → S3, DynamoDB, SQS, SNS, EventBridge, Secrets Manager, Parameter Store
- ECS → Any AWS service via SDK
- EC2 → Any AWS service via SDK
- Step Functions → Lambda, ECS, other AWS services

**Orchestration:**
- Step Functions → Lambda
- EventBridge → Lambda/ECS/Step Functions/SQS
- SQS → Lambda (event source mapping)
- Kinesis → Lambda

**Messaging & Events:**
- SNS → SQS → Lambda
- EventBridge → Multiple targets
- Kinesis Data Streams → Lambda/Kinesis Analytics
- DynamoDB Streams → Lambda

**API Layer:**
- API Gateway → Lambda (REST API)
- API Gateway → HTTP backend (HTTP API)
- Application Load Balancer → ECS
- Network Load Balancer → EC2
- AppSync → Lambda (GraphQL)

**Monitoring (often implicit):**
- All components → CloudWatch Logs
- All components → CloudWatch Metrics
- All components → X-Ray tracing
- Lambda → CloudWatch Insights

**Authentication (often implicit):**
- API Gateway → Cognito Authorizer
- API Gateway → Lambda Authorizer
- Lambda → Cognito User Pool (SDK)
- Frontend → Cognito Hosted UI

**Container Orchestration:**
- ECS Service → ECS Task
- EKS → Pods
- App Runner → Container

Be thorough and flexible:
- Don't limit to examples above - extract ALL integrations found
- Include implicit integrations (logging, monitoring, auth)
- Infer integrations from component descriptions (e.g., 'ECS service persists data' implies ECS → Database)
- Note if integration details are unclear or ambiguous

Format as structured list:
- Integration ID (e.g., INT-001)
- Source → Target
- Protocol/Mechanism
- Description
- Sync/Async
- Criticality (critical, secondary, monitoring)
- Clarity (explicit, inferred, unclear)"

  explanation: "Extracting all integration points from system design to validate integration test coverage"
```

**Step 3: Validate Extraction**

After subagent completes:

1. Review extracted integration points for completeness
2. Check against architecture diagram (if available)
3. Identify any missing integrations
4. If unclear integrations found, ask user for clarification

**Step 4: Discover Integration Tests**

Search for integration test files:

- `*integration*.test.*`
- `test/integration/`
- `__tests__/integration/`
- E2E tests that validate integration flows

Parse integration tests for:

- Which integration points are tested
- Test coverage of success and error scenarios
- Whether tests use real services or mocks

**Step 5: Build Integration Coverage Map**

For each integration point:

- Check if integration test exists
- Status:
  - ✅ Covered: Integration test exists with success and error scenarios
  - ⚠️ Partial: Test exists but only covers success path
  - ⚠️ Mocked: Test uses mocks instead of real service integration
  - ❌ Missing: No integration test found
- Identify specific test gaps: missing error scenarios, missing edge cases

**Step 6: Calculate Integration Coverage**

Per integration type:

- API Layer: `(covered / total) * 100`
- Compute → Data: `(covered / total) * 100`
- Orchestration: `(covered / total) * 100`
- Messaging: `(covered / total) * 100`
- Monitoring: `(covered / total) * 100`

Overall:

- `(total_covered_integrations / total_integrations) * 100`

**Step 7: Identify Integration Gaps**

**Critical Integration Gaps (Must Fix):**

- Core data flow integrations untested (Compute → Database)
- Authentication integrations untested (API → Cognito)
- API integrations untested (Frontend → Backend)
- Critical path integrations with no error scenario tests

**Warning Integration Gaps (⚠️ Should Fix):**

- Integration tests only cover success paths (no error scenarios)
- Integration tests use mocks instead of real services (not true integration tests)
- Secondary integrations untested (logging, monitoring)
- Async integrations untested (message queues, events)

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

**Step 1: Identify Code Directories by Architecture Type**

Based on Stage 0 architecture detection, identify code directories dynamically:

**Method 1: File System Scanning (Recommended)**

Scan project for code directories:

- **Frontend**: Find directories containing UI framework files:
  - React: `*.tsx`, `*.jsx` files with component patterns
  - Vue: `*.vue` files
  - Angular: `*.component.ts` files
  - Common patterns: `components/`, `pages/`, `views/`, `screens/`

- **Backend**: Find directories containing server/API files:
  - Services: `*.service.ts`, `*.service.js`
  - Controllers: `*.controller.ts`, `*.controller.js`
  - Models: `*.model.ts`, `*.model.js`
  - Common patterns: `services/`, `controllers/`, `api/`, `routes/`

- **Serverless**: Find directories containing Lambda/function files:
  - Lambda handlers: `handler.ts`, `*.handler.ts`, `index.ts` in function directories
  - Common patterns: `lambda/`, `functions/`, `handlers/`, `src/handlers/`

- **Microservices**: Find multiple service directories:
  - Look for: Multiple directories with independent `package.json` or `pom.xml`
  - Common patterns: `services/*/`, `packages/*/`, `apps/*/`

**Method 2: Ask User (Fallback)**

If automatic detection is unclear, ask:
"Which directories contain your [frontend/backend/serverless/microservices] code? (comma-separated paths)"

**Store discovered directories for subagent invocation.**

**Step 2: Invoke Subagents in Parallel**

For each detected architecture type, invoke a subagent with a specialized prompt:

**Frontend Analysis Subagent:**

```
Prompt: "Analyze frontend code in [src/components/, src/pages/] and identify test gaps:

1. User interaction flows needing integration tests (forms, navigation, state changes)
2. Complex business logic needing unit tests (validation, calculations, transformations)
3. Critical user journeys needing E2E tests (login, checkout, core workflows)
4. Component rendering currently tested with unit tests that should be integration tests
5. Error scenarios and negative test cases (invalid input, API errors, edge cases)

For each identified gap, provide:
- File path and component/function name
- Current test status (none, unit test exists, wrong test type)
- Recommended test type with rationale based on Testing Trophy model
- Estimated effort (1-2 hours, 2-4 hours, 4+ hours)
- Priority (critical, high, medium, low)
- Test category (positive flow, negative case, error scenario, edge case)

Format output as structured list with clear sections."
```

**Backend Analysis Subagent:**

```
Prompt: "Analyze backend code in [src/services/, src/controllers/] and identify test gaps:

1. Business logic functions needing unit tests (pure functions, calculations, validations)
2. Service layer methods needing integration tests with database
3. API workflows needing E2E tests (request → service → database → response)
4. Utility functions needing unit tests
5. Error handling and negative test cases (invalid input, database errors, timeout scenarios)

For each identified gap, provide:
- File path and function/class name
- Current test status (none, partial coverage, wrong test type)
- Recommended test type with rationale based on Testing Pyramid model
- Estimated effort (1-2 hours, 2-4 hours, 4+ hours)
- Priority (critical, high, medium, low)
- Test category (positive flow, negative case, error scenario, edge case)

Format output as structured list with clear sections."
```

**Serverless Analysis Subagent:**

```
Prompt: "Analyze serverless code in [src/handlers/, lambda/] and identify test gaps:

1. Lambda handler logic needing unit tests (handler function logic, input validation)
2. Lambda + AWS service interactions needing integration tests (DynamoDB, S3, SQS)
3. API Gateway → Lambda → DynamoDB flows needing E2E tests
4. Event processing logic needing integration tests (SQS, SNS, EventBridge)
5. Error handling and negative test cases (invalid events, AWS service errors, timeout scenarios)

For each identified gap, provide:
- File path and handler name
- Current test status (none, partial coverage, wrong test type)
- Recommended test type with rationale based on Hybrid testing model
- Estimated effort (1-2 hours, 2-4 hours, 4+ hours)
- Priority (critical, high, medium, low)
- Test category (positive flow, negative case, error scenario, edge case)

Format output as structured list with clear sections."
```

**Microservices Analysis Subagent:**

```
Prompt: "Analyze microservices code in [services/*/src/] and identify test gaps:

1. Service business logic needing unit tests (domain logic, business rules)
2. Service + database interactions needing integration tests
3. Inter-service API calls needing contract tests (API contracts, message schemas)
4. Cross-service workflows needing E2E tests (distributed transactions)
5. Error handling and negative test cases (service unavailable, network errors, timeout scenarios)

For each identified gap, provide:
- File path and service/function name
- Current test status (none, partial coverage, wrong test type)
- Recommended test type with rationale based on Microservices testing model
- Estimated effort (1-2 hours, 2-4 hours, 4+ hours)
- Priority (critical, high, medium, low)
- Test category (positive flow, negative case, error scenario, edge case)

Format output as structured list with clear sections."
```

**Step 3: Consolidate Subagent Results**

After all subagents complete:

1. Parse structured output from each subagent
2. Merge recommendations into unified gap list
3. Deduplicate overlapping recommendations
4. Prioritize by severity and testing philosophy alignment
5. Group by feature and test type
6. Add subagent attribution to track source

**Identify Gaps:**

**Critical Gaps (Must Fix):**

- Acceptance criteria with no tests (priority: high)
- Test plans with no implementation
- Core functionality untested (authentication, data persistence, critical workflows)
- Security requirements without tests
- NFRs with no corresponding tests (performance, security, reliability)
- Integration points with no integration tests
- Error scenarios with no negative tests

**Warning Gaps (⚠️ Should Fix):**

- Acceptance criteria with partial coverage
- Test plans partially implemented
- Edge cases untested
- Error handling paths untested
- Performance requirements without tests
- NFRs tested with wrong test type (unit test for performance NFR)
- Integration tests only covering success paths
- Missing boundary condition tests

**Manual Testing Required (🔍):**

- Complex UI interactions (drag-and-drop, animations)
- External service integrations (payment gateways, third-party APIs)
- Browser compatibility testing
- Accessibility testing (screen readers, keyboard navigation)
- User experience validation

**Build Gap Records:**
For each gap: `{ gapId, type, severity, feature, criterion/plan/nfr/integration, description, impact, recommendation, manualTestRequired, recommendedTestType, file, component/function, currentTestStatus, rationale, estimatedEffort, priority, subagentSource, testCategory }`

**Test Category Classification:**

- `positive_flow`: Happy path tests
- `negative_case`: Invalid input, error conditions
- `error_scenario`: System failures, timeouts, unavailability
- `edge_case`: Boundary conditions, limits, special cases
- `nfr_validation`: Non-functional requirement validation
- `integration_validation`: Service integration validation

**Prioritize Gaps:**

1. Critical gaps by feature priority
2. Warning gaps by risk level
3. Manual tests by complexity

**Generate Recommendations:**

**For Missing Tests:** Specific test implementation guidance with:

- Recommended test type (based on testing philosophy and subagent analysis)
- Specific file path and function/component name (from subagent output)
- Example test structure appropriate for the test type
- Rationale for why this test type is recommended
- Estimated effort based on complexity

**For Partial Coverage:** Additional test cases needed with:

- Scenarios to cover (identified by subagent)
- Appropriate test type for each scenario
- Integration points to validate
- Specific code locations needing coverage

**For Manual Tests:** Detailed manual test procedures with:

- Step-by-step instructions
- Expected outcomes
- Why automation is not recommended (complexity, cost, maintenance)

**For Wrong Test Type:** Refactoring guidance with:

- Current test type and specific issues (from subagent analysis)
- Recommended test type and specific benefits
- Example of how to refactor
- Before/after code examples

**Example Recommendation (Subagent-Powered):**

````markdown
### Gap: Missing Integration Test for User Login Flow

**Severity:** Critical
**Feature:** Authentication
**Acceptance Criteria:** AC-1.1, AC-1.2

**Current State:**

- File: `src/components/LoginForm.tsx`
- Component: `LoginForm`
- Current Test: Unit test (shallow render) in `src/components/LoginForm.test.tsx`
- Issue: Tests implementation details (className, props) instead of user behavior

**Recommended Action:**

- Test Type: Integration Test
- Rationale: Trophy model - test user interaction flow (input → validation → submit → API → redirect)
- Estimated Effort: 2-3 hours

**Implementation Guidance:**

```typescript
// src/components/LoginForm.integration.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';
import { AuthProvider } from '../contexts/AuthContext';

describe('LoginForm Integration', () => {
  it('should complete login flow successfully', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>
    );

    // User enters credentials
    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');

    // User submits form
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Verify API call and redirect
    await waitFor(() => {
      expect(window.location.pathname).toBe('/dashboard');
    });
  });
});
```
````

**Source:** Frontend Code Analyzer (subagent)

```

**Report:** Use standard template. Summary: gap counts by severity, manual test count, subagent usage. Critical Gaps: list with feature, criterion, impact, recommendation, file paths (from subagent analysis). Warning Gaps: list with improvement suggestions. Manual Testing Requirements: detailed procedures with steps. Detailed mode: all gaps, example tests, full procedures, subagent attribution. Summary mode: counts, critical gaps, high-priority manual tests.

**Subagent Usage Note:**

Include in report:
```

Analysis Method: Subagent-Powered (Parallel Code Analysis via invokeSubAgent)
Subagents Invoked: [Frontend Analysis, Backend Analysis, ...]
Analysis Duration: [X] seconds
File-Level Recommendations: [N] specific code locations identified

```

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

**Final Output Message:**
```

✅ Test Gap Analysis Complete!

Report saved to: [output_file_path]
Analysis Duration: [X] seconds
Mode: [Coverage|Readiness]

Summary:

- Overall Coverage: [X]%
- Critical Gaps: [N]
- Warnings: [M]
- Manual Tests Required: [P]

Next Steps:
[Mode-specific guidance]

```

**Requirements:** 9.1, 9.2, 9.3

---

## Usage Examples

### Example 1: Frontend Application (Trophy Model)

**Request:** "Analyze test coverage for our React application"
**Actions:** Mode: coverage → Detect: Frontend (React) → Recommend: Trophy → Run tests: 1,236 test cases → Current: 20% unit, 73% integration, 7% E2E → Partially Aligned
**Output:**
```

TESTING PHILOSOPHY ANALYSIS
Architecture Detected: Frontend (React Application)
Recommended Model: Testing Trophy

Expected Test Distribution:

- Unit Tests: 20-30% (complex business logic only)
- Integration Tests: 50-60% (component integration, user flows)
- E2E Tests: 15-20% (critical user journeys)

Current Test Distribution (from test runner):

- Total Test Cases: 1,236
- Unit Tests: 20% (250 test cases)
- Integration Tests: 73% (900 test cases)
- E2E Tests: 7% (86 test cases)

Status: ⚠️ PARTIALLY ALIGNED

Analysis:
✅ Good: Unit test percentage aligns with Trophy model (20% vs 20-30%)
⚠️ Warning: Integration tests slightly high (73% vs 50-60%)
❌ Problem: E2E tests below target (7% vs 15-20%)

CRITICAL ACTIONS:

1. Add E2E tests for critical user journeys (need 100-160 more E2E test cases)
   - Current: 86 E2E tests
   - Target: 185-247 E2E tests (15-20% of 1,236)
   - Estimated effort: 20-30 hours

2. Consider converting some integration tests to E2E tests
   - Focus on complete user workflows
   - Rationale: Trophy model emphasizes E2E for critical paths

MANUAL TESTING REQUIRED:

1. Payment gateway integration - manual verification of transaction flow
2. Browser compatibility - test on Chrome, Firefox, Safari, Edge

Target Distribution: 20-30% unit, 50-60% integration, 15-20% E2E

```

### Example 2: Backend API (Pyramid Model)

**Request:** "Check test coverage for our Express API"
**Actions:** Mode: coverage → Detect: Backend (Express API) → Recommend: Pyramid → Run tests: 850 test cases → Current: 75% unit, 20% integration, 5% E2E → Aligned
**Output:**
```

TESTING PHILOSOPHY ANALYSIS
Architecture Detected: Backend (Express API)
Recommended Model: Testing Pyramid

Expected Test Distribution:

- Unit Tests: 70-80% (business logic, utilities)
- Integration Tests: 15-20% (service layer, database)
- E2E Tests: 5-10% (critical API workflows)

Current Test Distribution (from test runner):

- Total Test Cases: 850
- Unit Tests: 75% (638 test cases)
- Integration Tests: 20% (170 test cases)
- E2E Tests: 5% (42 test cases)

Status: ✅ WELL ALIGNED

Analysis:
✅ Good: Unit test coverage aligns with Pyramid model (75% vs 70-80%)
✅ Good: Integration test coverage on target (20% vs 15-20%)
✅ Good: E2E coverage appropriate (5% vs 5-10%)

RECOMMENDATIONS:

1. Maintain current test distribution - it's well aligned
2. Focus on improving test quality rather than adding more tests
3. Consider adding a few more E2E tests for edge cases (optional)

Overall: Excellent test distribution for backend API.
Target Distribution: 70-80% unit, 15-20% integration, 5-10% E2E

```

### Example 3: Readiness Assessment

**Request:** "Are we ready to release?"
**Actions:** Mode: readiness → Run tests: 1,236 test cases → Coverage 85% → Quality score 72 → 1 failing test → Risk: At Risk
**Output:**
```

EXECUTIVE SUMMARY
Overall Test Coverage: 85%
Release Readiness: ⚠️ AT RISK

Test Results:

- Total Test Cases: 1,236
- Passed: 1,235 (99.9%)
- Failed: 1 (0.1%)

BLOCKING ISSUES:

1. Critical: 1 failing test in EditBudgetSettings.test.tsx - must fix before release
   - Test: "initializes form with lease budget data"
   - Error: Unable to find element with placeholder "e.g., 50"
   - Impact: Budget settings form may not work correctly

RELEASE CHECKLIST:

- [x] All critical acceptance criteria covered (12/12)
- [x] All test plans implemented (8/8)
- [ ] No failing tests (1 failing)
- [x] Security tests passing
- [x] Performance tests within SLA
- [x] Manual testing completed
- [x] Test quality score ≥60 (current: 72)
- [x] Critical gaps addressed

RECOMMENDATION: Fix 1 failing test before release. Estimated effort: 1-2 hours.

````

---

## Output Formats

### Coverage Report Format

```markdown
# Test Coverage Analysis Report

**Generated:** [CURRENT_DATE]
**Mode:** Coverage Analysis
**Features Analyzed:** [N]

## Executive Summary

**Overall Test Coverage:** [X]%

### Coverage by Test Type
| Test Type     | Total | Covered | Missing | Coverage |
|---------------|-------|---------|---------|----------|
| Unit          | [N]   | [M]     | [P]     | [X]%     |
| Integration   | [N]   | [M]     | [P]     | [Y]%     |
| E2E           | [N]   | [M]     | [P]     | [Z]%     |

### Coverage by Feature
| Feature              | Criteria | Covered | Coverage | Status |
|----------------------|----------|---------|----------|--------|
| [Feature Name]       | [N]      | [M]     | [X]%     | [Icon] |

## Coverage Details

### Feature: [Feature Name]

**Acceptance Criteria Coverage:** [X]% ([M]/[N])

#### Covered Criteria
- ✅ AC-1.1: [Criterion text]
  - Tests: `test/unit/auth.test.ts::should authenticate user`
  - Tests: `test/integration/login.test.ts::should complete login flow`

#### Missing Coverage
- ❌ AC-1.2: [Criterion text]
  - **Impact:** Users cannot reset passwords
  - **Recommendation:** Implement unit test for password reset service
  - **Example Test:**
    ```typescript
    describe('Password Reset', () => {
      it('should send reset email when valid email provided', async () => {
        // Test implementation
      });
    });
    ```

#### Manual Testing Required
- AC-1.3: [Criterion text]
  - **Reason:** Requires email client verification
  - **Manual Test Procedure:**
    1. Navigate to forgot password page
    2. Enter valid email address
    3. Verify email received in inbox
    4. Click reset link and verify redirect
    5. Enter new password and verify login

## Gap Analysis

### Critical Gaps (Must Fix)
1. **Feature:** Authentication
   - **Gap:** No E2E test for user login flow
   - **Impact:** Cannot verify end-to-end login experience
   - **Recommendation:** Implement E2E test using Playwright
   - **Estimated Effort:** 2-3 hours

### Warning Gaps (⚠️ Should Fix)
1. **Feature:** User Profile
   - **Gap:** Partial coverage for profile update
   - **Impact:** Edge cases may not be handled correctly
   - **Recommendation:** Add tests for validation errors and concurrent updates

## Recommendations

### Immediate Actions
1. Implement E2E test for user login flow (Critical)
2. Add unit tests for password reset service (Critical)
3. Create integration test for profile update (Warning)

### Quality Improvements
1. Improve test naming conventions (use Given-When-Then)
2. Add more edge case coverage for validation logic
3. Implement test data fixtures for consistency

## Next Steps

1. **Address Critical Gaps:** Focus on authentication and core workflows
2. **Implement Manual Tests:** Document procedures for manual testing scenarios
3. **Re-run Analysis:** After implementing tests to verify coverage improvement
4. **Target Coverage:** Aim for 90% coverage before release

---

**Report Location:** `test-analysis-reports/coverage-[timestamp].md`
**Analysis Duration:** [X] seconds
````

### Readiness Report Format

```markdown
# Release Readiness Assessment

**Generated:** [CURRENT_DATE]
**Mode:** Readiness Assessment
**Release Target:** [DATE]

## Executive Summary

**Release Readiness:** [✅ Ready | ⚠️ At Risk | ❌ Not Ready]
**Overall Test Coverage:** [X]%
**Risk Level:** [High | Medium | Low]

## Quality Gates

| Gate                          | Status | Details                    |
| ----------------------------- | ------ | -------------------------- |
| Critical features 100% tested | [Icon] | [X]% coverage              |
| No failing tests              | [Icon] | [N] tests failing          |
| Test quality score ≥60        | [Icon] | Current score: [X]         |
| Security tests passing        | [Icon] | [N] security tests passing |
| Performance within SLA        | [Icon] | [Details]                  |

## Blocking Issues

### Critical (Must Fix Before Release)

1. **No E2E test for user login flow**
   - **Impact:** Cannot verify critical user journey
   - **Effort:** 2-3 hours
   - **Owner:** [Assign]

2. **Security test failing for SQL injection**
   - **Impact:** Potential security vulnerability
   - **Effort:** 1-2 hours
   - **Owner:** [Assign]

## Risk Assessment

### High Risks

1. **Untested authentication flow**
   - **Probability:** High (70%)
   - **Impact:** Critical (system unusable)
   - **Risk Score:** 70
   - **Mitigation:** Implement E2E test immediately

### Medium Risks

1. **Partial integration test coverage**
   - **Probability:** Medium (50%)
   - **Impact:** High (feature broken)
   - **Risk Score:** 50
   - **Mitigation:** Add integration tests for critical paths

## Release Checklist

- [x] All critical acceptance criteria covered (12/12)
- [x] All test plans implemented (8/8)
- [ ] No failing tests (1 failing)
- [x] Security tests passing (except SQL injection)
- [x] Performance tests within SLA
- [ ] Manual testing completed (payment gateway pending)
- [x] Test quality score ≥60 (current: 72)
- [ ] Critical gaps addressed (2 remaining)

**Checklist Status:** 6/8 items complete (75%)

## Recommendations

### Before Release (Required)

1. Fix failing SQL injection security test
2. Implement E2E test for user login flow
3. Complete manual testing for payment gateway

### Post-Release (Recommended)

1. Improve integration test coverage to 90%
2. Add performance tests for reporting feature
3. Implement automated accessibility tests

## Timeline

**Estimated Effort to Ready:** 6-8 hours
**Recommended Release Date:** [DATE] (if all blocking issues resolved)

---

**Report Location:** `test-analysis-reports/readiness-[timestamp].md`
**Next Assessment:** [DATE]
```

---

## Version & Compatibility

**Version:** 1.0.0 | **Release:** 2025-01-15 | **Status:** Production Ready

**Compatibility:**

- Kiro ✅ Fully Supported (with subagent-powered analysis)

**Test Framework Support:**

- Jest ✅ Fully Supported
- Vitest ✅ Fully Supported
- Pytest ✅ Supported
- Cypress ✅ E2E Support

**Performance:**

- Coverage Analysis: <20s with subagents (parallel) (typical: 8-12s)
- Readiness Assessment: <40s with subagents (parallel) (typical: 20-25s)
- Subagent overhead: +5-10s for parallel code analysis (worth it for file-level specificity)

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

**Future Enhancements:**

- Multi-language test framework support expansion
- AI-powered test generation suggestions (using subagent analysis)
- Integration with CI/CD pipelines
- Real-time coverage monitoring dashboard
- Automated test prioritization based on risk
- Enhanced subagent prompts for deeper code analysis
- Contract testing support for microservices

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
