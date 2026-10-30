# Cypress report templates

Read the section for the current mode when producing that mode's report.

# Progress

## Progress formulas

**Per-Phase Progress:**

```
Phase 1: (completed / total) * 100%
Phase 2: (completed / total) * 100%
Phase 3: (completed / total) * 100%
Phase 4: (completed / total) * 100%
```

**Calculate Remaining Effort:**

```
Remaining Effort = Sum of effort for incomplete tasks
Estimated Completion = Remaining Effort / Team Velocity

Team Velocity = Completed Effort / Days Elapsed (if history available)
```

## Progress report template

```markdown
# Cypress Implementation Progress Report

**Generated:** [CURRENT_DATE]
**Mode:** Progress Tracking

---

## Overall Progress

**Status:** [On Track / At Risk / Blocked]
**Overall Completion:** [X]% ([M] of [N] tasks)
**Estimated Remaining:** [Y] hours ([Z] days)

[████████░░] 80%

---

## Phase Progress

| Phase               | Status         | Complete | In Progress | Not Started | Total | Progress |
| ------------------- | -------------- | -------- | ----------- | ----------- | ----- | -------- |
| Phase 1: Foundation | ✅ Complete    | 10       | 0           | 0           | 10    | 100%     |
| Phase 2: P0 Tests   | 🔄 In Progress | 8        | 3           | 2           | 13    | 62%      |
| Phase 3: P1 Tests   | ⏳ Not Started | 0        | 0           | 15          | 15    | 0%       |
| Phase 4: P2 Tests   | ⏳ Not Started | 0        | 0           | 8           | 8     | 0%       |

---

## Task Type Progress

| Type                | Complete | In Progress | Not Started | Total | Progress |
| ------------------- | -------- | ----------- | ----------- | ----- | -------- |
| Setup               | 5        | 0           | 0           | 5     | 100%     |
| Page Objects        | 8        | 2           | 5           | 15    | 53%      |
| Custom Commands     | 4        | 1           | 2           | 7     | 57%      |
| Test Data           | 3        | 0           | 3           | 6     | 50%      |
| Test Implementation | 2        | 3           | 8           | 13    | 15%      |
| Verification        | 1        | 1           | 8           | 10    | 10%      |

---

## Blockers

### Critical Blockers (P0 Tests)

**CYPRESS-015: Implement E2E-001 test**

- Status: 🚫 Blocked
- Blocker: Waiting for CYPRESS-012 (LoginPage page object)
- Impact: Cannot validate critical login flow
- Recommendation: Prioritize CYPRESS-012 completion

### High Blockers (P1 Tests)

[List high priority blockers]

---

## Completed This Week

- ✅ CYPRESS-001: Cypress installation complete
- ✅ CYPRESS-002: LoginPage page object implemented
- ✅ CYPRESS-004: cy.login() custom command created
- ✅ CYPRESS-007: E2E-001 test implemented and passing

---

## In Progress

- 🔄 CYPRESS-003: TaskPage page object (80% complete)
- 🔄 CYPRESS-008: E2E-001 verification (running in CI)
- 🔄 CYPRESS-010: DashboardPage page object (50% complete)

---

## Next Steps

1. **Complete Phase 2 blockers** (CYPRESS-012, CYPRESS-015)
2. **Verify P0 tests in CI** (all P0 tests must pass)
3. **Begin Phase 3** (P1 test implementation)
4. **Address flaky tests** (E2E-003 has 20% failure rate)

---

## Velocity Metrics

**Days Elapsed:** 10 days
**Effort Completed:** 32 hours
**Team Velocity:** 3.2 hours/day
**Estimated Completion:** 8 days remaining (based on velocity)

---

## Recommendations

**Critical Actions:**

1. Unblock CYPRESS-015 by completing CYPRESS-012
2. Fix flaky test E2E-003 (intermittent timeout)
3. Add retry logic to E2E-005 (external API dependency)

**Warnings:**

1. Phase 2 behind schedule by 2 days
2. Test verification tasks taking longer than estimated
3. Need to allocate more time for CI/CD integration
```

## History JSON example

```json
{
  "timestamp": "2026-01-16T10:30:00Z",
  "mode": "progress",
  "overall_percentage": 62,
  "phases": [
    { "phase": 1, "percentage": 100, "status": "complete" },
    { "phase": 2, "percentage": 62, "status": "in_progress" },
    { "phase": 3, "percentage": 0, "status": "not_started" },
    { "phase": 4, "percentage": 0, "status": "not_started" }
  ],
  "blockers_count": 3,
  "estimated_remaining_days": 8,
  "velocity": 3.2
}
```

# Final

## Verification report template (Stage 8)

````markdown
# Cypress Implementation Verification Report

**Generated:** [CURRENT_DATE]
**Mode:** Final Verification

---

## Test Coverage

**E2E Tests Specified:** [N]
**E2E Tests Implemented:** [M]
**Coverage:** [M/N * 100]%

| Priority      | Specified | Implemented | Coverage |
| ------------- | --------- | ----------- | -------- |
| P0 (Critical) | 5         | 5           | 100%     |
| P1 (High)     | 8         | 7           | 88%      |
| P2 (Medium)   | 4         | 2           | 50%      |
| P3 (Low)      | 3         | 0           | 0%       |

---

## Test Execution Results

**Test Run:** [TIMESTAMP]
**Total Tests:** [N]
**Passed:** [M] ([X]%)
**Failed:** [P] ([Y]%)
**Skipped:** [Q]
**Duration:** [Z] seconds

**Pass Rate:** [M/N * 100]%

---

## Test Verification Matrix

| Test ID | Test Name           | Exists | Steps Match       | Assertions Match | Test Data    | Cleanup | Status     |
| ------- | ------------------- | ------ | ----------------- | ---------------- | ------------ | ------- | ---------- |
| E2E-001 | Login + Create Task | ✅     | ✅                | ✅               | ✅           | ✅      | ✅ Pass    |
| E2E-002 | Payment Checkout    | ✅     | ✅                | ⚠️ Missing 1     | ✅           | ✅      | ⚠️ Warning |
| E2E-003 | Search + Filter     | ✅     | ⚠️ Missing step 3 | ✅               | ⚠️ Hardcoded | ❌      | ❌ Fail    |

---

## Best Practices Compliance

| Practice          | Compliance | Issues                           |
| ----------------- | ---------- | -------------------------------- |
| Selector Strategy | 85%        | 3 tests use class selectors      |
| Custom Commands   | 90%        | Login flow duplicated in 2 tests |
| Page Objects      | 100%       | All tests use page objects       |
| Waiting Strategy  | 75%        | 5 tests use cy.wait(1000)        |
| Test Isolation    | 95%        | 1 test depends on previous test  |
| API Mocking       | 80%        | 4 tests call real external APIs  |

**Overall Compliance:** 87%

---

## Failed Tests

### E2E-003: Search and Filter Tasks

**Status:** ❌ Failed
**Failure Reason:** Timeout waiting for search results
**Error Message:**
```

Timed out retrying after 4000ms: Expected to find element: [data-cy=search-results], but never found it.

```

**Root Cause:** Search API call not mocked, external API slow/unavailable

**Recommendation:**
1. Add `cy.intercept()` to mock search API
2. Increase timeout for search results
3. Add retry logic

---

## Flaky Tests

### E2E-005: Multi-user Approval Workflow

**Status:** ⚠️ Flaky (2/3 runs passed)
**Failure Pattern:** Intermittent timeout on approval step
**Root Cause:** Race condition between user actions

**Recommendation:**
1. Add explicit wait for approval button to be enabled
2. Use `cy.intercept()` to wait for approval API call
3. Increase test timeout from 10s to 20s

---

## Missing Tests

**P1 Tests Not Implemented:**
- E2E-008: Bulk Task Import (estimated 4 hours)

**P2 Tests Not Implemented:**
- E2E-011: Task Export to CSV (estimated 2 hours)
- E2E-012: Task Filtering by Date Range (estimated 3 hours)

**Total Missing Effort:** 9 hours

---

## Code Quality Issues

### Critical Issues (Must Fix)

**1. Hardcoded Test Data in E2E-003**
- Location: `cypress/e2e/high-priority/search-filter.cy.js:15`
- Issue: Email and password hardcoded instead of using fixtures
- Fix: Replace with `cy.fixture('users').then((users) => ...)`

**2. No API Mocking in E2E-003**
- Location: `cypress/e2e/high-priority/search-filter.cy.js:25`
- Issue: Test calls real search API, causing timeouts
- Fix: Add `cy.intercept('GET', '/api/tasks/search', { fixture: 'search-results' })`

### Warnings (Should Fix)

**1. Arbitrary Wait in E2E-007**
- Location: `cypress/e2e/medium-priority/task-edit.cy.js:30`
- Issue: `cy.wait(2000)` instead of explicit wait
- Fix: Replace with `cy.get('[data-cy=save-button]').should('be.enabled')`

**2. Repeated Login Code**
- Location: `cypress/e2e/critical/login-create-task.cy.js:10`, `cypress/e2e/high-priority/task-delete.cy.js:10`
- Issue: Login sequence duplicated instead of using custom command
- Fix: Replace with `cy.login(email, password)`

---

## Recommendations

### Critical Actions (Must Complete Before Release)

1. **Fix E2E-003 test failure** (add API mocking, fix timeout)
2. **Implement missing P1 test E2E-008** (4 hours)
3. **Fix hardcoded test data in E2E-003** (use fixtures)
4. **Add API mocking to 4 tests** (prevent external dependencies)

### Warnings (Should Address)

1. **Fix flaky test E2E-005** (add explicit waits, increase timeout)
2. **Replace arbitrary waits with explicit waits** (5 tests affected)
3. **Extract repeated login code to custom command** (2 tests affected)
4. **Improve selector strategy** (3 tests use fragile selectors)

### Quality Improvements (Nice to Have)

1. **Implement P2 tests** (9 hours total)
2. **Add test documentation** (describe test purpose in comments)
3. **Add test tags** (for selective test execution)
4. **Improve test reporting** (add custom reporter)

---

## Next Steps

1. **Fix critical issues** (estimated 6 hours)
2. **Implement missing P1 test** (estimated 4 hours)
3. **Fix flaky test** (estimated 2 hours)
4. **Re-run full test suite** (verify 100% pass rate)
5. **Integrate with CI/CD** (automate test execution)
6. **Schedule P2 test implementation** (post-release)

---

## Test Execution Commands

**Run All Tests:**
```bash
npx cypress run
```

**Run P0 Tests Only:**

```bash
npx cypress run --spec "cypress/e2e/critical/**/*.cy.js"
```

**Run Specific Test:**

```bash
npx cypress run --spec "cypress/e2e/critical/login-create-task.cy.js"
```

**Run Tests in Headed Mode (Debug):**

```bash
npx cypress open
```

**Run Tests with Video Recording:**

```bash
npx cypress run --video
```

**Run Tests with Custom Reporter:**

```bash
npx cypress run --reporter mochawesome
```

````

## Traceability structure example (Stage 9)

```

E2E-001: User Login and Task Creation
├── Test Specification
│ ├── User Journey: UJ-001
│ ├── Test Objective: Validate user can authenticate and create a task
│ ├── Steps: 10 steps
│ └── Assertions: 5 assertions
├── Implementation Tasks
│ ├── CYPRESS-002: LoginPage page object ✅
│ ├── CYPRESS-003: TaskPage page object ✅
│ ├── CYPRESS-004: cy.login() custom command ✅
│ ├── CYPRESS-005: User fixtures ✅
│ ├── CYPRESS-006: Task fixtures ✅
│ ├── CYPRESS-007: E2E-001 test implementation ✅
│ └── CYPRESS-008: E2E-001 verification ✅
├── Code Files
│ ├── cypress/support/page-objects/LoginPage.js ✅
│ ├── cypress/support/page-objects/TaskPage.js ✅
│ ├── cypress/support/commands.js (cy.login) ✅
│ ├── cypress/fixtures/users.json ✅
│ ├── cypress/fixtures/tasks.json ✅
│ └── cypress/e2e/critical/login-create-task.cy.js ✅
└── Test Execution
├── Status: ✅ Passed
├── Duration: 12.5 seconds
└── Last Run: 2026-01-16T10:30:00Z

````

## Traceability report template (Stage 9)

```markdown
# Cypress Implementation Traceability Report

**Generated:** [CURRENT_DATE]
**Mode:** Final Traceability

---

## Traceability Summary

**Overall Traceability:** [X]%
**Complete:** [M] tests ([Y]%)
**Partial:** [P] tests ([Z]%)
**Missing:** [Q] tests ([A]%)

---

## Traceability Matrix

| Test ID | Specification | Tasks | Code | Execution | Completeness | Status |
|---------|---------------|-------|------|-----------|--------------|--------|
| E2E-001 | ✅ | 7/7 | 6/6 | ✅ Pass | 100% | ✅ Complete |
| E2E-002 | ✅ | 8/8 | 7/7 | ✅ Pass | 100% | ✅ Complete |
| E2E-003 | ✅ | 6/8 | 5/6 | ❌ Fail | 75% | ⚠️ Partial |
| E2E-004 | ✅ | 5/7 | 4/5 | ⏳ Not Run | 71% | ⚠️ Partial |
| E2E-008 | ✅ | 0/6 | 0/5 | ⏳ Not Run | 0% | ❌ Missing |

---

## Complete Traceability (100%)

### E2E-001: User Login and Task Creation

**Specification:** ✅ Complete
- User Journey: UJ-001
- Test Objective: Validate user can authenticate and create a task
- Steps: 10 steps
- Assertions: 5 assertions

**Implementation Tasks:** ✅ 7/7 Complete
- ✅ CYPRESS-002: LoginPage page object
- ✅ CYPRESS-003: TaskPage page object
- ✅ CYPRESS-004: cy.login() custom command
- ✅ CYPRESS-005: User fixtures
- ✅ CYPRESS-006: Task fixtures
- ✅ CYPRESS-007: E2E-001 test implementation
- ✅ CYPRESS-008: E2E-001 verification

**Code Files:** ✅ 6/6 Present
- ✅ cypress/support/page-objects/LoginPage.js
- ✅ cypress/support/page-objects/TaskPage.js
- ✅ cypress/support/commands.js (cy.login)
- ✅ cypress/fixtures/users.json
- ✅ cypress/fixtures/tasks.json
- ✅ cypress/e2e/critical/login-create-task.cy.js

**Test Execution:** ✅ Passed
- Status: Passed
- Duration: 12.5 seconds
- Last Run: 2026-01-16T10:30:00Z

---

## Partial Traceability (50-99%)

### E2E-003: Search and Filter Tasks

**Specification:** ✅ Complete
**Implementation Tasks:** ⚠️ 6/8 Complete (75%)
- ✅ CYPRESS-015: SearchPage page object
- ✅ CYPRESS-016: FilterComponent page object
- ✅ CYPRESS-017: Search fixtures
- ✅ CYPRESS-018: E2E-003 test implementation
- ❌ CYPRESS-019: API mocking for search (missing)
- ❌ CYPRESS-020: E2E-003 verification (blocked by test failure)

**Code Files:** ⚠️ 5/6 Present (83%)
- ✅ cypress/support/page-objects/SearchPage.js
- ✅ cypress/support/page-objects/FilterComponent.js
- ✅ cypress/fixtures/search-results.json
- ✅ cypress/e2e/high-priority/search-filter.cy.js
- ❌ API mock configuration (missing)

**Test Execution:** ❌ Failed
- Status: Failed (timeout)
- Error: External API call not mocked
- Last Run: 2026-01-16T10:25:00Z

**Gap Analysis:**
- **Planning Gap:** API mocking task not completed
- **Implementation Gap:** Test failing due to missing API mock
- **Recommendation:** Complete CYPRESS-019, add cy.intercept() for search API

---

## Missing Traceability (0%)

### E2E-008: Bulk Task Import

**Specification:** ✅ Complete
**Implementation Tasks:** ❌ 0/6 Complete (0%)
- ❌ CYPRESS-040: ImportPage page object (not started)
- ❌ CYPRESS-041: File upload helper (not started)
- ❌ CYPRESS-042: Import fixtures (not started)
- ❌ CYPRESS-043: E2E-008 test implementation (not started)
- ❌ CYPRESS-044: E2E-008 verification (not started)

**Code Files:** ❌ 0/5 Present (0%)
**Test Execution:** ⏳ Not Run

**Gap Analysis:**
- **Specification Gap:** Test specified but no implementation started
- **Recommendation:** Schedule implementation (estimated 4 hours)

---

## Traceability Gaps

### Critical Gaps (Block Release)

**1. E2E-003: Missing API Mocking**
- Gap Type: Implementation Gap
- Impact: Test failing, cannot validate search functionality
- Remediation: Complete CYPRESS-019 (add cy.intercept for search API)
- Estimated Effort: 1 hour

### High Gaps (Should Address)

**1. E2E-008: Missing Implementation**
- Gap Type: Specification Gap
- Impact: P1 test not implemented, reduced coverage
- Remediation: Implement all tasks for E2E-008
- Estimated Effort: 4 hours

---

## Recommendations

**Critical Actions:**
1. Complete API mocking for E2E-003 (1 hour)
2. Fix E2E-003 test failure (verify after API mocking)
3. Implement E2E-008 (4 hours)

**Quality Improvements:**
1. Add traceability comments in test files (link to test ID)
2. Update task tracking with code file references
3. Document traceability in README

---

## Next Steps

1. **Address critical gaps** (estimated 5 hours)
2. **Re-run traceability analysis** (verify 100% completeness)
3. **Update documentation** (add traceability matrix to README)
4. **Proceed to release** (after all critical gaps resolved)
````

# Consolidated report (all modes)

Used by Final Report Generation in every mode, including initial.

````markdown
# Cypress Test Implementation Plan

**Generated:** [CURRENT_DATE]
**Mode:** [Initial/Progress/Final]
**Application:** [Application Name]
**E2E Strategy:** [Path to strategy file]

---

## Executive Summary

**Mode-Specific Summary:**

**Initial Mode:**

- E2E Tests to Implement: [N]
- Total Implementation Tasks: [M]
- Estimated Effort: [X] hours ([Y] developer days)
- Implementation Timeline: [Z] weeks
- Recommended Start: [Phase 1 - Foundation]

**Progress Mode:**

- Overall Progress: [X]%
- Tasks Complete: [M] of [N]
- Blockers: [P] (Critical: [Q])
- Estimated Remaining: [Y] hours ([Z] days)
- Status: [On Track / At Risk / Blocked]

**Final Mode:**

- Tests Implemented: [M] of [N] ([X]%)
- Tests Passing: [P] of [M] ([Y]%)
- Code Quality: [Z]% compliance
- Traceability: [A]% complete
- Status: [Ready for Release / Needs Work]

---

## [Mode-Specific Sections]

**Initial Mode Sections:**

1. E2E Strategy Summary
2. Cypress Project Structure
3. Task Breakdown by Test
4. Implementation Roadmap
5. Best Practices & Patterns
6. Getting Started Guide

**Progress Mode Sections:**

1. Overall Progress
2. Phase Progress
3. Task Type Progress
4. Blockers
5. Completed This Week
6. In Progress
7. Next Steps
8. Velocity Metrics

**Final Mode Sections:**

1. Test Coverage
2. Test Execution Results
3. Test Verification Matrix
4. Best Practices Compliance
5. Failed Tests
6. Flaky Tests
7. Missing Tests
8. Code Quality Issues
9. Traceability Matrix
10. Recommendations

---

## Consolidated Recommendations

**Critical Actions (Must Complete):**

1. [Action 1 with estimated effort]
2. [Action 2 with estimated effort]

**Warnings (Should Address):**

1. [Warning 1 with estimated effort]
2. [Warning 2 with estimated effort]

**Quality Improvements (Nice to Have):**

1. [Improvement 1 with estimated effort]
2. [Improvement 2 with estimated effort]

---

## Next Steps

**Initial Mode:**

1. Review and approve implementation plan
2. Set up Cypress (if not installed)
3. Begin Phase 1: Foundation (Week 1)
4. Implement shared components (page objects, custom commands)
5. Begin Phase 2: P0 Tests (Week 2)

**Progress Mode:**

1. Unblock critical tasks
2. Complete current phase
3. Address flaky tests
4. Continue to next phase
5. Re-run progress tracking in 1 week

**Final Mode:**

1. Fix critical issues
2. Implement missing P1 tests
3. Fix flaky tests
4. Re-run full test suite
5. Integrate with CI/CD
6. Proceed to release (if all critical tests passing)

---

## Appendix: Detailed Task List

[Include complete task breakdown with checkboxes for tracking]

### Phase 1: Foundation

#### Setup Tasks

- [ ] CYPRESS-001: Install Cypress and dependencies
  - Effort: 0.5 hours
  - Acceptance Criteria: [...]

[Continue with all tasks...]

---

## Appendix: Cypress Configuration

**cypress.config.js:**

```javascript
const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    viewportWidth: 1280,
    viewportHeight: 720,
    video: true,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 10000,
    requestTimeout: 10000,
    responseTimeout: 10000,
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
```
````

**package.json scripts:**

```json
{
  "scripts": {
    "test:e2e": "cypress run",
    "test:e2e:open": "cypress open",
    "test:e2e:critical": "cypress run --spec 'cypress/e2e/critical/**/*.cy.js'",
    "test:e2e:ci": "cypress run --browser chrome --headless"
  }
}
```
