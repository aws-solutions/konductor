# Test coverage analysis: gap identification

Read this when you reach Stage 7 of `SKILL.md`, before Step 1 and again when classifying gaps.

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

Step 3 (consolidate subagent results) is in `SKILL.md`; the gap classification follows it.

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

**Subagent Usage Note:**

Include in report:
```

Analysis Method: Subagent-Powered (Parallel Code Analysis via invokeSubAgent)
Subagents Invoked: [Frontend Analysis, Backend Analysis, ...]
Analysis Duration: [X] seconds
File-Level Recommendations: [N] specific code locations identified

```
