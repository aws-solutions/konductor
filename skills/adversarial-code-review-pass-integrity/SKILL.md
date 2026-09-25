---
name: adversarial-code-review-pass-integrity
description: 'Use when a diff needs a focused data-integrity review: multi-item mutations, atomicity, ordering, or idempotency. One of three parallel passes that adversarial-code-review runs; for a full adversarial review, use that skill.'
version: 1.0.0
tags: [skill, data-integrity, code-review, adversarial, pass]
---

# Adversarial Code Review — Data Integrity Pass

## Overview

Reviews a diff through the lens of data integrity and failure modes. This is one of three parallel review passes spawned by an adversarial-review coordinator SOP. The framing is neutral by design: review through the lens of integrity, do not assume any specific issue exists.

## Usage

Spawned by an adversarial-review coordinator SOP (such as `k-adversarial-pull-request-review`) as one of three parallel subagent passes. May also be run directly against a diff.

## What to look for

Review through the lens of data integrity. In this diff, does anything:

- Perform a multi-item mutation without a transaction — two or more writes that must succeed or fail together
- Issue an unconditional `put` or `update` on a resource that can see concurrent writes
- Miss a condition expression, version check, or optimistic-lock guard on a contested resource
- Introduce a write path that has no test exercising the mutation
- Retry a non-idempotent operation without an idempotency key
- Depend on ordering across independent async events without a sequencing mechanism
- Lose the return value of a write and then re-read the item redundantly
- Delete or overwrite state on an error path where rollback or compensation is required

For each concern, name the file:line, the concrete failure scenario (partial write, lost update, ordering race), and a specific fix.

## Out of scope

- Do not flag a single-item write as requiring a transaction — transactions apply to multi-item mutations that must succeed or fail together, not to a lone `put`/`update`.
- Do not flag bulk or unconditional writes in test setup/teardown code (e.g. seeding fixture data before a test, tearing down state after) — this is expected test scaffolding, not a defect. This exempts setup/teardown specifically, not test files as a whole: a non-atomic write in the code path actually under test (the one the test's assertions target) is still in scope and must be flagged.

## Codebase awareness

Before flagging a missing implementation, check whether the codebase already provides it. Flag reimplementation or bypass, not absence:

- Existing transaction or batch-write helpers → flag reimplementation
- Established idempotency-key middleware → flag routes that skip it
- Shared repository or DAO layer → flag direct client calls that bypass it

## Checker handoff

Findings produced by this pass are candidates, not verdicts. The coordinator forwards them to a different-persona checker that applies `adversarial-code-review` in Validator Mode before anything reaches the CR. Produce your honest read.

## Severity guidance

- **CRITICAL** — non-atomic multi-item mutation without a transaction; unconditional overwrite on a contested resource; delete/overwrite on an error path with no rollback
- **IMPORTANT** — write path without test coverage; retry of a non-idempotent operation without an idempotency key; missing condition expression that a shared pattern in this repo uses
- **SUGGESTION** — extra query where a write's return value could be used; condition expression present but weaker than warranted (e.g. `attribute_exists` where a version match would fit)

## Output format

```
[SEVERITY] Data Integrity — file:line
Problem: {what is wrong and why it is a risk}
Fix: {concrete suggested change}
```

Return the findings list. Do not deduplicate against other passes — the coordinator does that.
