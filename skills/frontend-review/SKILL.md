---
name: frontend-review
description: Use when frontend changes are implemented and not yet in code review, to catch problems early. Reviews Cloudscape compliance, React Hook Form patterns, TypeScript type safety, and test quality, with CRITICAL, IMPORTANT, and SUGGESTION findings. For backend code, use backend-review.
version: 1.0.0
tags: [skill, frontend, code-review, react, typescript, cloudscape, checker]
---

# Frontend Review

## Overview

Reviews frontend code with a critical eye across Cloudscape compliance, form patterns, type safety, component quality, and test coverage. Provides direct, unbiased assessment: calls out pattern violations, unnecessary complexity, and missing test coverage.

## Usage

Use this skill when:

- Reviewing frontend changes before submitting a code review
- Validating Cloudscape component compliance
- Checking React Hook Form + Zod pattern adherence
- Assessing TypeScript type safety and test coverage

## Core Concepts

### Review Focus Areas

Pattern compliance (React Hook Form + Zod, `useFormContext`, `FormProvider`), Cloudscape compliance (no native HTML, no inline styles), type safety (no `any`, explicit `useForm<T>()` types), code quality (memoized handlers, stable layouts, no unnecessary wrappers), and test quality (actual value assertions, error state coverage).

## Review Checklist

### Pattern Compliance

- [ ] React Hook Form used, not custom state hooks
- [ ] Zod validation used, not manual validation
- [ ] Form sub-components use `useFormContext`, no prop drilling
- [ ] Wizard pages wrapped in `FormProvider`

### Cloudscape Compliance

- [ ] No native HTML elements (`<div>`, `<span>`, `<input>`, `<button>`, `<a>`)
- [ ] No inline styles (`style={{}}`)
- [ ] `Box` used instead of `<div>` or `<span>`
- [ ] `KeyValuePairs` for label-value display
- [ ] `SpaceBetween` for spacing
- [ ] Fixed column counts in `ColumnLayout`
- [ ] `FormField` wraps all form inputs

### Type Safety

- [ ] No `any` types in production code
- [ ] Explicit types on `useForm<FormType>()` calls
- [ ] TypeScript utility types used correctly (`Pick`, `Omit`, `Partial`)
- [ ] No redundant type assertions

### Code Quality

- [ ] No unused code or imports
- [ ] No unnecessary wrapper components
- [ ] Event handlers memoized with `useCallback`
- [ ] Imperative array building for 3+ conditional items (not ternary chains)
- [ ] Stable layouts (fixed column counts)

### Testing

- [ ] Helper functions have unit tests
- [ ] Form components have component tests
- [ ] Test assertions check actual values (not just existence)
- [ ] Error states tested
- [ ] Edge cases covered

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

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
