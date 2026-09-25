---
name: backend-review
description: Use when backend changes are implemented and not yet in code review, to catch problems early. Reviews architectural pattern compliance, type safety, DynamoDB correctness, and test quality, with CRITICAL, IMPORTANT, and SUGGESTION findings. For frontend code, use frontend-review.
version: 1.0.0
tags: [skill, backend, code-review, lambda, dynamodb, typescript, checker]
---

# Backend Review

## Overview

Reviews backend code with a critical eye across architectural patterns, type safety, DynamoDB operations, error handling, observability, and test coverage. Provides direct, unbiased assessment. Calls out over-engineering, KISS/YAGNI/DRY violations, and unnecessary complexity.

## Usage

Use this skill when:

- Reviewing backend changes before submitting a code review
- Validating that a fix follows established architectural patterns
- Checking DynamoDB operations for atomicity and efficiency
- Assessing test coverage and quality

## Core Concepts

### Review Focus Areas

Architectural pattern compliance (layer separation), dead code detection (unused exports after refactoring), type safety (no `any`, null checks before assertions), DynamoDB correctness (atomicity, conditional writes, no extra queries), error handling (specific catches, structured logging), and test quality (fixture factories, order-independent assertions).

## Review Checklist

### Architectural Patterns

- [ ] Handlers delegate to business facade: no direct business logic in handlers
- [ ] Services created via factory: no direct instantiation
- [ ] Data access through repository interfaces: no direct database calls
- [ ] Proper layer separation maintained

### Dead Code

- [ ] Deleted or replaced functions have no remaining callers
- [ ] No unused imports after refactoring
- [ ] Documentation referencing deleted code is updated

### Type Safety

- [ ] No `any` types in production code
- [ ] Null checks present before non-null assertions
- [ ] Proper error types (not generic `Error`)
- [ ] TypeScript utility types used correctly (`Partial`, `Pick`, `Omit`)

### DynamoDB Operations

- [ ] Multi-item updates use transactions (atomic)
- [ ] No extra queries: write return values used where available
- [ ] Conditional writes used to prevent race conditions
- [ ] Key design follows single-table patterns

### Error Handling

- [ ] Specific error catching (not catch-all)
- [ ] Proper error propagation
- [ ] Structured logging with context and correlation IDs

### Testing

- [ ] Shared fixture factories used (not inline test data)
- [ ] Order-independent assertions (`toContainEqual`)
- [ ] Edge cases covered (null, empty arrays, boundaries)
- [ ] New code has test coverage

## Quality Gate

**CRITICAL (blocks approval):**

- Race condition risk (non-atomic multi-item update without transaction)
- Direct database connection bypassing repository layer
- Missing null check before non-null assertion that will throw at runtime
- Test passes only due to test order dependency

**IMPORTANT (should fix):**

- `any` type in production code
- Extra query when write return value could be used
- Catch-all error handler masking specific errors
- Inline test data instead of fixture factory
- Over-engineered solution for a simple problem (call this out directly)

**SUGGESTION:**

- Could add structured log fields for better observability
- Could strengthen test assertions to check actual values not just existence
- Could extract repeated logic into shared utility

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
