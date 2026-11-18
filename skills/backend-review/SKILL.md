---
name: backend-review
description: 'Reviews backend code changes for architectural pattern compliance, type safety, DynamoDB correctness, and test quality. Use when reviewing a backend diff or PR (TS Lambda handlers, services, DynamoDB access), or asked to check backend code before review. Produces CRITICAL/IMPORTANT/SUGGESTION findings.'
version: 1.1.0
tags: [skill, backend, code-review, lambda, dynamodb, typescript, checker]
---

# Backend Review

## Overview

Reviews backend code with a critical eye across architectural patterns, type safety, DynamoDB operations, error handling, observability, and test coverage. Provides direct, unbiased assessment — calls out over-engineering, KISS/YAGNI/DRY violations, and unnecessary complexity.

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

### Stated Rules

Read the README and any docs that state business rules (limits, invariants, boundary wording such as "at or below") before reading the code. Check each rule against the code, and treat a mismatch as a defect rather than assuming the code is intended. Cite the rule in the finding.

- [ ] Comparisons match the documented boundary (`<` vs `<=`, inclusive vs exclusive ranges)
- [ ] Documented invariants hold under every write path, including concurrent ones

### Architectural Patterns

Check only the layers the codebase uses; otherwise check the change follows the structure it has.

- [ ] If there is a facade: handlers delegate to it, with no business logic in handlers
- [ ] If there is a factory: services come from it, not direct instantiation
- [ ] If there is a repository layer: data access goes through its interfaces, not direct database calls

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
- [ ] No extra queries — write return values used where available
- [ ] Conditional writes used to prevent race conditions
- [ ] Key design follows single-table patterns

### Input and Access

- [ ] Every mutating route enforces the same auth check as its siblings
- [ ] Request input is validated before it reaches a service or a query
- [ ] Queries use bound parameters, never string-built SQL or expressions

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

Rank by impact on users and data, not by which checklist section a finding came from.

**CRITICAL (blocks approval):**

- Injection, or a missing auth check that lets an unauthenticated caller change data
- Direct database call that bypasses a repository layer the codebase already uses
- Race condition risk (non-atomic multi-item update without transaction)
- Missing null check before non-null assertion that will throw at runtime
- Test passes only due to test order dependency

**IMPORTANT (should fix):**

- Code that contradicts a documented business rule (unless it corrupts data, then CRITICAL)
- `any` type in production code
- Extra query when write return value could be used
- Catch-all error handler masking specific errors
- Inline test data instead of fixture factory
- Over-engineered solution for a simple problem (call this out directly)

**SUGGESTION:**

- Could add structured log fields for better observability
- Could strengthen test assertions to check actual values not just existence
- Could extract repeated logic into shared utility

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" unless `scope_confirmed` is true or the task asked for a report only. In those cases report all the findings and leave fixing to the caller, without asking.
