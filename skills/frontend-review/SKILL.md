---
name: frontend-review
description: Reviews frontend code changes for Cloudscape compliance, React Hook Form patterns, TypeScript type safety, and test quality. Use after implementing frontend changes to catch issues before code review. Produces CRITICAL/IMPORTANT/SUGGESTION findings.
version: 1.1.0
tags: [skill, frontend, code-review, react, typescript, cloudscape, checker]
---

# Frontend Review

## Overview

Reviews frontend code with a critical eye across Cloudscape compliance, form patterns, type safety, component quality, and test coverage. Provides direct, unbiased assessment — calls out pattern violations, unnecessary complexity, and missing test coverage.

## Usage

Use this skill when:

- Reviewing frontend changes before submitting a code review
- Validating Cloudscape component compliance
- Checking React Hook Form + Zod pattern adherence
- Assessing TypeScript type safety and test coverage

## Review Workflow

The rules live in `frontend-development` (its `## Rules` section). Load that skill, then:

1. Read every changed frontend file and its tests in full.
2. Check each change against every rule group: form patterns, Cloudscape compliance, type safety, component quality, and testing.
3. Classify each violation with the Quality Gate below.

## Quality Gate

**CRITICAL (blocks approval):**

- Native HTML element used instead of Cloudscape component
- Inline style used (`style={{}}`)
- Form state managed with `useState` instead of React Hook Form
- `any` type in production code
- Test passes only due to implementation detail coupling

**IMPORTANT (should fix):**

- Missing explicit type on `useForm` call
- Hardcoded validation message instead of constraint constant
- Event handler not memoized (causes unnecessary re-renders)
- Dynamic column count in `ColumnLayout` (causes layout shift)
- Test assertions check existence but not actual values

**SUGGESTION:**

- Could extract repeated form field pattern into reusable component
- Could add missing edge case tests
- Could strengthen error state test coverage

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
