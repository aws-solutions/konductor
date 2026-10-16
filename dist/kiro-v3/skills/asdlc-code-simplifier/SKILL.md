---
name: asdlc-code-simplifier
description: Simplifies and refines code for clarity, consistency, and maintainability while preserving functionality. Use when reviewing recently modified code, refactoring for readability, applying coding standards, or reducing complexity without changing behavior.
version: 1.0.0
tags: [refactor, simplify, readability, maintainability]
---

# Code Simplifier

## Overview

Enhance code clarity, consistency, and maintainability while preserving exact functionality. Prioritize readable, explicit code over overly compact solutions.

## Usage

Use this skill when:

- Reviewing recently modified code for simplification opportunities
- Refactoring code for improved readability
- Applying project coding standards consistently
- Reducing unnecessary complexity and nesting
- Consolidating redundant code or abstractions

## Core Concepts

### Preserve Functionality

Never change what the code does — only how it does it. All original features, outputs, and behaviors **MUST** remain intact.

### Clarity Over Brevity

- Avoid nested ternary operators — prefer switch statements or if/else chains
- Explicit code is better than overly compact code
- Readable code beats clever one-liners

### Balance

Avoid over-simplification that could reduce maintainability, create overly clever solutions, combine too many concerns, or remove helpful abstractions.

## Refinement Process

1. **Identify** recently modified code sections
2. **Analyze** for clarity and consistency improvements
3. **Apply** project-specific best practices
4. **Verify** functionality remains unchanged
5. **Document** only significant changes

## Quick Reference

| Improvement  | Do                       | Don't                       |
| ------------ | ------------------------ | --------------------------- |
| Conditionals | Use if/else or switch    | Nested ternaries            |
| Naming       | Clear, descriptive names | Abbreviations               |
| Nesting      | Flatten when possible    | Deep nesting (>3)           |
| Comments     | Explain why, not what    | Obvious comments            |
| Abstractions | Keep helpful ones        | Remove all for "simplicity" |

## Common Mistakes

### Over-Simplification

**Problem:** Combining too much into dense one-liners for fewer lines.
**Fix:** Prioritize readability over line count.

### Changing Behavior

**Problem:** Accidentally altering functionality while refactoring.
**Fix:** Test before and after. Preserve all outputs and behaviors.

### Removing Useful Abstractions

**Problem:** Flattening everything removes helpful organization.
**Fix:** Keep abstractions that improve code organization and reuse.
