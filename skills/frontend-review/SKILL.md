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

The rules live in `frontend-development` (its `## Rules` section). Skills install side by side, so it sits next to this skill's directory. Load that skill, then:

1. Read every changed frontend file and its tests in full.
2. Check each change against every rule group: form patterns, Cloudscape compliance, type safety, component quality, and testing.
3. Classify each violation with the Quality Gate below.

If it is not there, use these minimums, and say in the report that the full rule set was unavailable:

- **Form patterns**: React Hook Form for form state, Zod for validation, `useFormContext` in sub-components, wizard pages wrapped in `FormProvider`
- **Cloudscape compliance**: Cloudscape components only, no native HTML and no inline styles, `SpaceBetween` for spacing, `FormField` around every labelled input
- **Type safety**: no `any` in production code, an explicit type on every `useForm` call, no redundant type assertions
- **Component quality**: event handlers memoized with `useCallback`, defensive checks on array index access, no unused code or imports
- **Testing**: helper functions and form components covered, assertions on actual values, tests exercising behaviour rather than DOM structure or internal hook calls

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
