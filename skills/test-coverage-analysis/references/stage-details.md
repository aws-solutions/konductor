# Test coverage analysis: stage details

Read this when you reach Stage 0, 3, 5 or 6 of `SKILL.md`; read only the section for the current stage.

# Stage 0: Testing Philosophy Detection

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

# Stage 3: Test Distribution Analysis

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

# Stage 5: Non-Functional Test Coverage Analysis

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

# Stage 6: Integration Point Analysis

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

Step 3 (validate extraction) is in `SKILL.md`.

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
