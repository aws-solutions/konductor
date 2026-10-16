---
name: e2e-test-strategy
description: Generates a prioritized E2E test strategy from test gap analysis and user stories. Use after coverage analysis to plan E2E tests. Produces a test matrix organized by priority (P0-P3) with execution approach and framework recommendations.
version: 1.0.0
tags: [skill, e2e-testing, test-strategy, quality-assurance, planning]
---

# E2E Test Strategy

## Overview

Generates a prioritized E2E test strategy based on test gap analysis, user stories, and system architecture. Produces a test matrix with P0 (critical path), P1 (core features), P2 (edge cases), and P3 (nice-to-have) classifications.

## Usage

Use this skill when:

- Planning E2E tests after coverage gap analysis
- Deciding which user journeys to automate first
- Selecting a test framework based on technology stack

## Core Concepts

### Priority Classification

P0 (critical path — must not fail), P1 (core features — high business value), P2 (edge cases — important but not blocking), P3 (nice-to-have — low risk if deferred).

### Execution Strategy

Recommends sequential, parallel, or hybrid execution based on test dependencies and CI/CD pipeline constraints.

## Execution

When this skill is activated, use the following as your full instruction set for generating the E2E test strategy. Apply the Quality Gate at the end before presenting output to the user.

---

# E2E Test Strategy Planner (Maker)

## Purpose

Analyze test gap analysis output, Phase 1 user stories, Phase 2 architecture design, and Phase 3 implementation plans to generate strategic end-to-end testing recommendations. Create prioritized E2E test matrices based on change type (enhancement/bug/security), release type (major/minor/patch), and business impact. Focus on information aggregation, planning, and option evaluation rather than test implementation, helping teams make informed decisions about E2E test coverage and execution approaches.

## Target Personas

- **QA Engineers**: E2E test planning and prioritization
- **Test Architects**: Strategic testing decisions and resource allocation
- **Team Leads**: Release planning and risk assessment
- **Product Managers**: Understanding test coverage for business-critical flows

## Prerequisites

If a calling SOP supplied paths for any artifact below, or for the output file, You MUST use those values and skip the corresponding prompt. Ask only for what the caller did not supply — a caller that keeps its artifacts under its own output directory already knows where they are.

Required artifacts:

1. **Test Gap Analysis**: Output from Test Gap Analyzer (Checker) prompt
   - Location: `testing-quality-assurance/outputs/test-gap-analysis.md`
   - Contains: Coverage analysis, identified gaps, testing philosophy, distribution analysis

2. **Phase 1 - Requirements & Planning**: User stories with acceptance criteria
   - Location: `requirements-planning/outputs/user-stories.md`
   - Contains: Business requirements, user journeys, acceptance criteria

3. **Phase 2 - Design & Architecture**: System design and architecture
   - Location: `design-architecture/outputs/system-design.md`
   - Contains: Architecture overview, integration points, data flows

4. **Phase 3 - Implementation & Development**: Feature plans and implementation guides
   - Location: `implementation-development/outputs/feature-plan.md`
   - Contains: Implementation approach, technical decisions, code structure

5. **Change Context**: Change type and release type
   - Change Type: enhancement | bug | security
   - Release Type: major | minor | patch

## Execution Flow

Follow stages sequentially:

1. **Context Gathering**: Load and parse all required artifacts
2. **Gap Analysis Review**: Extract E2E-relevant gaps from test gap analysis
3. **User Journey Mapping**: Identify critical user journeys from requirements
4. **Integration Point Analysis**: Extract integration points from architecture
5. **Change Impact Assessment**: Evaluate change type and release type impact
6. **E2E Test Candidate Identification**: Determine which flows need E2E tests
7. **Prioritization Matrix Generation**: Apply scoring model for priority ranking
8. **Strategy Recommendations**: Generate execution approach and test data strategy
9. **Report Generation**: Create comprehensive E2E test strategy document

---

## Stage 1: Context Gathering

**Objective:** Load and validate all required artifacts.

**CRITICAL: Ask User for All File Locations Upfront**

Before starting analysis, gather all required information from the user in a single interaction:

**Ask the user for anything the caller did not already supply. If a calling SOP passed the output path, the gap analysis, the user stories, the system design, the feature plan, the change type, or the release type, use those values and skip the corresponding question. Ask nothing when all of them were supplied — a delegated run may have no human present to answer. Where a caller supplies none of the optional context, treat Feature Plan as absent, Change Type as `enhancement`, and Release Type as `minor` rather than blocking — both are in-enum, so Stage 1 validation passes and Stage 5 has a defined weight to score against.**

```
To generate your E2E test strategy, I need the following information:

1. **Output File Location** (Required)
   Where should I save the E2E test strategy report?
   Example: testing-quality-assurance/outputs/e2e-test-strategy.md

2. **Test Gap Analysis** (Required)
   Path to your test gap analysis report:
   Example: testing-quality-assurance/outputs/test-gap-analysis.md

3. **User Stories** (Required)
   Path to your user stories document:
   Example: requirements-planning/outputs/user-stories.md

4. **System Design** (Required)
   Path to your system design document:
   Example: design-architecture/outputs/system-design.md

5. **Feature Plan** (Required)
   Path to your feature plan document:
   Example: implementation-development/outputs/feature-plan.md

6. **Change Type** (Required)
   What type of change is this? (enhancement/bug/security)

7. **Release Type** (Required)
   What type of release is this? (major/minor/patch)

8. **Code Location** (Optional)
   Where is your application code located?
   Example: src/, lambda/, services/
   Note: This helps understand code structure but is not required for strategy planning

Please provide these paths and I'll generate your E2E test strategy.
```

**Validate User Input:**

After receiving user input:

1. **Validate Required Paths:**
   - Check that all required file paths exist and are readable
   - Report any missing or inaccessible files
   - Ask user to correct invalid paths

2. **Validate Change Context:**
   - Ensure change type is one of: enhancement, bug, security
   - Ensure release type is one of: major, minor, patch
   - Ask user to clarify if invalid values provided

3. **Validate Output Path:**
   - Check that output directory exists or can be created
   - Ensure output file path is writable
   - Suggest alternative if path is invalid

**Handle Missing Files:**

If any required file is missing or inaccessible:

```
❌ Cannot find required file: [file_path]

Please verify the path and provide the correct location.

Common locations to check:
- [List 3-4 common locations based on file type]

Or provide the full path to the file.
```

**Fallback Strategy:**

If user is unsure of file locations, offer to search:

```
I can search for these files in your workspace. Would you like me to:
1. Search for files matching common patterns
2. List directories so you can identify the correct paths
3. Proceed with the paths you've provided

Which would you prefer?
```

**Output After Validation:**

```
✅ Configuration Complete

Required Artifacts:
- Test Gap Analysis: [path] ✅
- User Stories: [path] ✅
- System Design: [path] ✅
- Feature Plan: [path] ✅

Change Context:
- Change Type: [enhancement/bug/security]
- Release Type: [major/minor/patch]

Optional Context:
- Code Location: [path or "Not provided"]

Output:
- Report Location: [output_file_path]

Starting E2E test strategy analysis...
```

**Store:** artifact_paths, change_type, release_type, output_file_path, code_location

---

## Stage 2: Gap Analysis Review

**Objective:** Extract E2E-relevant gaps and existing E2E test coverage from test gap analysis.

**Parse Test Gap Analysis:**

Extract the following sections:

1. **Testing Philosophy Analysis**
   - Architecture type (frontend/backend/serverless/microservices/full-stack)
   - Recommended testing model (pyramid/trophy/hybrid)
   - Expected E2E test distribution percentage
   - Current E2E test distribution percentage
   - Alignment status

2. **Current E2E Test Coverage**
   - Total E2E test cases (not just files - run test suite to get accurate count)
   - E2E test files and locations
   - User journeys currently covered by E2E tests
   - E2E test status (passing/failing)
   - **CRITICAL:** Distinguish between test files and test cases (1 file may contain 10-50 tests)

3. **Identified E2E Gaps**
   - Critical gaps requiring E2E tests
   - Warning gaps suggesting E2E tests
   - Manual testing requirements that could be automated with E2E tests

4. **Coverage by Epic/Feature**
   - Which features have E2E coverage
   - Which features lack E2E coverage
   - Priority of uncovered features

**CRITICAL: Test Counting Best Practices**

When analyzing test coverage:

- **Always use test runner output** as source of truth (not file system scanning)
- **Test files ≠ test cases** - a single file may contain 10-50 individual tests
- **Run test suite** to get accurate test case counts (e.g., `npm test`, `pytest --collect-only`)
- **Example:** 123 test files = 1,236 test cases (10x difference)
- **Classification matters:** Different definitions of "integration test" lead to different distributions
- **Report both metrics:** Test files AND test cases for clarity

**Build E2E Gap Map:**

Structure: `{ feature, user_journey, current_e2e_status, gap_severity, recommendation, estimated_effort }`

**Output:** `Gap Analysis Parsed: [N] E2E gaps identified | [M] existing E2E test files | [P] existing E2E test cases | [Q]% current E2E coverage`

**Store:** e2e_gaps, existing_e2e_test_files, existing_e2e_test_cases, current_e2e_coverage, testing_philosophy

---

## Stage 3: User Journey Mapping

**Objective:** Identify critical user journeys from Phase 1 requirements that are candidates for E2E testing.

**Parse User Stories:**

Extract from each user story:

- User story ID and title
- User persona (who performs the journey)
- User goal (what they want to accomplish)
- Acceptance criteria (success conditions)
- Priority (P0/P1/P2)
- Business value/impact

**Identify User Journeys:**

A user journey is a sequence of user actions to accomplish a goal. Look for:

**Multi-Step Workflows:**

- Login → Dashboard → Action → Confirmation
- Search → Filter → Select → Details → Action
- Create → Edit → Submit → Review → Approve

**Critical Business Flows:**

- User registration and onboarding
- Authentication and authorization
- Core business transactions (purchase, booking, submission)
- Data creation and modification workflows
- Payment and checkout processes

**Cross-Feature Interactions:**

- Workflows spanning multiple features
- Workflows requiring multiple user roles
- Workflows with external system dependencies

**Build User Journey Map:**

For each journey:

- Journey ID (e.g., UJ-001)
- Journey name (e.g., "User Login and Task Creation")
- Steps (sequence of user actions)
- User stories covered (which stories this journey validates)
- Acceptance criteria covered
- Business criticality (critical/high/medium/low)
- User persona
- Expected outcome

**Example Journey:**

```
Journey ID: UJ-001
Name: User Login and Task Creation
Steps:
  1. User navigates to login page
  2. User enters credentials
  3. User submits login form
  4. System authenticates user
  5. User redirects to dashboard
  6. User clicks "Create Task"
  7. User fills task form
  8. User submits task
  9. System creates task
  10. User sees success confirmation
User Stories: US-3.1 (Authentication), US-1.1 (Task Creation)
Acceptance Criteria: AC-3.1.1, AC-3.1.2, AC-1.1.1, AC-1.1.2
Business Criticality: Critical
Persona: Task Manager
Expected Outcome: User successfully logs in and creates a task
```

**Classify Journeys by Complexity:**

**Simple Journey (3-5 steps):**

- Single feature interaction
- No external dependencies
- Deterministic outcome
- Example: View task details

**Moderate Journey (6-10 steps):**

- Multiple feature interactions
- Some state management
- Conditional logic
- Example: Create and edit task

**Complex Journey (11+ steps):**

- Cross-feature workflows
- Multiple user roles
- External system integration
- Conditional branching
- Example: Multi-user approval workflow

**Output:** `User Journeys Mapped: [N] journeys identified | [M] critical | [P] high | [Q] medium`

**Store:** user_journeys, journey_complexity_map

---

## Stage 4: Integration Point Analysis

**Objective:** Extract integration points from Phase 2 architecture that require E2E validation.

**Parse System Design:**

Extract from architecture document:

1. **Architecture Overview**
   - System components (frontend, backend, database, external services)
   - Component interactions
   - Data flow patterns

2. **Integration Points**
   - Frontend → Backend API
   - Backend → Database
   - Backend → External Services (payment, email, auth)
   - Backend → AWS Services (S3, DynamoDB, SQS, SNS)
   - Service → Service (microservices)

3. **API Design**
   - API endpoints
   - Request/response formats
   - Authentication mechanisms
   - Error handling

4. **Data Flow**
   - User action → API call → Database → Response
   - Event-driven flows (SQS, SNS, EventBridge)
   - Batch processing flows

**Identify E2E-Critical Integration Points:**

**Critical for E2E Testing:**

- User-facing workflows (UI → API → Database → UI)
- Authentication flows (UI → Auth Service → API)
- Payment processing (UI → Payment Gateway → Backend)
- Data persistence (Create/Update → Database → Retrieve)
- External service integration (Email, SMS, third-party APIs)

**Not Critical for E2E Testing (Integration Tests Sufficient):**

- Internal service-to-service calls (covered by integration tests)
- Database query optimization (covered by integration tests)
- Caching mechanisms (covered by integration tests)
- Background job processing (covered by integration tests)

**Map Integration Points to User Journeys:**

For each user journey, identify which integration points are exercised:

```
Journey: User Login and Task Creation
Integration Points:
  - Frontend → API Gateway → Lambda Authorizer → Cognito (authentication)
  - Frontend → API Gateway → Lambda → DynamoDB (task creation)
  - Lambda → CloudWatch Logs (audit logging)
```

**Output:** `Integration Points Analyzed: [N] total | [M] critical for E2E | [P] covered by integration tests`

**Store:** integration_points, e2e_critical_integrations, journey_integration_map

---

## Stage 5: Change Impact Assessment

**Objective:** Evaluate how change type and release type affect E2E testing strategy.

**Change Type Impact:**

**Enhancement:**

- New features require E2E tests for new user journeys
- Modified features require E2E regression tests
- Focus: Validate new functionality works end-to-end
- Priority: Medium to High (depends on feature criticality)

**Bug Fix:**

- Bugs in user-facing workflows require E2E regression tests
- Bugs in backend logic may only need integration tests
- Focus: Prevent regression of the bug
- Priority: High (if bug affected critical user journey)

**Security Fix:**

- Security issues in authentication/authorization require E2E tests
- Security issues in data handling require E2E validation
- Focus: Validate security controls work end-to-end
- Priority: Critical (security cannot be compromised)

**Release Type Impact:**

**Major Release (X.0.0):**

- Breaking changes require full E2E regression suite
- New features require E2E tests for all new journeys
- Focus: Validate entire system works after major changes
- E2E Test Count: High (full regression + new features)

**Minor Release (X.Y.0):**

- New features require E2E tests for new journeys
- Existing features require targeted E2E regression tests
- Focus: Validate new features + critical existing journeys
- E2E Test Count: Medium (targeted regression + new features)

**Patch Release (X.Y.Z):**

- Bug fixes require E2E tests for affected journeys
- No new features, minimal E2E test additions
- Focus: Validate bug fix + critical existing journeys
- E2E Test Count: Low (affected journeys + smoke tests)

**Calculate Change Impact Score:**

```
Change Impact Score = (Change Type Weight × 0.6) + (Release Type Weight × 0.4)

Change Type Weights:
- Security: 10
- Bug (critical user journey): 8
- Bug (non-critical): 5
- Enhancement (critical feature): 7
- Enhancement (non-critical): 4

Release Type Weights:
- Major: 10
- Minor: 6
- Patch: 3

Impact Score Ranges:
- Critical (8-10): Full E2E regression + new tests
- High (6-7.9): Targeted E2E regression + new tests
- Medium (4-5.9): Affected journeys + smoke tests
- Low (1-3.9): Smoke tests only
```

**Output:** `Change Impact: [Score] | Change Type: [type] | Release Type: [type] | Impact Level: [Critical/High/Medium/Low]`

**Store:** change_impact_score, impact_level

---

## Stage 6: E2E Test Candidate Identification

**Objective:** Determine which user journeys and integration points require E2E tests.

**Apply E2E Test Selection Criteria:**

**Include in E2E Test Suite:**

1. **Critical User Journeys** (Must Have E2E Tests)
   - Authentication and authorization flows
   - Core business transactions (purchase, booking, submission)
   - Data creation and modification workflows
   - Payment and checkout processes
   - User registration and onboarding

2. **High-Risk Integration Points** (Must Have E2E Tests)
   - External service integration (payment gateway, email service)
   - Authentication service integration (Cognito, Auth0)
   - Cross-system data flows (UI → API → Database → External Service)

3. **Regulatory/Compliance Requirements** (Must Have E2E Tests)
   - Audit logging workflows
   - Data encryption workflows
   - Access control workflows
   - Data residency validation

4. **High Business Impact** (Should Have E2E Tests)
   - Revenue-generating workflows
   - Customer-facing workflows
   - Workflows with high usage frequency

**Exclude from E2E Test Suite:**

1. **Simple CRUD Operations** (Integration Tests Sufficient)
   - Single-step create/read/update/delete
   - No complex business logic
   - No external dependencies

2. **Internal Service Interactions** (Integration Tests Sufficient)
   - Service-to-service calls within same system
   - Database query operations
   - Caching mechanisms

3. **UI-Only Interactions** (Component Tests Sufficient)
   - Button clicks with no API calls
   - Form validation (client-side only)
   - UI state management (no backend interaction)

4. **Background Processes** (Integration Tests Sufficient)
   - Scheduled jobs
   - Batch processing
   - Async event processing (unless user-visible outcome)

**Build E2E Test Candidate List:**

For each candidate:

- Candidate ID (e.g., E2E-001)
- User journey or integration point
- Test objective (what this E2E test validates)
- Inclusion reason (why E2E test is needed)
- User stories covered
- Acceptance criteria covered
- Integration points exercised
- Test complexity (simple/moderate/complex)
- Estimated effort (hours)

**Example Candidate:**

```
Candidate ID: E2E-001
User Journey: User Login and Task Creation
Test Objective: Validate user can authenticate and create a task end-to-end
Inclusion Reason: Critical user journey, authentication integration, data persistence
User Stories: US-3.1, US-1.1
Acceptance Criteria: AC-3.1.1, AC-3.1.2, AC-1.1.1, AC-1.1.2
Integration Points:
  - Frontend → API Gateway → Lambda Authorizer → Cognito
  - Frontend → API Gateway → Lambda → DynamoDB
Test Complexity: Moderate (8 steps)
Estimated Effort: 3-4 hours
```

**Output:** `🎯 E2E Candidates Identified: [N] candidates | [M] critical | [P] high | [Q] medium`

**Store:** e2e_candidates

---

## Stage 7: Prioritization Matrix Generation

**Objective:** Apply scoring model to rank E2E test candidates by priority.

**Prioritization Scoring Model:**

```
Priority Score = (Business Impact × 0.4) + (Technical Risk × 0.3) + (Change Type Weight × 0.3)

Business Impact (0-10):
- Critical user journey (authentication, payment, core transaction): 10
- High-value feature (revenue-generating, customer-facing): 7
- Standard feature (supporting functionality): 4
- Edge case or low-usage feature: 1

Technical Risk (0-10):
- Security-related (authentication, authorization, encryption): 10
- Data integrity (create, update, delete operations): 8
- External service integration (payment, email, third-party API): 6
- UI-only interaction (no backend risk): 3

Change Type Weight (0-10):
- Security fix: 10
- Bug fix (critical journey): 7
- Enhancement (critical feature): 5
- Enhancement (non-critical): 2

Priority Score Ranges:
- P0 (Critical): 8.0-10.0
- P1 (High): 6.0-7.9
- P2 (Medium): 4.0-5.9
- P3 (Low): 0-3.9
```

**Calculate Priority Scores:**

For each E2E test candidate:

1. Assign Business Impact score (0-10)
2. Assign Technical Risk score (0-10)
3. Assign Change Type Weight (0-10)
4. Calculate Priority Score using formula
5. Assign Priority Level (P0/P1/P2/P3)

**Example Calculation:**

```
E2E-001: User Login and Task Creation
- Business Impact: 10 (critical user journey)
- Technical Risk: 10 (authentication + data persistence)
- Change Type Weight: 5 (enhancement)
- Priority Score: (10 × 0.4) + (10 × 0.3) + (5 × 0.3) = 4.0 + 3.0 + 1.5 = 8.5
- Priority Level: P0 (Critical)
```

**Generate Prioritization Matrix:**

Create table with all E2E test candidates ranked by priority score:

| Priority | Test ID | User Journey        | Business Impact | Technical Risk | Change Weight | Score | Effort |
| -------- | ------- | ------------------- | --------------- | -------------- | ------------- | ----- | ------ |
| P0       | E2E-001 | Login + Create Task | 10              | 10             | 5             | 8.5   | 3-4h   |
| P0       | E2E-002 | Payment Checkout    | 10              | 9              | 5             | 8.2   | 4-6h   |
| P1       | E2E-003 | Search + Filter     | 7               | 6              | 5             | 6.1   | 2-3h   |
| P2       | E2E-004 | Profile Update      | 4               | 8              | 2             | 4.6   | 2-3h   |

**Group by Priority Level:**

- **P0 (Critical)**: Must implement before release
- **P1 (High)**: Should implement before release
- **P2 (Medium)**: Implement if time permits
- **P3 (Low)**: Defer to future release

**Output:** `Prioritization Complete: [N] P0 | [M] P1 | [P] P2 | [Q] P3`

**Store:** prioritization_matrix, priority_groups

---

## Stage 8: Strategy Recommendations

**Objective:** Generate execution approach, test data strategy, and environment recommendations.

**Execution Approach:**

**Test Execution Order:**

Based on priority and dependencies:

1. **Phase 1: Critical Path (P0 Tests)**
   - Execute authentication and authorization tests first
   - Then execute core business transaction tests
   - Rationale: These tests validate system is functional before testing features

2. **Phase 2: High Priority (P1 Tests)**
   - Execute high-value feature tests
   - Execute external integration tests
   - Rationale: Validate important features work correctly

3. **Phase 3: Medium Priority (P2 Tests)**
   - Execute supporting feature tests
   - Execute edge case tests
   - Rationale: Increase coverage for less critical paths

**Test Execution Strategy:**

**Sequential Execution:**

- Use when: Tests have dependencies (test B requires data from test A)
- Example: User registration → User login → User action
- Pros: Predictable, easier to debug
- Cons: Slower execution time

**Parallel Execution:**

- Use when: Tests are independent (no shared state)
- Example: Multiple user journeys with isolated test data
- Pros: Faster execution time
- Cons: Requires careful test data management

**Hybrid Execution:**

- Use when: Mix of dependent and independent tests
- Example: Run authentication tests sequentially, then run feature tests in parallel
- Pros: Balance speed and reliability
- Cons: More complex test orchestration

**Recommended Execution Strategy:**

Based on test count and dependencies:

- **< 10 E2E tests**: Sequential execution (simplicity over speed)
- **10-30 E2E tests**: Hybrid execution (critical path sequential, features parallel)
- **> 30 E2E tests**: Parallel execution with test groups (maximize speed)

**Test Data Strategy:**

**Test Data Approaches:**

**1. Static Test Data (Pre-seeded)**

- Approach: Database seeded with test data before test execution
- Use when: Tests need consistent, predictable data
- Pros: Fast test execution, no data creation overhead
- Cons: Data can become stale, conflicts between parallel tests
- Example: Pre-created user accounts, product catalog

**2. Dynamic Test Data (Created per test)**

- Approach: Each test creates its own test data
- Use when: Tests need isolated data, parallel execution
- Pros: No data conflicts, tests are independent
- Cons: Slower test execution, cleanup required
- Example: Create unique user per test, generate unique task ID

**3. Hybrid Test Data**

- Approach: Static data for read-only operations, dynamic data for write operations
- Use when: Mix of read and write operations
- Pros: Balance speed and isolation
- Cons: More complex data management
- Example: Static product catalog, dynamic user accounts

**Recommended Test Data Strategy:**

Based on test characteristics:

- **Read-heavy tests**: Static test data (faster execution)
- **Write-heavy tests**: Dynamic test data (better isolation)
- **Mixed tests**: Hybrid test data (balance speed and isolation)

**Test Data Management:**

**Data Creation:**

- Use API calls to create test data (not direct database manipulation)
- Use test data factories or builders for consistency
- Generate unique identifiers (timestamps, UUIDs) to avoid conflicts

**Data Cleanup:**

- Clean up test data after each test (avoid data accumulation)
- Use test hooks (afterEach, afterAll) for cleanup
- Consider soft deletes for audit trail

**Test Data Isolation:**

- Use unique identifiers per test run (test-run-ID-timestamp)
- Use separate test databases per environment (dev, staging, CI)
- Avoid sharing test data between tests

**Environment Recommendations:**

**Test Environment Options:**

**1. Dedicated E2E Environment**

- Setup: Separate environment for E2E tests only
- Pros: Stable, predictable, no interference from other testing
- Cons: Additional infrastructure cost, maintenance overhead
- Use when: Large test suite, frequent E2E test execution

**2. Shared Staging Environment**

- Setup: E2E tests run in staging environment (shared with manual testing)
- Pros: Lower cost, tests run in production-like environment
- Cons: Potential conflicts with manual testing, less stable
- Use when: Small test suite, infrequent E2E test execution

**3. Ephemeral Environments (Per Test Run)**

- Setup: Spin up environment for each test run, tear down after
- Pros: Complete isolation, no conflicts, always clean state
- Cons: Slower test execution (environment setup time), higher cost
- Use when: Microservices architecture, containerized applications

**Recommended Environment:**

Based on architecture and test count:

- **Serverless (Lambda, DynamoDB)**: Dedicated E2E environment (low cost, easy to maintain)
- **Containerized (ECS, EKS)**: Ephemeral environments (good isolation, manageable cost)
- **Traditional (EC2, RDS)**: Shared staging environment (lower cost, acceptable for small test suites)

**Environment Configuration:**

**Required Configuration:**

- Test database (separate from production)
- Test user accounts (with appropriate permissions)
- External service mocks or test accounts (payment gateway, email service)
- Feature flags (enable/disable features for testing)
- Logging and monitoring (CloudWatch, X-Ray)

**Test Execution Timing:**

**When to Run E2E Tests:**

**1. Pre-Merge (Code Review)**

- Run: Smoke tests only (P0 critical path)
- Rationale: Fast feedback, catch critical issues early
- Execution time: < 5 minutes

**2. Post-Merge (CI Pipeline)**

- Run: Full E2E test suite (P0 + P1)
- Rationale: Validate integration before deployment
- Execution time: 15-30 minutes

**3. Pre-Deployment (Staging)**

- Run: Full E2E test suite (P0 + P1 + P2)
- Rationale: Final validation before production
- Execution time: 30-60 minutes

**4. Post-Deployment (Production Smoke Tests)**

- Run: Smoke tests only (P0 critical path)
- Rationale: Validate deployment succeeded
- Execution time: < 5 minutes

**5. Scheduled (Nightly/Weekly)**

- Run: Full E2E test suite + exploratory tests
- Rationale: Catch regressions, validate system health
- Execution time: 1-2 hours

**Test Framework Recommendations:**

**Frontend E2E Testing:**

- **Playwright**: Modern, fast, multi-browser support, good debugging
- **Cypress**: Developer-friendly, good documentation, limited to Chromium-based browsers
- **Selenium**: Mature, multi-browser, slower execution

**API E2E Testing:**

- **Postman/Newman**: API testing, easy to use, good for REST APIs
- **REST Assured**: Java-based, good for Java projects
- **Supertest**: Node.js-based, good for Express/Node.js APIs

**Serverless E2E Testing:**

- **LocalStack**: Local AWS service emulation, good for development
- **AWS SAM**: Local Lambda testing, good for SAM-based projects

**Recommended Framework:**

Based on architecture:

- **Frontend (React/Vue/Angular)**: Playwright (modern, fast, multi-browser)
- **Backend API (REST)**: Postman/Newman (easy to use, good reporting)
- **Serverless (Lambda)**: Playwright or Postman/Newman (via real API endpoints) + LocalStack for local testing
- **Full-Stack**: Playwright (frontend) + Postman (API)

**Output:** `✅ Strategy Recommendations Generated: Execution approach | Test data strategy | Environment recommendations | Framework recommendations`

**Store:** execution_strategy, test_data_strategy, environment_recommendations, framework_recommendations

---

## Stage 9: Report Generation

**Objective:** Create E2E test strategy document with all analysis and recommendations, including detailed test specifications in appendix.

**Report Structure:**

````markdown
# E2E Test Strategy Report

**Generated:** [CURRENT_DATE]
**Change Type:** [enhancement/bug/security]
**Release Type:** [major/minor/patch]
**Application:** [Application Name]

---

## Executive Summary

**E2E Test Candidates Identified:** [N] tests
**Priority Distribution:**

- P0 (Critical): [N] tests ([M] hours estimated)
- P1 (High): [P] tests ([Q] hours estimated)
- P2 (Medium): [R] tests ([S] hours estimated)
- P3 (Low): [T] tests ([U] hours estimated)

**Total Estimated Effort:** [X] hours ([Y] developer days)

**Recommended Execution Strategy:** [Sequential/Parallel/Hybrid]
**Recommended Test Data Strategy:** [Static/Dynamic/Hybrid]
**Recommended Environment:** [Dedicated/Shared/Ephemeral]
**Recommended Framework:** [Playwright/Cypress/Postman]

**Change Impact Assessment:**

- Change Impact Score: [Score]
- Impact Level: [Critical/High/Medium/Low]
- Rationale: [Explanation based on change type and release type]

---

## Testing Philosophy Alignment

**Architecture Type:** [Frontend/Backend/Serverless/Full-Stack/Microservices]
**Recommended Testing Model:** [Pyramid/Trophy/Hybrid/Microservices]

**Expected E2E Test Distribution:** [X]%
**Current E2E Test Distribution:** [Y]%
**Alignment Status:** [Aligned/Misaligned]

**Analysis:**
[Explanation of current E2E coverage vs expected]

---

## E2E Test Prioritization Matrix

### P0 (Critical) - Must Implement Before Release

| Test ID | User Journey   | Business Impact | Technical Risk | Change Weight | Score   | Effort  | User Stories |
| ------- | -------------- | --------------- | -------------- | ------------- | ------- | ------- | ------------ |
| E2E-001 | [Journey Name] | [Score]         | [Score]        | [Score]       | [Score] | [Hours] | [US-X.Y]     |

**Total P0 Tests:** [N] | **Total Effort:** [M] hours

### P1 (High) - Should Implement Before Release

[Same table structure]

**Total P1 Tests:** [N] | **Total Effort:** [M] hours

### P2 (Medium) - Implement If Time Permits

[Same table structure]

**Total P2 Tests:** [N] | **Total Effort:** [M] hours

### P3 (Low) - Defer to Future Release

[Same table structure]

**Total P3 Tests:** [N] | **Total Effort:** [M] hours

---

## User Journey Coverage

### Critical User Journeys (P0)

#### Journey: [Journey Name]

**Journey ID:** [UJ-001]
**Steps:**

1. [Step 1]
2. [Step 2]
3. [Step 3]
   ...

**User Stories Covered:** [US-X.Y, US-A.B]
**Acceptance Criteria Covered:** [AC-X.Y.Z, AC-A.B.C]
**Integration Points Exercised:**

- [Frontend → API Gateway → Lambda → DynamoDB]
- [Lambda → Cognito]

**E2E Test:** [E2E-001]
**Test Objective:** [What this test validates]
**Test Complexity:** [Simple/Moderate/Complex]
**Estimated Effort:** [Hours]

**Test Approach:**
[High-level description of how to test this journey]

---

## Integration Point Coverage

### Critical Integration Points Requiring E2E Validation

| Integration Point | Source      | Target      | Protocol         | E2E Test  | Status        |
| ----------------- | ----------- | ----------- | ---------------- | --------- | ------------- |
| [Name]            | [Component] | [Component] | [HTTP/SDK/Event] | [E2E-001] | [Covered/Gap] |

**Total Integration Points:** [N]
**Covered by E2E Tests:** [M] ([X]%)
**Covered by Integration Tests:** [P] ([Y]%)
**Gaps:** [Q]

---

## Execution Strategy

### Test Execution Order

**Phase 1: Critical Path (P0 Tests)**

- Execute: [E2E-001, E2E-002, E2E-003]
- Estimated Time: [X] minutes
- Rationale: Validate system is functional before testing features

**Phase 2: High Priority (P1 Tests)**

- Execute: [E2E-004, E2E-005, E2E-006]
- Estimated Time: [Y] minutes
- Rationale: Validate important features work correctly

**Phase 3: Medium Priority (P2 Tests)**

- Execute: [E2E-007, E2E-008]
- Estimated Time: [Z] minutes
- Rationale: Increase coverage for less critical paths

**Total Execution Time:** [X+Y+Z] minutes

### Execution Approach

**Recommended Strategy:** [Sequential/Parallel/Hybrid]

**Rationale:** [Explanation based on test count and dependencies]

**Execution Plan:**

- [Specific execution approach for this test suite]

---

## Test Data Strategy

### Recommended Approach

**Strategy:** [Static/Dynamic/Hybrid]

**Rationale:** [Explanation based on test characteristics]

### Test Data Management

**Data Creation:**

- [Approach for creating test data]
- [Tools or frameworks to use]

**Data Cleanup:**

- [Approach for cleaning up test data]
- [When to clean up (after each test, after suite)]

**Data Isolation:**

- [Approach for isolating test data]
- [Unique identifier strategy]

### Test Data Examples

**Example 1: User Account Data**

```json
{
  "email": "test-user-{timestamp}@example.com",
  "password": "********",
  "role": "task-manager"
}
```
````

**Example 2: Task Data**

```json
{
  "title": "E2E Test Task {uuid}",
  "description": "Created by E2E test",
  "dueDate": "2026-12-31",
  "priority": "high"
}
```

---

## Environment Recommendations

### Recommended Environment

**Environment Type:** [Dedicated/Shared/Ephemeral]

**Rationale:** [Explanation based on architecture and test count]

### Environment Configuration

**Required Components:**

- Test database: [DynamoDB table with test data]
- Test user accounts: [Pre-created test users with roles]
- External service mocks: [Payment gateway test mode, email service mock]
- Feature flags: [Enable/disable features for testing]
- Logging: [CloudWatch Logs, X-Ray tracing]

**Environment Setup:**
[Step-by-step instructions for setting up test environment]

---

## Test Framework Recommendations

### Recommended Framework

**Framework:** [Playwright/Cypress/Postman]

**Rationale:** [Explanation based on architecture and requirements]

### Framework Configuration

**Installation:**

```bash
[Installation commands]
```

**Configuration:**

```javascript
[Configuration file example]
```

**Example Test:**

```javascript
[Example E2E test using recommended framework]
```

---

## Implementation Roadmap

### Week 1: Critical Path (P0 Tests)

**Tests to Implement:** [E2E-001, E2E-002, E2E-003]
**Estimated Effort:** [X] hours
**Focus:** Authentication, core business transactions

**Deliverables:**

- [ ] E2E-001: [Test name] implemented and passing
- [ ] E2E-002: [Test name] implemented and passing
- [ ] E2E-003: [Test name] implemented and passing
- [ ] Test environment configured
- [ ] Test data strategy implemented

### Week 2: High Priority (P1 Tests)

**Tests to Implement:** [E2E-004, E2E-005, E2E-006]
**Estimated Effort:** [Y] hours
**Focus:** High-value features, external integrations

**Deliverables:**

- [ ] E2E-004: [Test name] implemented and passing
- [ ] E2E-005: [Test name] implemented and passing
- [ ] E2E-006: [Test name] implemented and passing
- [ ] CI/CD integration complete

### Week 3: Medium Priority (P2 Tests)

**Tests to Implement:** [E2E-007, E2E-008]
**Estimated Effort:** [Z] hours
**Focus:** Supporting features, edge cases

**Deliverables:**

- [ ] E2E-007: [Test name] implemented and passing
- [ ] E2E-008: [Test name] implemented and passing
- [ ] Test reporting configured

---

## Test Execution Timing

### When to Run E2E Tests

**Pre-Merge (Code Review):**

- Run: Smoke tests (P0 critical path)
- Execution Time: < 5 minutes
- Rationale: Fast feedback, catch critical issues early

**Post-Merge (CI Pipeline):**

- Run: Full E2E suite (P0 + P1)
- Execution Time: 15-30 minutes
- Rationale: Validate integration before deployment

**Pre-Deployment (Staging):**

- Run: Full E2E suite (P0 + P1 + P2)
- Execution Time: 30-60 minutes
- Rationale: Final validation before production

**Post-Deployment (Production):**

- Run: Smoke tests (P0 critical path)
- Execution Time: < 5 minutes
- Rationale: Validate deployment succeeded

**Scheduled (Nightly):**

- Run: Full E2E suite + exploratory tests
- Execution Time: 1-2 hours
- Rationale: Catch regressions, validate system health

---

## Success Metrics

### Coverage Metrics

**Target E2E Coverage:** [X]% (based on testing philosophy)
**Current E2E Coverage:** [Y]%
**Gap:** [Z]%

**Coverage by Priority:**

- P0 (Critical): [X]% target → [Y]% current
- P1 (High): [X]% target → [Y]% current
- P2 (Medium): [X]% target → [Y]% current

### Quality Metrics

**Test Pass Rate:** Target > 95%
**Test Execution Time:** Target < 30 minutes (P0 + P1)
**Test Flakiness:** Target < 5%
**Test Maintenance:** Target < 10% of development time

### Business Metrics

**Defect Detection:** Measure defects caught by E2E tests vs production
**Release Confidence:** Survey team confidence before release
**Production Incidents:** Track incidents related to untested user journeys

---

## Risk Assessment

### Risks of Not Implementing E2E Tests

**High Risk:**

- [Specific risk related to critical user journey]
- [Specific risk related to external integration]

**Medium Risk:**

- [Specific risk related to high-value feature]
- [Specific risk related to data integrity]

**Low Risk:**

- [Specific risk related to edge case]

### Mitigation Strategies

**For High Risks:**

- Implement P0 E2E tests before release (mandatory)
- Increase manual testing for critical paths
- Implement monitoring and alerting for production

**For Medium Risks:**

- Implement P1 E2E tests before release (recommended)
- Document manual testing procedures
- Plan for post-release E2E test implementation

**For Low Risks:**

- Defer P2/P3 E2E tests to future release
- Rely on integration tests and manual testing
- Monitor production for issues

---

## Next Steps

1. **Review and Approve Strategy:** Team review of E2E test strategy
2. **Set Up Test Environment:** Configure dedicated E2E test environment
3. **Implement P0 Tests:** Focus on critical path (Week 1)
4. **Implement P1 Tests:** Focus on high-value features (Week 2)
5. **Integrate with CI/CD:** Automate E2E test execution
6. **Monitor and Iterate:** Track metrics, adjust strategy as needed

---

## Appendix: Detailed Test Specifications

### Appendix A: P0 (Critical) Test Specifications

#### E2E-001: [Test Name]

**Test Objective:** [What this test validates]

**Prerequisites:**

- [Required setup or conditions]
- [Test data requirements]
- [Environment configuration]

**Test Steps:**

1. [Detailed step with expected result]
2. [Detailed step with expected result]
3. [Detailed step with expected result]
   ...

**Expected Results:**

- [Specific validation point 1]
- [Specific validation point 2]
- [Specific validation point 3]

**Test Data:**

```json
{
  "example": "test data structure"
}
```

**Assertions:**

- [ ] Assert 1: [Specific assertion]
- [ ] Assert 2: [Specific assertion]
- [ ] Assert 3: [Specific assertion]

**Cleanup:**

- [Cleanup step 1]
- [Cleanup step 2]

**Estimated Effort:** [X-Y hours]
**Complexity:** [Simple/Moderate/Complex]
**Dependencies:** [Other tests or setup required]

---

[Repeat for each P0 test]

### Appendix B: P1 (High) Test Specifications

[Same structure as Appendix A for P1 tests]

### Appendix C: P2 (Medium) Test Specifications

[Same structure as Appendix A for P2 tests]

### Appendix D: Test Data Templates

**Template 1: User Account**

```json
{
  "email": "test-user-{timestamp}@example.com",
  "password": "**********",
  "role": "Admin",
  "mfaEnabled": false
}
```

**Template 2: Task Entity**

```json
{
  "id": "{uuid}",
  "name": "E2E Test Task {uuid}",
  "description": "Created by E2E test {test-id}",
  "status": "TODO",
  "assignee": "{user-email}",
  "dueDate": "{iso-date}",
  "creationDate": "{iso-timestamp}"
}
```

[Additional templates as needed]

### Appendix E: Test Environment Setup

**Step 1: Deploy E2E CDK Stack**

```bash
cd infrastructure/
cdk deploy TaskFlowStack-E2E --context environment=e2e
```

**Step 2: Configure Test Framework**

```bash
npm install --save-dev @playwright/test
npx playwright install
```

**Step 3: Set Environment Variables**

```bash
export E2E_BASE_URL=https://d1234567890.cloudfront.net
export E2E_API_URL=https://api.example.com
export E2E_COGNITO_USER_POOL_ID=us-west-2_ABC123
```

**Step 4: Seed Test Data (Optional)**

```bash
npm run seed:e2e-data
```

### Appendix F: Test Execution Commands

**Run All E2E Tests:**

```bash
npm run test:e2e
```

**Run P0 Tests Only:**

```bash
npm run test:e2e -- --grep "@P0"
```

**Run Specific Test:**

```bash
npm run test:e2e -- --grep "E2E-001"
```

**Run Tests in Parallel:**

```bash
npm run test:e2e -- --workers=4
```

**Generate HTML Report:**

```bash
npm run test:e2e -- --reporter=html
```

### Appendix G: Troubleshooting Guide

**Issue 1: Authentication Failures**

- **Symptom:** Tests fail with 401 Unauthorized
- **Cause:** JWT token expired or invalid
- **Solution:** Regenerate test user credentials, check Cognito User Pool configuration

**Issue 2: Test Data Conflicts**

- **Symptom:** Tests fail with duplicate key errors
- **Cause:** Test data not cleaned up from previous run
- **Solution:** Run cleanup script, ensure unique identifiers per test run

**Issue 3: Flaky Tests**

- **Symptom:** Tests pass/fail intermittently
- **Cause:** Race conditions, timing issues, network latency
- **Solution:** Add explicit waits, increase timeouts, use retry logic

[Additional troubleshooting scenarios]

---

**Report Location:** [output_file_path]
**Analysis Duration:** [X] seconds

**Test Counting Methodology:**

- Test files counted: [N] files
- Test cases counted: [M] cases (via test runner output)
- Ratio: [M/N] test cases per file (average)
- Source: [Test runner command used]

```

**Save Report:**

Write report to user-specified output file path.

**IMPORTANT: Appendix Content**

The appendix provides detailed, implementation-ready test specifications that teams can use directly. Each test specification includes:
- Complete test steps with expected results
- Specific assertions to validate
- Test data structures
- Setup and cleanup procedures
- Troubleshooting guidance

This level of detail enables QA engineers to implement tests without additional planning, while the main report provides strategic overview for stakeholders.

**Final Output Message:**
```

✅ E2E Test Strategy Complete!

Report saved to: [output_file_path]
Analysis Duration: [X] seconds

Summary:

- E2E Test Candidates: [N]
- P0 (Critical): [M] tests ([X] hours)
- P1 (High): [P] tests ([Y] hours)
- Total Estimated Effort: [Z] hours ([W] developer days)

Recommended Strategy:

- Execution: [Sequential/Parallel/Hybrid]
- Test Data: [Static/Dynamic/Hybrid]
- Environment: [Dedicated/Shared/Ephemeral]
- Framework: [Playwright/Cypress/Postman]

Next Steps:

1. Review and approve strategy
2. Set up test environment
3. Implement P0 tests (Week 1)
4. Implement P1 tests (Week 2)
5. Integrate with CI/CD

```

---

## Quality Gate

**CRITICAL (must fix):**
- P0 tests not defined for critical user journeys
- No execution strategy (sequential vs parallel) documented
- Test environment requirements not specified

**IMPORTANT (should fix):**
- Test data strategy not defined (how to seed, how to clean up)
- No CI/CD integration plan for automated test runs
- Framework selection not justified against team experience

**SUGGESTION:**
- Could add visual regression tests for UI-heavy flows
- Could define retry strategy for flaky network-dependent tests

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
```
