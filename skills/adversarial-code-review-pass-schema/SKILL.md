---
name: adversarial-code-review-pass-schema
description: 'Use when a diff needs a focused schema and contract review: API, schema, or type changes, backward compatibility, and validation completeness. One of three parallel passes that adversarial-code-review runs; for a full adversarial review, use that skill.'
version: 1.0.0
tags: [skill, schema, code-review, adversarial, pass]
---

# Adversarial Code Review — Schema / Contract Pass

## Overview

Reviews a diff through the lens of schema and contract stability — API shapes, type changes, validation completeness, and backward compatibility. This is one of three parallel review passes spawned by an adversarial-review coordinator SOP. The framing is neutral by design: review through the lens of contract, do not assume any specific issue exists.

## Usage

Spawned by an adversarial-review coordinator SOP (such as `k-adversarial-pull-request-review`) as one of three parallel subagent passes. May also be run directly against a diff.

## What to look for

Review through the lens of schema and contract. In this diff, does anything:

- Add a new required field, header, or parameter without a migration path for existing clients
- Change a field type, remove a field, or rename a field in a shipped API or data model
- Skip validation on a new field in one or more entry points
- Read a nested map or optional field without a guard, then act on it
- Run business logic or a side effect before input validation completes
- Register a new handler or route without wiring it into the router, authorizer, or middleware chain
- Introduce a schema field that lacks a default in read paths for existing records
- Change enum values, error codes, or status names that consumers pattern-match on

For each concern, name the file:line, the concrete failure scenario (which client breaks, which record becomes unparseable), and a specific fix.

## Out of scope

- Do not flag validation issues on synthetic fixture data in test files — test fixtures intentionally skip production validation paths. This exempts fixture DATA specifically, not test files as a category: a genuine contract/schema defect in production-reachable code that happens to live in a test file is still in scope and must be flagged.

## Codebase awareness

Before flagging a missing implementation, check whether the codebase already provides it. Flag bypassing an existing utility, not the absence of one:

- Shared input validation middleware or schema validators → flag bypassing them
- Existing versioning or migration helpers → flag ad-hoc migration logic
- Established default-handling patterns for schema evolution → flag divergence

## Checker handoff

Findings produced by this pass are candidates, not verdicts. The coordinator forwards them to a different-persona checker that applies `adversarial-code-review` in Validator Mode before anything reaches the CR. Produce your honest read.

## Severity guidance

- **CRITICAL** — breaking change to a shipped API or data model without a migration path; new field required by write path but not defaulted in read path (existing records unparseable)
- **IMPORTANT** — validate-then-act ordering violation (validation exists but runs after a side effect); integration wiring gap (handler present, not wired to auth or middleware); missing guard on a map/optional access that will be reached at runtime
- **SUGGESTION** — new field validated at one entry point but not another; enum change that consumers may pattern-match on

## Output format

```
[SEVERITY] Schema/Contract — file:line
Problem: {what is wrong and why it is a risk}
Fix: {concrete suggested change}
```

Return the findings list. Do not deduplicate against other passes — the coordinator does that.
