---
name: backend-development
description: Implements backend code changes for Lambda handlers, service layers, and DynamoDB operations. Use when fixing code quality issues, adding features, or optimizing backend logic in a TypeScript/Node codebase. Follows KISS/YAGNI/DRY principles with minimal, surgical changes.
version: 1.1.0
tags: [skill, backend, lambda, dynamodb, typescript, nodejs, implementation]
---

# Backend Development

## Overview

Implements backend changes with surgical precision: only the specific issue, nothing more. Covers Lambda handler patterns, service layer architecture, DynamoDB operations, type safety, error handling, and test improvements.

## Usage

Use this skill when:

- Fixing code quality issues from code review feedback
- Implementing new Lambda handlers or service methods
- Optimizing DynamoDB operations (atomicity, efficiency)
- Improving type safety (removing `any`, adding null checks)
- Adding or improving test coverage

## Core Concepts

### Architectural Layers

If the codebase layers handlers over a business facade, factory-built services and repository interfaces, keep that layering: handlers delegate to the facade, and no layer bypasses the one below it. If it doesn't, follow the structure it has.

### KISS/YAGNI/DRY

Prefer simple, minimal solutions. Only add abstractions or patterns (Strategy, Observer) that solve a real, existing problem, not hypothetical future needs. Call out over-engineering directly.

## Implementation Standards

### General

- Read the complete file before changing it, and read a sibling file that already does it right (for example another handler) so the fix copies its pattern.
- Fix only the issue you were given. Leave unrelated files and code alone.
- Keep changes backward compatible; a breaking change needs a migration path.
- Keep observable behavior you weren't asked to change: response codes and bodies, log messages and their fields, error types callers already handle.

### When a Fix Changes the Call Path

Moving a call behind a facade, service or repository often switches on rules the old path skipped, such as transition validation or a write condition. Each rule can now throw an error the caller never saw before. For every new error:

- Catch it by type and map it to a specific response (a 4xx for a client-caused failure), so it doesn't fall through to a 500
- Add a test for that path
- Name the behavior change in your final message, so the reviewer can decide on it

### Handler Patterns

- If the codebase uses a facade, factory or repository layer, keep it: no business logic in handlers, no direct service instantiation, no direct database calls
- Use return values from store operations to avoid extra queries

### TypeScript Type Safety

- No `any` types in production code (test mocks are the only exception)
- Use utility types: `Partial<T>`, `Pick<T, K>`, `Omit<T, K>`
- Validate before non-null assertions (`!`)
- Use `??` for null/undefined checks, not `||`

### DynamoDB Operations

- Atomic operations use transactions for multi-item updates
- Use conditional writes to prevent race conditions
- No extra queries; use return values from write operations
- Follow single-table design patterns (PK/SK)

### Error Handling

- Use specific error types, not generic `Error`
- Catch specific errors, not catch-all handlers
- Structured logging with correlation IDs and context
- Log diffs with structured fields showing before/after state

### Testing

- Create shared fixture factories for test data, not inline objects
- Use `toContainEqual` for order-independent assertions
- Add tests for new code before marking complete
- Test edge cases: null values, empty arrays, boundary conditions

## Output Format

End with a final message that covers each changed file:

1. File path
2. Issue, citing line numbers in the original file
3. Exact code change, as a short diff or before/after snippet
4. How you verified it: the command you ran and its result. If you couldn't run it, say so first and give the exact command for the reviewer
5. What else might be affected, including every behavior change (new status codes, changed log fields) and each assumption you made

## Quality Gate

**CRITICAL (must fix before done):**

- TypeScript compilation fails
- Tests fail
- Breaking change introduced without migration path
- Race condition introduced (non-atomic multi-item update)

**IMPORTANT (should fix):**

- Direct database call that bypasses a repository layer the codebase already uses
- `any` type used in production code
- Missing null check before non-null assertion
- Extra query when return value from write operation could be used
- Catch-all error handler masking specific errors
- Test data constructed inline instead of using fixture factory

**SUGGESTION:**

- Could extract repeated logic into shared utility
- Could add structured log fields for better observability
- Could strengthen test assertions to check actual values

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
