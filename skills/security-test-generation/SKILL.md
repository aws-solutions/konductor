---
name: security-test-generation
description: 'Use when a service needs its security test coverage planned. Generates a security test plan by domain and layer: authentication, input validation, API security, data protection, session management, error handling, and infrastructure.'
version: 1.0.0
tags: [skill, security-testing, owasp, quality-assurance, aws]
---

# Security Test Generation

## Overview

Generates security test plans by domain (authentication, input validation, API security, data protection, session management, error handling, infrastructure) and layer (frontend, backend, infrastructure). Integrates AWS and OWASP security testing best practices.

## Usage

Use this skill when:

- Creating security test coverage for a new service
- Preparing for a security review or AppSec engagement
- Generating test cases from a threat model

## Core Concepts

### Seven Security Domains

Authentication (login, MFA, session), Input Validation (injection, XSS, CSRF), API Security (rate limiting, authorization), Data Protection (encryption, PII handling), Session Management (timeout, fixation), Error Handling (information disclosure, stack traces), and Infrastructure (S3 public access, security groups, IAM).

### Three Test Layers

Frontend (browser-based attacks, client-side validation bypass), Backend (API-level attacks, business logic bypass), and Infrastructure (misconfiguration, network exposure).

## Execution

When this skill is activated, use the following as your full instruction set for generating security tests. Apply the Quality Gate at the end before presenting output to the user.

---

# Security Test Generator

## Execution Flow

Follow stages sequentially. Each stage builds on previous outputs.

## Task List Configuration

**Task List Directory:** `{output_dir}`, optional and defaulting to `.kiro/specs/security-testing/`. This default applies to the Kiro branch of Stage 8 (`tool_type == "kiro"`). The non-Kiro branch of Stage 8 defaults `output_dir` to `security-test-plans/` instead.
**Task List File:** `{output_dir}/tasks.md`

`output_dir` lets a calling SOP place the task list alongside its other artifacts. Callers that pass nothing get the default, so existing behavior is unchanged. These paths are used throughout the prompt for task list generation and tracking.

## Unattended and Parallel Callers

This skill asks the user several questions: tool type, technology stack, and how to proceed with generation. A calling SOP that runs this per feature in parallel, or with no human present, MUST pass `scope_confirmed=true` along with the context it already holds. When `scope_confirmed` is true You MUST NOT ask any of those questions: detect what you can, take `stack` and `approach` from the caller when supplied, otherwise default to the hybrid approach over the artifacts the caller pointed you at, and report what you assumed instead of prompting. Every question in this skill is subject to that rule, not only the ones nearest this note.

---

## Stage 1: Context Gathering

**Objective:** Collect tool type and project context.

**Step 1: Auto-detect Kiro Environment**

Check for `.kiro` directory in project root:

- If `.kiro` directory exists → automatically set `tool_type = "kiro"`, skip tool selection question
- If `.kiro` directory does not exist → proceed to Step 2

**Step 2: Collect Tool Type** (only if Kiro not detected)

Unless `scope_confirmed=true`, ask: "Which tool are you using?" Otherwise detect what you can and default `tool_type = "other"` without asking.

Options:

- Q CLI
- Cline

Store selected tool as `tool_type = "other"`

**Step 3: Collect Project Context**

Unless `scope_confirmed=true`, ask: "What is the primary technology stack for your application?" Otherwise take `stack` from the caller when supplied, or detect it from the artifacts, without asking.

Options:

- Web Application (Frontend + Backend)
- Backend API only
- Serverless (AWS Lambda)
- Full-stack (React/Vue/Angular + Node.js/Python/Java)
- Other (specify)

Store as `project_type`

**Validation:**

- Store: `tool_type`, `project_type`

---

## Stage 2: Artifact Discovery

**Objective:** Discover available security-related artifacts.

**Search for Artifacts:**

Design & Architecture:

- Threat model (search for: `threat-model.md`, `security-design.md`, `threat-analysis.md`)
- API specifications (search for: `openapi.yaml`, `api-spec.json`, `swagger.yaml`)
- Security requirements (search for: `security-requirements.md`, `security.md`)

Implementation & Development:

- Implementation guide (search for: `implementation-guide.md`, `implementation.md`)
- Source code directories (scan for common patterns: `src/`, `lib/`, `app/`, `lambda/`, `frontend/`, `backend/`, or any directory containing code files)

**Discovery Results:**

For each artifact type:

- Found: Store path and mark as available
- Not found: Mark as unavailable

**Store:** `discovered_artifacts` with paths and availability status

---

## Stage 3: Artifact Integration Decision

**Objective:** Present discovered artifacts and get user preference.

**Step 1: Present Findings**

Display discovered artifacts:

```
Discovered Security Artifacts:

Design & Architecture:
✅ Threat model: design-architecture/threat-model.md
✅ API specs: design-architecture/api-specs/openapi.yaml
❌ Security requirements: Not found

Implementation & Development:
✅ Implementation guide: implementation-development/implementation-guide.md
✅ Source code: src/ (TypeScript, React, Node.js detected)
```

**Step 2: Ask User Preference**

Unless `scope_confirmed=true`, ask: "How would you like to proceed with security test generation?" Otherwise take `approach` from the caller when supplied, or default to the hybrid approach over the artifacts the caller pointed you at, without asking.

Options:

1. **Use discovered artifacts** - Generate tests based on threat model, API specs, and implementation guide
2. **Analyze source code** - Deep dive into source code to identify security test areas
3. **Hybrid approach** - Use artifacts as foundation, supplement with source code analysis
4. **Manual specification** - I'll specify which security areas to test

**Step 3: Store Decision**

Store user choice as `integration_mode`:

- `artifacts_only`
- `source_code_only`
- `hybrid`
- `manual`

---

## Stage 4: Source Code Analysis

**Objective:** Analyze source code to identify security testing needs.

**Conditional Execution:**

- Execute if `integration_mode` is `source_code_only` or `hybrid`
- Skip if `integration_mode` is `artifacts_only` or `manual`

**Step 1: Identify Application Layers**

Scan source code structure to identify:

**Frontend Layer:**

- UI framework (React, Vue, Angular, Svelte)
- State management (Redux, MobX, Zustand)
- Routing (React Router, Vue Router)
- Authentication handling (token storage, session management)

**Backend Layer:**

- API framework (Express, FastAPI, Spring Boot)
- Authentication mechanism (JWT, OAuth, Cognito)
- Database access (DynamoDB, RDS, MongoDB)
- AWS service integrations (Lambda, S3, SQS)

**Infrastructure Layer:**

- CDK/CloudFormation stacks
- IAM policies and roles
- API Gateway configurations
- Security groups and VPC settings

**Step 2: Identify Security-Relevant Code Patterns**

Scan for:

**Authentication & Authorization:**

- JWT token validation
- Session management
- Role-based access control (RBAC)
- IAM policy enforcement

**Input Validation:**

- Request validation middleware
- Schema validation (Joi, Yup, Zod)
- Sanitization functions
- SQL query construction

**Data Protection:**

- Encryption functions (KMS, crypto libraries)
- Sensitive data handling
- TLS/HTTPS configuration

**API Security:**

- CORS configuration
- Rate limiting
- API authentication
- Request/response validation

**Step 3: Detect Testing Framework**

Scan for testing frameworks:

- Jest (package.json, jest.config.js)
- Vitest (vite.config.ts, vitest.config.ts)
- Mocha (package.json, .mocharc.json)
- Pytest (pytest.ini, conftest.py)
- JUnit (pom.xml, build.gradle)

Store detected framework as `testing_framework`

**Store:** `code_analysis_results` with layers, patterns, and framework

---

## Stage 5: Security Test Category Extraction

**Objective:** Identify applicable security test categories based on artifacts and/or code analysis.

**Step 1: Extract from Artifacts** (if `integration_mode` includes artifacts)

**From Threat Model:**

- Parse identified threats
- Map threats to security test categories
- Example: "SQL Injection on user input" → Input Validation & Injection Prevention

**From API Specs:**

- Extract endpoints and authentication requirements
- Identify input schemas and validation rules
- Map to API Security and Input Validation categories

**From Security Requirements:**

- Parse security controls
- Map to relevant test categories

**From Implementation Guide:**

- Extract implemented security features
- Map to test categories

**Step 2: Extract from Source Code** (if `integration_mode` includes source code)

Based on code analysis results:

- Authentication code found → Authentication & Authorization category
- Input validation found → Input Validation category
- Encryption code found → Data Protection category
- API endpoints found → API Security category

**Step 3: Organize by Hybrid Structure**

Organize identified categories by:

1. Security Domain (Authentication, Input Validation, etc.)
2. Application Layer (Frontend, Backend, Infrastructure)

**Security Domain Categories:**

1. **Authentication & Authorization**
   - Frontend: Session management, token handling, UI access controls
   - Backend: JWT validation, IAM policies, role-based access, API authorization
   - Infrastructure: Cognito configuration, IAM role policies

2. **Input Validation & Injection Prevention**
   - Frontend: XSS prevention, client-side validation, sanitization
   - Backend: SQL injection, command injection, API input validation, schema validation
   - Infrastructure: WAF rules, API Gateway request validation

3. **API Security**
   - Backend: Rate limiting, CORS, authentication per endpoint, authorization per endpoint
   - Infrastructure: API Gateway throttling, API keys, usage plans

4. **Data Protection & Encryption**
   - Frontend: Sensitive data handling in browser, secure storage
   - Backend: Encryption at rest, encryption in transit, KMS usage, secure data transmission
   - Infrastructure: S3 encryption, DynamoDB encryption, TLS configuration, certificate management

5. **Session Management**
   - Frontend: Session storage, timeout handling, secure cookies
   - Backend: Session validation, token expiration, refresh token handling

6. **Error Handling & Information Disclosure**
   - Frontend: Error message sanitization, secure error display
   - Backend: Secure logging, generic error responses, stack trace prevention

7. **Infrastructure Security**
   - Infrastructure: Security groups, VPC configuration, resource policies, least privilege IAM

**Step 4: Filter Applicable Categories**

Based on `project_type` and analysis results:

- Web Application → All categories applicable
- Backend API only → Backend and Infrastructure categories
- Serverless → Backend (Lambda) and Infrastructure categories

**Store:** `security_test_categories` with domain, layer, and applicability

---

## Stage 6: Best Practices Integration

**Objective:** Integrate AWS and OWASP security testing best practices.

**Step 1: Load Best Practices**

**AWS Security Best Practices:**

- AWS Foundational Security Best Practices
- CIS AWS Foundations Benchmark
- Least privilege IAM policies
- Encryption at rest and in transit
- Secure API design

**OWASP Best Practices:**

- OWASP Top 10 vulnerabilities
- OWASP Web Security Testing Guide (WSTG)
- Input validation and output encoding
- Authentication and session management
- Access control testing
- Cryptography testing

**Step 2: Map Best Practices to Categories**

For each security test category:

- Identify relevant best practices
- Add best practice references to category metadata
- Include specific testing guidelines

Example mapping:

- Authentication & Authorization → OWASP Authentication Testing, AWS IAM Best Practices
- Input Validation → OWASP Injection Testing, OWASP API Security Top 10
- Data Protection → AWS Encryption Best Practices, OWASP Cryptography Testing

**Store:** `best_practices_mapping` with category-to-practice associations

---

## Stage 7: Task List Generation

**Objective:** Generate high-level security test tasks.

**Step 1: Create Foundation Task**

Always include as Task 1:

```markdown
- [ ] 1. Review security testing foundations
  - Review OWASP Top 10 vulnerabilities
  - Review AWS Security Best Practices documentation
  - Review applicable security guidelines for your organization
  - Familiarize with detected testing framework: [framework_name]
  - Review threat model (if available): [path]
  - Review API specifications (if available): [path]
```

**Step 2: Generate Category Tasks**

For each applicable security test category:

**Task Format:**

```markdown
- [ ] N. [Security Domain] - [Application Layer]
  - Generate requirements.md with security test requirements and acceptance criteria
  - Generate design.md with test strategy, attack scenarios, and validation approach
  - Generate tasks.md with specific test cases in checkbox format
  - Test order: Positive tests → Negative tests → Edge cases (optional)
  - Best practices: [relevant best practices]
  - References: [threat model sections, API endpoints, code files]
```

**Task Numbering:**

- Start from 2 (Task 1 is foundation review)
- Order by dependency and criticality: 2. Authentication & Authorization (foundational) 3. Input Validation & Injection Prevention (critical) 4. API Security 5. Data Protection & Encryption 6. Session Management 7. Error Handling & Information Disclosure 8. Infrastructure Security

**Step 3: Add Test Execution Guidance**

For each task, include sub-bullets:

**Positive Tests:**

- Valid credentials accepted
- Proper authorization grants access
- Valid inputs processed correctly
- Encrypted data transmitted securely

**Negative Tests:**

- Invalid credentials rejected (401)
- Unauthorized access denied (403)
- Malicious inputs blocked (SQL injection, XSS, command injection)
- Unencrypted connections rejected

**Edge Cases (Optional):**

- Expired tokens handled gracefully
- Concurrent sessions managed correctly
- Boundary values validated
- Special characters sanitized

**Store:** `task_list` with all generated tasks

---

## Stage 8: Artifact Generation

**Objective:** Generate tool-specific output files based on detected or selected tool.

### Branch: Kiro Users (`tool_type == "kiro"`)

**Detection Note:** Kiro environment auto-detected via `.kiro` directory presence.

**Generate Primary Task List Only:**

1. **Create Security Testing Task List:**

   File: `{output_dir}/tasks.md`

   **Header:**

   ```markdown
   # Security Testing Implementation Plan

   This file tracks security test generation and execution across all application layers.
   Each task generates detailed requirements, design, and test cases for a specific security domain.

   ## Testing Approach

   - Test Order: Positive tests → Negative tests → Edge cases (optional)
   - Framework: [detected_framework]
   - Best Practices: AWS, OWASP

   ## Discovered Artifacts

   [List of discovered artifacts with paths]

   ## Tasks
   ```

   **Task List:**
   - Include Task 1 (foundation review)
   - Include all category tasks in priority order
   - Each task includes:
     - Security domain and layer
     - Sub-bullets for spec generation
     - Best practice references
     - Artifact references (if applicable)

**Output Message:**

```
✅ Security test plan complete!

Environment: Kiro (auto-detected)

Generated Files:
- `{output_dir}/tasks.md` (primary task list)

Security Test Categories:
The file contains [N] security test categories organized by domain and application layer.

Discovered Artifacts:
[List artifacts that were found and will be used]

Testing Framework: [detected_framework]

Workflow:
1. Open `{output_dir}/tasks.md`
2. **IMPORTANT: Start with Task 1** - Review security testing foundations
   - Familiarize yourself with OWASP Top 10, AWS best practices, and testing framework
3. Click "Start task" on the first security test category to generate its detailed spec
4. The spec generation will create requirements.md, design.md, and tasks.md for that category
5. Implement tests following the order: Positive → Negative → Edge cases
6. After completing the category, return to the primary task list and proceed to the next

Security tests will be created in priority order, ensuring foundational security (authentication) is tested first.

Best Practices Applied:
- AWS Security Best Practices
- OWASP Web Security Testing Guide

Refining: Re-run to update based on new artifacts or code changes.
```

### Branch: Non-Kiro Users (`tool_type == "other"`)

**Selection Note:** Tool type selected by user (Q CLI or Cline).

**Generate:**

1. Directory: `{output_dir}`, optional and defaulting to `security-test-plans/`. This default applies to this non-Kiro branch (`tool_type == "other"`). The Kiro branch above defaults `output_dir` to `.kiro/specs/security-testing/` instead.
2. Per category: `{output_dir}/[domain]-[layer].md` with description, test cases, best practices, references
3. `{output_dir}/security-test-overview.md`: master view, all categories, testing framework, best practices
4. `{output_dir}/best-practices-reference.md`: AWS, OWASP guidelines

`output_dir` lets a calling SOP place these files alongside its other artifacts, the same way it places the Kiro branch's `tasks.md`. Callers that pass nothing get the default, so existing behavior is unchanged.

**Output Message:**

```
✅ Security test plans generated: [N] categories in `{output_dir}`

Environment: [Q CLI | Cline] (user-selected)

Category Files: [list]
Overview Files: {output_dir}/security-test-overview.md, {output_dir}/best-practices-reference.md

Testing Framework: [detected_framework]

Using with Q CLI:
q chat --prompt "Implement security tests from {output_dir}/[category-file].md"

Using with Cline:
1. Open {output_dir}/[category-file].md
2. Copy test cases and requirements
3. Paste into Cline

Recommended Execution Order: [list by priority]

Best Practices Applied:
- AWS Security Best Practices
- OWASP Web Security Testing Guide

Refining: Re-run to update based on new artifacts or code changes.
```

---

## Stage 9: Summary & Next Steps

**Objective:** Provide completion summary and guidance.

**Summary:**

```
Security Test Plan Complete!

Summary:
- Security Test Categories: [N]
- Application Layers: [Frontend/Backend/Infrastructure]
- Testing Framework: [detected_framework]
- Artifacts Used: [list if applicable]
- Best Practices: AWS, OWASP

Files Created: [list with paths]

Test Execution Order:
1. Authentication & Authorization
2. Input Validation & Injection Prevention
3. API Security
4. Data Protection & Encryption
5. Session Management
6. Error Handling & Information Disclosure
7. Infrastructure Security

Next Steps:
1. Review generated task list
2. Start with Task 1 (foundation review)
3. Implement tests in priority order
4. Follow test order: Positive → Negative → Edge cases
5. Track progress in your tool
6. Re-run if artifacts or code changes
```

---

## File Output Strategy

**All Outputs:**

- Save all artifacts to disk (never rely on context window)
- Provide clear file paths for each generated file
- Organize in logical directory structure
- Summarize what was created and where

---

## State Management

Maintain throughout conversation:

```typescript
{
  tool_type: "kiro" | "other",
  tool_detection_method: "auto" | "manual",
  selected_tool?: "Q CLI" | "Cline",
  project_type: string,
  discovered_artifacts: {
    threat_model?: string,
    api_specs?: string,
    security_requirements?: string,
    implementation_guide?: string,
    source_code_dirs: string[]
  },
  integration_mode: "artifacts_only" | "source_code_only" | "hybrid" | "manual",
  code_analysis_results?: {
    frontend_layer?: object,
    backend_layer?: object,
    infrastructure_layer?: object,
    security_patterns: string[],
    testing_framework: string
  },
  security_test_categories: Array<{
    domain: string,
    layer: string,
    applicable: boolean,
    best_practices: string[],
    references: string[]
  }>,
  best_practices_mapping: object,
  task_list: Array<Task>
}
```

---

## Error Handling Principles

**Missing Artifacts:**

- Continue with source code analysis
- Inform user about missing artifacts
- Offer to proceed with available information

**No Testing Framework Detected:**

- Ask user which framework they use
- Provide framework-agnostic test descriptions
- Offer to adapt tests to specified framework

**Insufficient Code Analysis:**

- Warn user about limited analysis
- Suggest manual specification of security areas
- Offer to proceed with best-effort analysis

**File System Errors:**

- Catch permission/disk space/existing path errors
- Suggest alternatives
- Offer retry/alternative location/overwrite options

---

## Execution Notes

**Conversation Flow:**

- Follow stages sequentially
- Don't skip unless explicitly allowed
- Validate inputs before proceeding
- Store all state for later stages

**Branching Logic:**

- Tool type auto-detection (Stage 1): Check for `.kiro` directory at startup
- Tool type determines output format (Stage 8)
- Artifact integration decision (Stage 3) determines execution path
- Source code analysis (Stage 4) is conditional on integration mode
- Kiro users: Generate primary task list only; specs created via "Start task" (Stage 8)
- Non-Kiro users: Generate all security test plans (Stage 8)

**User Experience:**

- Clear prompts with examples
- Actionable error messages
- Progress indicators
- Completion summary
- Transparent tool detection (inform user when Kiro auto-detected)
- Show discovered artifacts before asking preference

---

## Quality Gate

**CRITICAL (must fix):**

- Authentication bypass tests not included
- SQL/NoSQL injection tests missing for all data inputs
- Authorization tests missing (horizontal and vertical privilege escalation)

**IMPORTANT (should fix):**

- OWASP Top 10 not fully covered
- Infrastructure security tests not included (S3 public access, security group rules)
- No tests for sensitive data exposure in logs or error messages

**SUGGESTION:**

- Could add rate limiting and DDoS resilience tests
- Could add dependency vulnerability scanning to CI pipeline

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
