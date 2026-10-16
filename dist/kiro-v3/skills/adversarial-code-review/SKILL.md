---
name: adversarial-code-review
description: 'Targets the three gap categories standard review misses: information disclosure, data integrity, and schema validation. Use for a second-pass review after standard code review, as the checker in a maker-checker cycle, or before submitting a change that touches auth, data writes, or external API boundaries.'
version: 1.0.0
tags:
  [
    skill,
    security,
    code-review,
    adversarial,
    data-integrity,
    schema-validation,
    checker,
  ]
---

# Adversarial Code Review

## Overview

Takes the stance of a security-focused architect arguing against approval. Does not duplicate what style or quality reviewers catch — focuses exclusively on the three gap categories where standard review consistently misses: security/information disclosure, data integrity failure modes, and schema/validation completeness. Every finding must make a case for blocking or conditioning approval.

## Usage

Use this skill when:

- Running a second-pass review after standard code review is complete
- Spawned by the orchestrator as the checker in a maker-checker cycle
- Reviewing a change before submission when the change touches auth, data writes, or external API boundaries

## Modes

This skill operates in two modes. The invoker selects the mode; the two modes must not be mixed in one pass.

### Generator Mode (Maker)

The default. Read the diff, produce findings across the gap categories in `Core Concepts`. Findings may be incomplete or noisy — that is expected. A different persona in Validator Mode will filter them before they reach the CR.

### Validator Mode (Checker)

You are a filter. Never propose new findings in this mode.

For each proposed finding you review:

- Reject unless the flagged code text appears verbatim on a changed or context line in the diff for the specified file. Line-number drift within a hunk is tolerated; content invention is not.
- Reject vague suggestions (`consider improving this`, `look into this`, `may want to review`) that do not name a specific defect and a specific fix.
- Reject speculation about code outside the visible diff — you cannot review what you cannot see.
- Reject style-only nits already caught by lint, formatter, or type-checker.
- Reject praise of correct code — it is not a finding.
- Reject duplicates: if two findings reference the same file:line and the same root cause, keep the highest-severity one and drop the rest.
- When in doubt, reject. A false positive posted to a CR wastes reviewer attention and erodes trust in the whole review pipeline. A missed issue costs less.

Output for each finding: `KEEP` with the finding unchanged, or `REJECT` with a one-line reason drawn from the list above.

**Scope note for Validator Mode:** the two rule lists above are exhaustive for this mode. Everything below — `## Core Concepts`, `## Review Checklist`, `## Codebase Awareness`, `## Quality Gate`, and the closing "Ask: 'Fix these issues?'" line — is Generator Mode content. In Validator Mode, treat it as reference only (e.g. to recognize what category a candidate finding belongs to); it adds no further rejection criteria beyond the list above, it never authorizes proposing a new finding, and the closing offer-to-fix line does not apply — Validator Mode never offers to fix anything, it only returns `KEEP`/`REJECT`.

## Core Concepts

### Gap Categories

**Security Analysis**
Information disclosure in error messages and logs (stack traces, internal IDs, raw exception messages surfaced to callers), API input leaks (request payloads logged at debug/info level), pagination token injection (opaque tokens decoded and used in queries without validation), abstraction boundary violations (internal service details crossing public API boundaries).

**Data Integrity / Failure Modes**
Partial write semantics (multi-item mutations not wrapped in a transaction), unconditional overwrites (put/update without a condition expression where a concurrent write could corrupt state), missing conditional writes (optimistic locking absent on contested resources), untested write paths (code paths that mutate state with no corresponding test exercising the write).

**Schema / Validation Completeness**
Missing map guards (accessing nested map keys without checking the map exists), missing standalone fields (new fields added to a schema but not validated or defaulted in all code paths), validate-then-act ordering violations (business logic executing before input validation completes), integration wiring gaps (new handler/route registered but not wired into the router, authorizer, or middleware chain).

## Review Checklist

### Security

- [ ] Error messages returned to callers contain no stack traces, internal IDs, or raw exception text
- [ ] No request/response payloads logged at info or debug level
- [ ] Pagination tokens and opaque cursors validated before use in queries
- [ ] Internal service details (table names, partition keys, internal error codes) not exposed across API boundaries

### Data Integrity

- [ ] Multi-item mutations use DynamoDB transactions or equivalent atomic operation
- [ ] Write operations on contested resources include a condition expression
- [ ] No unconditional `put` where an `update` with condition is required
- [ ] Every write path has at least one test that exercises the mutation

### Schema / Validation

- [ ] Map/object access guarded by existence check before key traversal
- [ ] New schema fields validated and defaulted in all entry points
- [ ] Input validation runs before any business logic or side effects
- [ ] New handlers/routes wired into router, authorizer, and middleware

## Codebase Awareness

Before flagging a missing implementation, check whether the codebase already provides it:

- Existing transaction helpers or batch-write utilities — flag reimplementation as a violation
- Shared input validation middleware or schema validators — flag bypassing them
- Established error-mapping layers — flag direct exception surfacing that bypasses them
- Existing pagination token encode/decode utilities — flag inline reimplementation

## Quality Gate

**CRITICAL (blocks approval):**

- Information disclosure: stack trace, internal ID, or raw exception surfaced to caller
- Non-atomic multi-item write without transaction (data corruption risk)
- Unconditional overwrite on a resource subject to concurrent writes
- Input used in a query before validation (injection or logic bypass risk)

**IMPORTANT (should fix):**

- Request payload logged at info/debug level
- Write path with no test coverage
- Map key accessed without existence guard
- New field missing validation or default in one or more entry points
- Validate-then-act ordering violated (validation present but runs after side effect)
- Integration wiring gap (handler registered but not connected to auth/middleware)
- Opaque token decoded inline where a shared utility exists

**SUGGESTION:**

- Abstraction boundary leak that does not directly expose sensitive data but increases coupling
- Condition expression present but weaker than necessary (e.g., attribute_exists only when version check is warranted)

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. If invoked directly (not via SOP): Ask: "Fix these issues? [y/n]"

## Output Format

Each finding must include:

```
[SEVERITY] Category — file:line
Problem: {what is wrong and why it is a risk}
Fix: {concrete suggested change}
```
