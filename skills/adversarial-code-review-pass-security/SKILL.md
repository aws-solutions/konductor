---
name: adversarial-code-review-pass-security
description: 'Use when a diff needs a focused security review: information disclosure, authorization, injection, or leaked secrets. One of three parallel passes that adversarial-code-review runs; for a full adversarial review, use that skill.'
version: 1.0.0
tags: [skill, security, code-review, adversarial, pass]
---

# Adversarial Code Review — Security Pass

## Overview

Reviews a diff through the lens of security concerns. This is one of three parallel review passes spawned by an adversarial-review coordinator SOP. The framing is neutral by design: review through the lens of security, do not assume any specific issue exists.

## Usage

Spawned by an adversarial-review coordinator SOP (such as `k-adversarial-pull-request-review`) as one of three parallel subagent passes. May also be run directly against a diff.

## What to look for

Review through the lens of security. In this diff, does anything:

- Surface stack traces, internal IDs, table names, partition keys, or raw exception messages to the caller
- Log request payloads, response bodies, or auth headers at info or debug level
- Decode a pagination token, opaque cursor, or user-supplied ID and use it in a query without validation
- Cross an abstraction boundary — internal service details reaching a public API surface
- Introduce a new authorization path without checking existing middleware or authorizer wiring
- Accept input used in a query, path, or command before validation runs
- Include a hardcoded secret, API key, credential, or embedded token
- Widen an IAM policy, grant, or trust relationship

For each concern, name the file:line, the concrete failure scenario (what an attacker or unlucky caller would do), and a specific fix.

## Out of scope

- Do not flag synthetic/fake values in test fixtures as hardcoded secrets, keys, or tokens — synthetic account IDs, synthetic credentials, and synthetic internal IDs are expected in test data and are not real secrets. This exempts specific synthetic VALUES, not test files as a category: a genuine injection pattern, an actual unvalidated-input path, or unsafe code that happens to live in a test file is still in scope and must be flagged.

## Codebase awareness

Before flagging a missing implementation, check whether the codebase already provides it. Flag bypassing an existing utility, not the absence of one:

- Existing error-mapping layers → flag direct exception surfacing that bypasses them
- Shared pagination token encode/decode utilities → flag inline reimplementation
- Auth middleware or authorizer wiring → flag routes that skip it
- Secrets manager or parameter store → flag hardcoded values

## Checker handoff

Findings produced by this pass are candidates, not verdicts. The coordinator forwards them to a different-persona checker that applies `adversarial-code-review` in Validator Mode before anything reaches the CR. Do not soften findings for the checker — produce your honest read; the checker's job is to filter, not to nudge.

## Severity guidance

- **CRITICAL** — stack trace or internal ID surfaced to caller; unvalidated input used in a query; hardcoded credential; widened IAM policy on a production role
- **IMPORTANT** — request payload logged at info/debug; opaque token decoded inline where a utility exists; new auth path not wired into existing middleware
- **SUGGESTION** — abstraction boundary leak that does not directly expose sensitive data; log field that could be sensitive under some inputs

## Output format

```
[SEVERITY] Security — file:line
Problem: {what is wrong and why it is a risk}
Fix: {concrete suggested change}
```

Return the findings list. Do not deduplicate against other passes — the coordinator does that.
