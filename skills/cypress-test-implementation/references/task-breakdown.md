# Cypress task breakdown and roadmap

Read this when generating the task list and roadmap (initial and final modes only).

## Stage 4: task breakdown

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

## Stage 5: implementation roadmap

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
