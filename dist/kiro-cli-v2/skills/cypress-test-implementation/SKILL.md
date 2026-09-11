---
name: cypress-test-implementation
description: Transforms E2E test strategy into Cypress implementation tasks. Use after E2E strategy is defined to plan and track Cypress test development. Operates in three modes — initial (planning), progress (tracking), and final (verification).
version: 1.0.0
tags: [skill, cypress, e2e-testing, implementation, quality-assurance]
---

# Cypress Test Implementation

## Overview

Breaks down an E2E test strategy into Cypress implementation tasks with a phased roadmap (Foundation → P0 → P1 → P2). Tracks progress, identifies blockers, and verifies implemented tests against specifications.

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

```
cypress/
├── e2e/
│   ├── critical/          # P0 tests
│   ├── high-priority/     # P1 tests
│   ├── medium-priority/   # P2 tests
│   └── low-priority/      # P3 tests
├── fixtures/
│   ├── users.json         # Test user data
│   ├── tasks.json         # Test task data
│   └── api-responses/     # Mock API responses
├── support/
│   ├── commands.js        # Custom commands
│   ├── page-objects/      # Page object classes
│   │   ├── LoginPage.js
│   │   ├── DashboardPage.js
│   │   └── TaskPage.js
│   └── helpers/           # Utility functions
│       ├── auth.js
│       ├── api.js
│       └── data.js
└── cypress.config.js
```

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

Generate implementation tasks following this pattern:

**Task Categories:**

1. **Setup Tasks** (if needed)
   - Install Cypress
   - Configure Cypress
   - Set up test environment variables
   - Create directory structure

2. **Page Object Tasks** (one per page/component)
   - Create page object class
   - Define selectors
   - Define interaction methods
   - Add assertions

3. **Custom Command Tasks** (one per reusable action)
   - Define custom command
   - Implement command logic
   - Add to commands.js
   - Document usage

4. **Test Data Tasks** (one per data type)
   - Create fixture file
   - Define test data structure
   - Add data variations
   - Document data usage

5. **Test Implementation Tasks** (one per test)
   - Create test file
   - Implement test steps
   - Add assertions
   - Add cleanup

6. **Verification Tasks**
   - Run test locally
   - Fix flaky assertions
   - Add retry logic
   - Verify in CI

**Task Structure:**

```markdown
- [ ] Task ID: [CYPRESS-001]
- Description: [What needs to be done]
- Type: [Setup/PageObject/CustomCommand/TestData/TestImplementation/Verification]
- Related Test: [E2E-001]
- Dependencies: [CYPRESS-000] (if any)
- Estimated Effort: [X hours]
- Acceptance Criteria:
  - [ ] Criterion 1
  - [ ] Criterion 2
- Implementation Notes: [Specific guidance, reference to best practices appendix]
```

**Example Task Breakdown for E2E-001 (Login + Create Task):**

```markdown
### E2E-001: User Login and Task Creation

#### Setup Tasks

- [ ] CYPRESS-001: Install Cypress and dependencies
  - Type: Setup
  - Effort: 0.5 hours
  - Acceptance Criteria:
    - [ ] Cypress installed via npm
    - [ ] cypress.config.js created
    - [ ] package.json scripts added (test:e2e, cypress:open)
  - Implementation Notes: See Appendix: Cypress Configuration for recommended setup

#### Page Object Tasks

- [ ] CYPRESS-002: Create LoginPage page object
  - Type: PageObject
  - Related Test: E2E-001
  - Dependencies: CYPRESS-001
  - Effort: 1 hour
  - Acceptance Criteria:
    - [ ] LoginPage class created in cypress/support/page-objects/
    - [ ] Selectors defined (emailInput, passwordInput, submitButton)
    - [ ] Methods defined (visit, fillEmail, fillPassword, submit, assertLoggedIn)
  - Implementation Notes: Follow page object pattern from Appendix. Use data-cy selectors.

- [ ] CYPRESS-003: Create TaskPage page object
  - Type: PageObject
  - Related Test: E2E-001
  - Dependencies: CYPRESS-001
  - Effort: 1.5 hours
  - Acceptance Criteria:
    - [ ] TaskPage class created
    - [ ] Selectors defined (createButton, titleInput, descriptionInput, submitButton)
    - [ ] Methods defined (clickCreate, fillTitle, fillDescription, submit, assertTaskCreated)
  - Implementation Notes: Follow page object pattern from Appendix. Use data-cy selectors.

#### Custom Command Tasks

- [ ] CYPRESS-004: Create cy.login() custom command
  - Type: CustomCommand
  - Related Test: E2E-001 (and others)
  - Dependencies: CYPRESS-002
  - Effort: 0.5 hours
  - Acceptance Criteria:
    - [ ] Command defined in cypress/support/commands.js
    - [ ] Accepts email and password parameters
    - [ ] Uses cy.session() for authentication state caching
    - [ ] Can be reused across tests
  - Implementation Notes: See Appendix: Custom Commands for cy.login() example

#### Test Data Tasks

- [ ] CYPRESS-005: Create user fixtures
  - Type: TestData
  - Related Test: E2E-001
  - Dependencies: CYPRESS-001
  - Effort: 0.5 hours
  - Acceptance Criteria:
    - [ ] users.json created in cypress/fixtures/
    - [ ] Test user data defined (email, password, role)
    - [ ] Multiple user variations included
  - Implementation Notes: Include admin, member, and viewer roles. Passwords must meet Cognito requirements.

- [ ] CYPRESS-006: Create task fixtures
  - Type: TestData
  - Related Test: E2E-001
  - Dependencies: CYPRESS-001
  - Effort: 0.5 hours
  - Acceptance Criteria:
    - [ ] tasks.json created in cypress/fixtures/
    - [ ] Test task data defined (title, description, dueDate)
  - Implementation Notes: Include variations for different statuses and due dates

#### Test Implementation Tasks

- [ ] CYPRESS-007: Implement E2E-001 test
  - Type: TestImplementation
  - Related Test: E2E-001
  - Dependencies: CYPRESS-002, CYPRESS-003, CYPRESS-004, CYPRESS-005, CYPRESS-006
  - Effort: 2 hours
  - Acceptance Criteria:
    - [ ] Test file created: cypress/e2e/critical/login-and-create-task.cy.js
    - [ ] Test implements all 13 steps from E2E strategy
    - [ ] All 5 assertions from E2E strategy included
    - [ ] Test data loaded from fixtures
    - [ ] Cleanup implemented (delete created task)
  - Implementation Notes: See Appendix: Example Test Structure for reference pattern

#### Verification Tasks

- [ ] CYPRESS-008: Verify E2E-001 test execution
  - Type: Verification
  - Related Test: E2E-001
  - Dependencies: CYPRESS-007
  - Effort: 1 hour
  - Acceptance Criteria:
    - [ ] Test runs successfully locally (3/3 passes)
    - [ ] Test execution time < 15 seconds
    - [ ] No flaky assertions
    - [ ] Screenshots captured on failure
    - [ ] Video recorded
  - Implementation Notes: Run test 3 times to verify stability
```

**Generate Task Breakdown for All Tests:**

Repeat this pattern for each test in the E2E strategy (E2E-001, E2E-002, etc.).

**IMPORTANT: Task Description Guidelines**

- Focus on WHAT needs to be done, not HOW
- Use "Implementation Notes" to reference appendix sections
- Example: "See Appendix: Custom Commands for cy.login() pattern"
- Example: "Follow page object pattern from Appendix: Example Test Structure"
- NO code blocks in task descriptions
- NO JSON examples in task descriptions
- Keep tasks concise and actionable

**Identify Shared Tasks:**

Tasks that benefit multiple tests should be implemented first:

- Common page objects (LoginPage used by all tests)
- Common custom commands (cy.login, cy.logout)
- Common fixtures (users.json)

**Calculate Total Effort:**

Sum all task efforts:

- Setup: [X] hours
- Page Objects: [Y] hours
- Custom Commands: [Z] hours
- Test Data: [A] hours
- Test Implementation: [B] hours
- Verification: [C] hours
- **Total: [X+Y+Z+A+B+C] hours**

**Output:** `📝 Task Breakdown Complete: [N] tests → [M] tasks | Total Effort: [X] hours ([Y] days)`

**Store:** task_breakdown, shared_tasks, total_effort

---

## Stage 5: Implementation Roadmap Generation (Initial & Final)

**Objective:** Create phased implementation plan with dependencies and milestones.

**Mode:** Initial and Final only (skip in Progress).

**Phase 1: Foundation (Week 1)**

**Focus:** Setup and shared components

**Tasks:**

- Setup tasks (Cypress installation, configuration)
- Common page objects (LoginPage, DashboardPage)
- Common custom commands (cy.login, cy.logout, cy.createTestData)
- Common fixtures (users.json, base test data)

**Rationale:** These components are dependencies for all tests. Implementing them first unblocks parallel test development.

**Deliverables:**

- Cypress installed and configured
- 3-5 page objects for shared pages
- 3-5 custom commands for repeated actions
- 2-3 fixture files for test data
- Documentation for page objects and commands

**Estimated Effort:** [X] hours

**Phase 2: Critical Tests (Week 2)**

**Focus:** P0 tests from E2E strategy

**Tasks:**

- Page objects specific to P0 tests
- Custom commands specific to P0 tests
- Test data specific to P0 tests
- P0 test implementation
- P0 test verification

**Rationale:** P0 tests validate critical user journeys. These must pass before release.

**Deliverables:**

- [N] P0 tests implemented and passing
- Test execution report showing 100% pass rate
- Screenshots and videos for each test

**Estimated Effort:** [Y] hours

**Phase 3: High Priority Tests (Week 3)**

**Focus:** P1 tests from E2E strategy

**Tasks:**

- Page objects specific to P1 tests
- Custom commands specific to P1 tests
- Test data specific to P1 tests
- P1 test implementation
- P1 test verification

**Rationale:** P1 tests validate high-value features. These should pass before release.

**Deliverables:**

- [M] P1 tests implemented and passing
- Test execution report showing >95% pass rate
- CI/CD integration complete

**Estimated Effort:** [Z] hours

**Phase 4: Medium Priority Tests (Week 4)**

**Focus:** P2 tests from E2E strategy (if time permits)

**Tasks:**

- Page objects specific to P2 tests
- Test data specific to P2 tests
- P2 test implementation
- P2 test verification

**Rationale:** P2 tests increase coverage for less critical paths. Implement if time permits.

**Deliverables:**

- [P] P2 tests implemented and passing
- Full test suite execution report
- Test maintenance documentation

**Estimated Effort:** [A] hours

**Dependency Graph:**

```
Phase 1 (Foundation)
    ↓
Phase 2 (P0 Tests) ← Must complete before release
    ↓
Phase 3 (P1 Tests) ← Should complete before release
    ↓
Phase 4 (P2 Tests) ← Complete if time permits
```

**Milestones:**

- **Milestone 1 (End of Week 1):** Foundation complete, ready for test development
- **Milestone 2 (End of Week 2):** P0 tests passing, critical paths validated
- **Milestone 3 (End of Week 3):** P1 tests passing, CI/CD integrated
- **Milestone 4 (End of Week 4):** P2 tests passing, full coverage achieved

**Output:** `🗓️ Roadmap Generated: 4 phases | [N] milestones | Total: [X] hours ([Y] weeks)`

**Store:** implementation_roadmap, phases, milestones

---

## Stage 6: Best Practices & Patterns (Initial & Final)

**Objective:** Provide Cypress-specific guidance and patterns.

**Mode:** Initial and Final only (skip in Progress).

**Cypress Best Practices:**

**1. Selector Strategy**

Use `data-cy` attributes for test selectors:

```javascript
// ❌ Bad: Fragile selectors
cy.get('.btn-primary').click();
cy.get('#email').type('test@example.com');

// ✅ Good: Stable test selectors
cy.get('[data-cy=login-button]').click();
cy.get('[data-cy=email-input]').type('test@example.com');
```

**Recommendation:** Add `data-cy` attributes to application code during implementation.

**2. Custom Commands for Repeated Actions**

Extract repeated sequences into custom commands:

```javascript
// ❌ Bad: Repeated login code in every test
cy.visit('/login');
cy.get('[data-cy=email-input]').type('test@example.com');
cy.get('[data-cy=password-input]').type('password');
cy.get('[data-cy=login-button]').click();

// ✅ Good: Reusable custom command
cy.login('test@example.com', 'password');
```

**3. Page Object Pattern**

Encapsulate page interactions in page object classes:

```javascript
// ❌ Bad: Direct DOM manipulation in tests
cy.get('[data-cy=title-input]').type('New Task');
cy.get('[data-cy=description-input]').type('Task description');
cy.get('[data-cy=submit-button]').click();

// ✅ Good: Page object abstraction
TaskPage.fillTitle('New Task');
TaskPage.fillDescription('Task description');
TaskPage.submit();
```

**4. Test Data Management**

Use fixtures for test data:

```javascript
// ❌ Bad: Hardcoded test data
cy.login('test@example.com', 'password123');

// ✅ Good: Fixture-based test data
cy.fixture('users').then((users) => {
  cy.login(users.validUser.email, users.validUser.password);
});
```

**5. Assertions**

Use specific assertions with clear failure messages:

```javascript
// ❌ Bad: Vague assertion
cy.get('[data-cy=success-message]').should('exist');

// ✅ Good: Specific assertion with message
cy.get('[data-cy=success-message]').should('be.visible').and('contain.text', 'Task created successfully');
```

**6. Waiting Strategies**

Use explicit waits instead of arbitrary delays:

```javascript
// ❌ Bad: Arbitrary wait
cy.wait(3000);

// ✅ Good: Wait for specific condition
cy.get('[data-cy=loading-spinner]').should('not.exist');
cy.get('[data-cy=task-list]').should('be.visible');
```

**7. Test Isolation**

Each test should be independent:

```javascript
// ✅ Good: Independent test with setup and cleanup
describe('Task Management', () => {
  beforeEach(() => {
    cy.login('test@example.com', 'password');
    cy.createTestTask(); // Setup
  });

  it('should delete a task', () => {
    TaskPage.deleteTask('Test Task');
    TaskPage.assertTaskDeleted('Test Task');
  });

  afterEach(() => {
    cy.cleanupTestData(); // Cleanup
  });
});
```

**8. API Mocking**

Mock external API calls for faster, more reliable tests:

```javascript
// ✅ Good: Mock API response
cy.intercept('POST', '/api/tasks', {
  statusCode: 201,
  body: { id: '123', title: 'New Task' },
}).as('createTask');

TaskPage.submit();
cy.wait('@createTask');
```

**Cypress Anti-Patterns to Avoid:**

**1. Don't use cy.wait() with arbitrary time**

```javascript
// ❌ Bad
cy.wait(5000);

// ✅ Good
cy.get('[data-cy=element]').should('be.visible');
```

**2. Don't assert on one element, then act on a different element assuming the same state**

```javascript
// ❌ Bad
cy.get('[data-cy=list]').should('have.length', 1);
cy.get('[data-cy=other-list]').click(); // assumes other-list is also ready, but only [data-cy=list] was asserted

// ✅ Good
cy.get('[data-cy=other-list]').should('be.visible').click(); // assert on the same element you're about to act on
```

**3. Don't use conditional testing**

```javascript
// ❌ Bad
cy.get('body').then(($body) => {
  if ($body.find('[data-cy=modal]').length > 0) {
    cy.get('[data-cy=close-button]').click();
  }
});

// ✅ Good: Make test deterministic
cy.get('[data-cy=open-modal-button]').click();
cy.get('[data-cy=modal]').should('be.visible');
cy.get('[data-cy=close-button]').click();
```

**4. Don't assign return values**

```javascript
// ❌ Bad
const button = cy.get('[data-cy=button]');
button.click();

// ✅ Good
cy.get('[data-cy=button]').click();
```

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

**Per-Phase Progress:**

```
Phase 1: (completed / total) * 100%
Phase 2: (completed / total) * 100%
Phase 3: (completed / total) * 100%
Phase 4: (completed / total) * 100%
```

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

```
Remaining Effort = Sum of effort for incomplete tasks
Estimated Completion = Remaining Effort / Team Velocity

Team Velocity = Completed Effort / Days Elapsed (if history available)
```

**Generate Progress Report:**

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

**Save History:**

If enabled, save to `.kiro/specs/validation-history/cypress-progress-[timestamp].json`:

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

**1. Selector Strategy:**

- ✅ Uses `data-cy` attributes
- ⚠️ Uses class or ID selectors
- ❌ Uses fragile selectors (nth-child, complex CSS)

**2. Custom Commands:**

- ✅ Repeated actions extracted to custom commands
- ⚠️ Some repeated code
- ❌ Significant code duplication

**3. Page Objects:**

- ✅ Uses page object pattern
- ⚠️ Mixed approach (some page objects, some direct DOM)
- ❌ No page objects

**4. Waiting Strategy:**

- ✅ Uses explicit waits (`.should('be.visible')`)
- ⚠️ Some arbitrary waits (`cy.wait(1000)`)
- ❌ Frequent arbitrary waits

**5. Test Isolation:**

- ✅ Tests are independent
- ⚠️ Some test dependencies
- ❌ Tests depend on execution order

**6. API Mocking:**

- ✅ External APIs mocked with `cy.intercept()`
- ⚠️ Some external APIs not mocked
- ❌ No API mocking (tests depend on external services)

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

```markdown
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

````

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
````

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

```

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

**Output:** `🔗 Traceability Complete: [X]% overall | [M] complete | [P] partial | [Q] missing`

**Store:** traceability_matrix, traceability_gaps

---

## Final Report Generation

After completing mode-specific stages, generate consolidated report.

**Report Structure:**

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

---

## Appendix: Example Test Structure

**Example: Login and Create Task Test**

```javascript
// cypress/e2e/critical/login-create-task.cy.js

import LoginPage from '../../support/page-objects/LoginPage';
import TaskPage from '../../support/page-objects/TaskPage';

describe('E2E-001: User Login and Task Creation', () => {
  let users, tasks;

  before(() => {
    // Load fixtures once before all tests
    cy.fixture('users').then((data) => {
      users = data;
    });
    cy.fixture('tasks').then((data) => {
      tasks = data;
    });
  });

  beforeEach(() => {
    // Reset state before each test
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  it('should allow user to login and create a task', () => {
    // Step 1-5: Login
    cy.login(users.validUser.email, users.validUser.password);

    // Verify login successful
    cy.url().should('include', '/dashboard');
    cy.get('[data-cy=user-menu]').should('contain', users.validUser.email);

    // Step 6-10: Create Task
    TaskPage.clickCreate();
    TaskPage.fillTitle(tasks.newTask.title);
    TaskPage.fillDescription(tasks.newTask.description);
    TaskPage.selectDueDate(tasks.newTask.dueDate);
    TaskPage.submit();

    // Verify task created
    TaskPage.assertTaskCreated(tasks.newTask.title);
    cy.get('[data-cy=success-message]').should('be.visible').and('contain.text', 'Task created successfully');
  });

  afterEach(() => {
    // Cleanup: Delete created task
    if (tasks && tasks.newTask) {
      cy.deleteTask(tasks.newTask.title);
    }
  });
});
```

**Example: Page Object**

```javascript
// cypress/support/page-objects/TaskPage.js

class TaskPage {
  // Selectors
  get createButton() {
    return cy.get('[data-cy=create-task-button]');
  }
  get titleInput() {
    return cy.get('[data-cy=task-title-input]');
  }
  get descriptionInput() {
    return cy.get('[data-cy=task-description-input]');
  }
  get dueDatePicker() {
    return cy.get('[data-cy=task-due-date-picker]');
  }
  get submitButton() {
    return cy.get('[data-cy=task-submit-button]');
  }
  get successMessage() {
    return cy.get('[data-cy=success-message]');
  }
  get taskList() {
    return cy.get('[data-cy=task-list]');
  }

  // Actions
  clickCreate() {
    this.createButton.click();
  }

  fillTitle(title) {
    this.titleInput.clear().type(title);
  }

  fillDescription(description) {
    this.descriptionInput.clear().type(description);
  }

  selectDueDate(date) {
    this.dueDatePicker.click();
    cy.get(`[data-date="${date}"]`).click();
  }

  submit() {
    this.submitButton.click();
  }

  // Assertions
  assertTaskCreated(title) {
    this.taskList.should('contain', title);
  }

  assertTaskNotExists(title) {
    this.taskList.should('not.contain', title);
  }
}

export default new TaskPage();
```

**Example: Custom Command**

```javascript
// cypress/support/commands.js

Cypress.Commands.add('login', (email, password) => {
  cy.session([email, password], () => {
    cy.visit('/login');
    cy.get('[data-cy=email-input]').type(email);
    cy.get('[data-cy=password-input]').type(password);
    cy.get('[data-cy=login-button]').click();
    cy.url().should('include', '/dashboard');
  });
  cy.visit('/dashboard');
});

Cypress.Commands.add('deleteTask', (title) => {
  cy.get('[data-cy=task-list]').contains(title).parents('[data-cy=task-item]').find('[data-cy=delete-button]').click();
  cy.get('[data-cy=confirm-delete-button]').click();
});

Cypress.Commands.add('createTestTask', (task) => {
  cy.request({
    method: 'POST',
    url: '/api/tasks',
    body: task,
    headers: {
      Authorization: `Bearer ${Cypress.env('authToken')}`,
    },
  });
});
```

---

**Report Location:** [output_file_path]
**Analysis Duration:** [X] seconds

```

**Save Report:**

Write report to user-specified output file path (default: `testing-quality-assurance/outputs/cypress-implementation-plan.md`).

**Final Output Message:**

```

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
```
