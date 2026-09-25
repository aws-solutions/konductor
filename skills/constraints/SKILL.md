---
name: constraints
description: Use when any Konductor agent does any work, on every interaction and regardless of task or context; this skill is mandatory. Defines the non-negotiable code quality, security, and verification rules.
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

1. **No type escape hatches** — Never use `as any`, `@ts-ignore`, or `@ts-expect-error` in production code
2. **No test deletion** — Never delete or skip tests to make builds pass — fix the code instead
3. **No broken commits** — Never commit code that doesn't compile
4. **No speculation** — Never speculate about unread code — read the file first
5. **No broken state** — Never leave code in a broken state between steps
6. **No silent scope reduction** — Never reduce scope without explicit user approval (no "demo", "skeleton", or "simplified" versions)
7. **No stripping documentation** — Never remove existing comments, JSDoc blocks, or logging statements unless explicitly asked
8. **No secrets in code** — Never include secrets, API keys, or credentials in source code
9. **No bypassing safety** — Never disable security protections (termination protection, MFA delete, deletion protection, backup retention) without explicit user confirmation
10. **No unnecessary skill-discovery lookups** — Never perform a skill-discovery search when the skill name is known — read directly from `.kiro/skills/{skill-name}/SKILL.md`. Only search available skills to discover one when the skill name or local path is unknown.

### ALWAYS DO

1. **Read before edit** — Always read the complete file before making changes
2. **Follow existing patterns** — Always match the conventions already in the codebase
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

- Any NEVER DO rule violated
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
