---
name: backend-development
description: 'Use when implementing or fixing backend code (Lambda handlers, service layers, DynamoDB operations): code quality fixes, new features, or performance work. Makes minimal, surgical changes following KISS, YAGNI, and DRY.'
version: 1.0.0
tags: [skill, backend, lambda, dynamodb, typescript, nodejs, implementation]
---

# Backend Development

## Overview

Implements backend changes with surgical precision — only the specific issue, nothing more. Covers Lambda handler patterns, service layer architecture, DynamoDB operations, type safety, error handling, and test improvements.

## Usage

Use this skill when:

- Fixing code quality issues from code review feedback
- Implementing new Lambda handlers or service methods
- Optimizing DynamoDB operations (atomicity, efficiency)
- Improving type safety (removing `any`, adding null checks)
- Adding or improving test coverage

## Core Concepts

### Architectural Layers

Handlers (entry point, delegates to facade) → Business Facade (orchestrates service calls) → Services (created via factory, contain business logic) → Repositories (data access through interfaces). No layer should bypass the one below it.

### KISS/YAGNI/DRY

Prefer simple, minimal solutions. Only add abstractions that solve a real, existing problem — not hypothetical future needs.

## Core Principles

**Always read the complete file before making changes.** Make minimal changes — only fix the specific issue. Follow established patterns in the codebase. Maintain backward compatibility.

**Prefer simple solutions over design patterns.** Only introduce patterns (Strategy, Observer) when they solve a real, existing problem — not hypothetical future needs. Call out over-engineering directly.

## Implementation Standards

### Handler Patterns

- Handlers delegate to a business facade — no direct business logic in handlers
- Services created via factory pattern — no direct instantiation
- Data access through repository interfaces — no direct database calls
- Use return values from store operations to avoid extra queries

### Type Safety

- No `any` types in production code (test mocks are the only exception)
- Use utility types: `Partial<T>`, `Pick<T, K>`, `Omit<T, K>`
- Validate before non-null assertions (`!`)
- Use `??` for null/undefined checks, not `||`

### DynamoDB Operations

- Atomic operations use transactions for multi-item updates
- Use conditional writes to prevent race conditions
- No extra queries — use return values from write operations
- Follow single-table design patterns (PK/SK)

### Error Handling

- Use specific error types, not generic `Error`
- Catch specific errors, not catch-all handlers
- Structured logging with correlation IDs and context
- Log diffs with structured fields showing before/after state

### Testing

- Create shared fixture factories for test data — not inline objects
- Use `toContainEqual` for order-independent assertions
- Add tests for new code before marking complete
- Test edge cases: null values, empty arrays, boundary conditions

## Output Format

For each change, provide:

1. File path
2. Issue (with line numbers)
3. Exact code changes
4. How to verify the fix
5. What else might be affected

## Quality Gate

**CRITICAL (must fix before done):**

- TypeScript compilation fails
- Tests fail
- Breaking change introduced without migration path
- Direct database connection bypassing repository layer
- Race condition introduced (non-atomic multi-item update)

**IMPORTANT (should fix):**

- `any` type used in production code
- Missing null check before non-null assertion
- Extra query when return value from write operation could be used
- Catch-all error handler masking specific errors
- Test data constructed inline instead of using fixture factory

**SUGGESTION:**

- Could extract repeated logic into shared utility
- Could add structured log fields for better observability
- Could strengthen test assertions to check actual values

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
