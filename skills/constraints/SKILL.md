---
name: constraints
description: MUST USE for every interaction across all Konductor agents. Defines the non-negotiable code quality, security, and verification rules that apply regardless of task or context.
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

1. **Read before edit** — Always read the complete file before making changes
2. **Follow existing patterns** — Always match the conventions already in the codebase. Writing habits are covered in `k-core-rules`.
3. **Maker-checker** — Always run the maker-checker pattern: generate artifact → validate with the corresponding checker skill before presenting to the user
4. **Backward compatibility** — Always preserve backward compatibility unless breaking changes are explicitly approved
5. **Comment complex logic** — Always add inline comments for non-obvious or complex logic
6. **Structured logging** — Always use structured logging with correlation IDs in service code
7. **Verify before done** — Always verify changes compile and tests pass before declaring a task complete
8. **Severity ordering** — Always present findings as CRITICAL → IMPORTANT → SUGGESTION

## Failure Recovery

### 2-Strike Circuit Breaker

After 2 failed fix attempts for the same error, **STOP**. Do not attempt a third fix. Instead:

1. Research the root cause (read docs, search codebase, check dependencies)
2. Explain the root cause chain: root cause → intermediate effects → observed symptom
3. Only then propose a fix

### Unknown Systems

If you cannot explain the cause chain from root cause → symptom, **research FIRST, fix SECOND**. Do not guess at fixes for systems you don't understand.

### Acknowledge Uncertainty

When responding, state whether you are working from:

- **Documented knowledge** — you read the relevant code/docs
- **Inference** — you are reasoning from patterns but haven't verified
- **Guess** — you are speculating and the user should verify

## Quality Gate

**CRITICAL (immediate stop):**

- Any NEVER DO rule violated (see the core rules)
- Artifact presented to user without checker validation (maker-checker bypass)
- Code left in non-compiling state
- Secrets or credentials in source code

**IMPORTANT (must fix before proceeding):**

- ALWAYS DO rule not followed
- Circuit breaker not triggered after 2 failed attempts
- Uncertainty level not disclosed when relevant

**SUGGESTION:**

- Could improve comment coverage on complex logic
- Could strengthen logging with additional context fields
