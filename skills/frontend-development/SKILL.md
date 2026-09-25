---
name: frontend-development
description: 'Use when implementing or fixing React/TypeScript frontend code on the AWS Cloudscape Design System: type safety fixes, form patterns, component extraction, or new UI features. Uses Cloudscape components only, never native HTML.'
version: 1.0.0
tags: [skill, frontend, react, typescript, cloudscape, forms, implementation]
---

# Frontend Development

## Overview

Implements frontend changes with surgical precision — only the specific issue, nothing more. Covers React Hook Form + Zod validation patterns, Cloudscape component compliance, TypeScript type safety, component extraction, and test improvements.

## Usage

Use this skill when:

- Fixing type safety issues (removing `any`, adding explicit types)
- Implementing or fixing form validation patterns
- Extracting reusable components
- Ensuring Cloudscape-only component usage (no native HTML)
- Adding or improving test coverage

## Core Concepts

### Form Architecture

React Hook Form manages form state (not `useState`). Zod handles validation (not manual checks). Sub-components access form via `useFormContext` (no prop drilling). Wizard pages wrap in `FormProvider`.

### Cloudscape-Only Rule

No native HTML elements in UI code. Use `Box` instead of `<div>`/`<span>`, `Input` instead of `<input>`, `Button` instead of `<button>`, `Link` instead of `<a>`, `SpaceBetween` instead of margin/padding.

## Core Principles

**Always read the complete file before making changes.** Make minimal changes — only fix the specific issue. Follow established patterns. Maintain backward compatibility.

## Implementation Standards

### Form Patterns

- Use React Hook Form — not custom state hooks for form management
- Use Zod for validation — not manual validation logic
- Form sub-components use `useFormContext` — no prop drilling
- Wizard pages wrapped in `FormProvider`
- Use `.refine()` for cross-field validation, not `.transform()`
- Use constraint constants for validation messages — not hardcoded strings

### Cloudscape Compliance

- Only Cloudscape components — no native HTML (`<div>`, `<span>`, `<input>`, `<button>`, `<a>`)
- No inline styles (`style={{}}`)
- `Box` instead of `<div>` or `<span>`
- `SpaceBetween` for spacing — not margin/padding
- `KeyValuePairs` for label-value display
- `FormField` wraps all form inputs with labels
- Fixed column counts in `ColumnLayout` — no dynamic column counts

### Type Safety

- No `any` types in production code
- Explicit types on `useForm<FormType>()` calls
- Use utility types: `Pick<T, K>`, `Omit<T, K>`, `Partial<T>`
- No redundant type assertions

### Component Quality

- Memoize event handlers with `useCallback`
- Add defensive checks for array index access
- No unnecessary wrapper components
- Imperative array building for 3+ conditional items (not ternary chains)

### Testing

- Unit tests for helper functions (100% coverage target)
- Component tests for forms (80%+ coverage target)
- Test assertions check actual values — not just existence
- Error states and edge cases tested

## Output Format

For each change, provide:

1. File path
2. Issue (with line numbers)
3. Exact code changes
4. How to verify the fix
5. What else might be affected

## Quality Gate

**CRITICAL (must fix before done):**

- TypeScript compilation fails
- Tests fail
- Native HTML element used instead of Cloudscape component
- Inline style used (`style={{}}`)
- Form state managed with `useState` instead of React Hook Form

**CRITICAL (blocks approval):**

- `any` type in production code

**IMPORTANT (should fix):**

- Missing explicit type on `useForm` call
- Hardcoded validation message instead of constraint constant
- Event handler not memoized with `useCallback` (causes unnecessary re-renders)
- Dynamic column count in `ColumnLayout`

**SUGGESTION:**

- Could extract repeated form field pattern into reusable RHF wrapper component
- Could strengthen test assertions to check actual error messages
- Could add missing edge case tests

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
