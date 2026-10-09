---
name: kiro-task-generation
description: Use when design.md is approved and a Kiro IDE tasks.md is needed before implementation begins. Generates a numbered checkbox task list with requirement references from requirements.md and design.md.
version: 1.0.0
tags: [skill, kiro, specs, tasks, implementation-plan, spec-driven-development]
---

# Kiro Task Generation

## Overview

Produces `{spec_dir}/tasks.md`, a structured implementation task list for Kiro IDE's spec-driven development workflow. Each task is a coding task designed for a code-generation LLM to execute one at a time, with explicit references back to requirements.md.

`spec_dir` (optional): path where spec artifacts are written. Defaults to `.kiro/specs/{feature-name}/` if not provided. This is the same location Kiro IDE itself writes specs to, so this skill behaves identically whether invoked standalone in any Kiro project or as part of a larger workflow. A caller that keeps its artifacts elsewhere passes its own `spec_dir`, and this skill MUST read and write there instead.

This skill is the final step in the Kiro spec workflow, after `kiro-requirements-generation` produces requirements.md and `kiro-design-generation` produces design.md.

## Usage

Use this skill when:

- requirements.md and design.md are approved for a feature
- Generating the implementation plan for Kiro IDE spec-driven development
- Creating tasks.md alongside them in `{spec_dir}`

Do NOT use when:

- Splitting features for independent engineering → use `task-decomposition`
- Requirements are not yet written → use `kiro-requirements-generation`
- Design is not yet written → use `kiro-design-generation`

## Output Format

```markdown
# Implementation Plan

- [ ] 1. Set up project structure and core interfaces
  - Create directory structure for models, services, and API components
  - Define interfaces that establish system boundaries
  - _Requirements: 1.1_

- [ ] 2. Implement core data models
  - [ ] 2.1 Create data model interfaces and types
    - Write TypeScript interfaces for all data models
    - Implement validation functions
    - _Requirements: 2.1, 3.3_
  - [ ] 2.2 Implement User model with validation
    - Write User class with validation methods
    - Create unit tests for validation
    - _Requirements: 1.2_
```

## Format Rules

- Numbered checkbox list: `- [ ] N.` for top-level, `- [ ] N.M` for sub-tasks
- Sub-tasks indented 2 spaces under their parent
- Max 2 levels of hierarchy (top-level + one sub-level)
- Each task includes: clear objective, sub-bullets with details, requirement references in italics
- Requirement references: `_Requirements: X.Y_` linking back to requirements.md
- Tasks are ONLY coding tasks. No deployment, documentation, or user testing
- Each task builds incrementally on previous tasks
- Tasks are designed for a code-generation LLM to execute one at a time

## Task Ordering

1. **Foundation.** Project structure, interfaces, shared utilities
2. **Core.** Main feature implementation (data models, services, API)
3. **Polish.** Error handling, edge cases, validation

## Execution Steps

1. Resolve `spec_dir` to the caller's value if given, otherwise the default `.kiro/specs/{feature-name}/`
2. Read requirements.md from `{spec_dir}`
3. Read design.md from `{spec_dir}`
4. Map each requirement to implementation tasks
5. Order tasks by dependency (foundation → core → polish)
6. Write tasks.md to `{spec_dir}/tasks.md`
7. Present to user for approval. If user requests changes, revise and re-present (max 2 cycles).

## Quality Gate

**CRITICAL (must fix):**

- Tasks have circular dependencies
- Missing requirement references (every task must link to at least one requirement)
- Tasks include non-coding work (deployment, documentation, user testing)
- tasks.md written anywhere other than `{spec_dir}`

**IMPORTANT (should fix):**

- Tasks too large (should be completable by an LLM in one pass)
- No clear ordering. Foundation tasks should come before core tasks
- Sub-tasks at same indentation as parent (must be indented 2 spaces)

**SUGGESTION:**

- Could identify tasks that can run in parallel
- Could add effort estimates per task
- Could group tasks into phases with headers
