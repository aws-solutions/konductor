# Cypress patterns

Read this when writing or reviewing test code, scoring best-practice compliance, or laying out a new `cypress/` directory.

# Best practices and patterns

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

# Compliance rubric

Used by Stage 8 to score each implemented test.

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

# Example project layout

Used by Stage 3 when the project has no `cypress/` directory yet.

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

# Example test structure

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
