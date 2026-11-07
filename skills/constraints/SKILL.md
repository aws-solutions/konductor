---
name: constraints
description: MUST USE for every interaction across all Konductor agents. Defines the maker-checker, quality gate, and failure recovery rules; the always-loaded core rules hold the rest.
version: 1.0.0
tags: [skill, behavioral, constraints, quality, security]
---

# Constraints

## Overview

Hard rules that ALL Konductor agents must follow in every interaction. These are non-negotiable — violations are treated as CRITICAL failures regardless of context.

## Usage

This skill is always active. It applies to every task across all Konductor agents. No explicit activation needed.

## Core Rules

### NEVER DO

The NEVER DO rules live in the core rules, which every agent loads at session start.

### ALWAYS DO

1. **Read before edit**: see Engineering practices in the core rules
2. **Follow existing patterns**: see Engineering practices and Writing habits in the core rules
3. **Maker-checker** — Always run the maker-checker pattern: generate artifact → validate with the corresponding checker skill before presenting to the user
4. **Backward compatibility**: see Engineering practices in the core rules
5. **Comment complex logic**: see Engineering practices in the core rules
6. **Structured logging**: see Engineering practices in the core rules
7. **Verify before done**: see "No broken commits" and "No broken state" under NEVER DO, and Engineering practices, in the core rules
8. **Severity ordering**: see Engineering practices in the core rules

## Failure Recovery

### 2-Strike Circuit Breaker

After 2 failed fix attempts for the same error, **STOP**. Do not attempt a third fix. Instead:

1. Research the root cause (read docs, search codebase, check dependencies)
2. Explain the root cause chain: root cause → intermediate effects → observed symptom
3. Only then propose a fix

### Unknown Systems

See Engineering practices in the core rules: research first, fix second.

### Acknowledge Uncertainty

See Engineering practices in the core rules: for an unverified claim that matters, say whether it rests on documented knowledge, inference, or a guess.

## Quality Gate

**CRITICAL (immediate stop):**

- Any NEVER DO rule violated (see the core rules)
- Artifact presented to user without checker validation (maker-checker bypass)
- Code left in non-compiling state
- Secrets or credentials in source code

**IMPORTANT (fix before proceeding):**

- ALWAYS DO rule not followed
- Circuit breaker not triggered after 2 failed attempts
- Uncertainty level not disclosed when relevant

**SUGGESTION:**

- Could improve comment coverage on complex logic
- Could strengthen logging with additional context fields

### Review findings

A CRITICAL or IMPORTANT review finding gets one fix, a fresh build and test run for code, and one re-review of every first-review CRITICAL or IMPORTANT finding plus the fix and what depends on it. A first-review finding still open, or any CRITICAL or IMPORTANT finding the re-review reports in the task's own output, carried over or new, or caused by the fix, blocks done until the user decides. A finding in code the task did not add or change, and the fix did not cause, is listed as pre-existing. (Orchestrators: Review ceilings, Verification Protocol item 6.)
