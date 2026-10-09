---
name: plan-review
description: Use when an implementation plan, task breakdown, or work breakdown should be checked before execution starts. Rates it 1-5 stars on clarity, verifiability, context completeness, and big picture, with a BLOCKED, OKAY, or SHIP IT verdict.
version: 1.0.0
tags: [skill, review, plan, quality-gate, evaluation, tpm]
---

# Plan Review

## Overview

Evaluates work plans with a critical eye, catching gaps, ambiguities, and missing context that would block implementation. Produces a 1-5 star rating with actionable feedback.

## Usage

Use this skill when:

- Reviewing an implementation plan before greenlighting execution
- Evaluating a task breakdown from `task-decomposition`
- Assessing a feature plan for completeness
- Running a quality gate on any work plan

Do NOT use when:

- Reviewing design quality → use `design-evaluation`
- Reviewing code → use `backend-review`, `frontend-review`, or `code-review`
- Reviewing test strategy → use `test-coverage-analysis`

## Core Principle

**You are a REVIEWER, not a DESIGNER.** The implementation direction in the plan is NOT NEGOTIABLE. Evaluate whether the plan documents that direction clearly enough to execute. Do NOT evaluate whether the direction itself is correct.

## 4 Evaluation Criteria

### 1. CLARITY

> Does each task specify WHERE to find implementation details?

**Pass**: Task references specific files, patterns, or examples
**Fail**: Task says "implement X" without pointing to reference code

Checklist:

- Each task has specific file paths or patterns to follow
- References to existing code include line numbers or function names
- Technical terms are defined or exemplified
- No vague words like "appropriate", "similar", "etc."

### 2. VERIFICATION

> Are acceptance criteria concrete and measurable?

**Pass**: "Test passes: `your test command`" or "Build succeeds: `your build command`"
**Fail**: "Authentication should work correctly"

Checklist:

- Each task has explicit pass/fail criteria
- Commands to verify are specified (not "run tests")
- Expected outputs are described
- Edge cases have verification steps

### 3. CONTEXT COMPLETENESS

> Less than 10% guesswork required?

**Pass**: Plan provides all information needed to implement
**Fail**: Implementer must make assumptions or research

Checklist:

- Dependencies and constraints are listed
- Related files that might need changes are identified
- Potential conflicts or side effects are noted
- All required context is in the plan or referenced

### 4. BIG PICTURE

> Clear purpose, background, and task flow?

**Pass**: Reader understands WHY this work matters and HOW tasks connect
**Fail**: Tasks are isolated steps without coherent narrative

Checklist:

- Purpose/objective is stated upfront
- Tasks flow logically from one to the next
- Parallel execution opportunities are identified
- Critical path is clear

## File Verification

When a plan references files, VERIFY they exist:

1. Check if path exists (`ls <path>`)
2. Check if referenced content exists (`grep -n "pattern" <path>`)
3. Note any discrepancies in the review

Red Flags:

- References to files that don't exist
- References to functions/classes not found in the file
- Outdated file paths (renamed/moved files)

## What to Reject

Reject plans that have ANY of these issues:

| Issue                   | Example                      | Why It's Blocking           |
| ----------------------- | ---------------------------- | --------------------------- |
| Vague tasks             | "Implement the feature"      | No guidance on HOW          |
| No acceptance criteria  | "Make sure it works"         | No way to verify completion |
| Missing file references | "Update the config"          | Which config? Where?        |
| Undefined terms         | "Use the standard pattern"   | What standard? Show me.     |
| Hand-wavy scope         | "Handle edge cases"          | Which ones? All of them?    |
| No context              | Task list with no background | Why are we doing this?      |
| Circular references     | "See task 3" → "See task 1"  | Infinite loop               |

## Review Workflow

1. Read the full plan. Don't start reviewing until you've read everything
2. Score each of the 4 criteria. Go through checklists, note issues with task numbers
3. Verify file references. Check that referenced files and patterns exist
4. Identify blocking issues. Distinguish "nice to have" from "must fix"
5. Calculate overall rating using the scoring formula
6. Write verdict using the appropriate format (OKAY or BLOCKED)

## Rating System

| Rating     | Verdict | Meaning                                           |
| ---------- | ------- | ------------------------------------------------- |
| ⭐         | BLOCKED | Unusable, fundamental gaps prevent any progress  |
| ⭐⭐       | BLOCKED | Major revision needed, multiple critical gaps    |
| ⭐⭐⭐     | OKAY    | Workable but risky, several unclear areas        |
| ⭐⭐⭐⭐   | OKAY    | Good plan with minor issues                       |
| ⭐⭐⭐⭐⭐ | SHIP IT | Clear, verifiable, complete, ready for execution |

### Scoring

Each criterion scores as **Pass** (fully met), **Partial** (some items met, some gaps), or **Fail** (not met).

- 4 Pass = ⭐⭐⭐⭐⭐
- 3 Pass, 1 Partial = ⭐⭐⭐⭐
- 2-3 Pass = ⭐⭐⭐
- 1 Pass = ⭐⭐
- 0 Pass = ⭐

## Verdict Format

### OKAY Verdicts (⭐⭐⭐+)

```
## VERDICT: OKAY ⭐⭐⭐⭐
### Summary — [1-2 sentence assessment]
### Strengths — [what the plan does well]
### Concerns — [issues to watch during implementation]
### Suggestions — [optional improvements]
```

### BLOCKED Verdicts (⭐-⭐⭐)

```
## VERDICT: BLOCKED ⭐⭐
### Summary — [why blocked]
### Blocking Issues
1. [CRITICAL] [issue] — What's wrong: ... What's needed: ...
### Must Fix Before Proceeding — [checklist]
```

## Quality Gate

**CRITICAL (must fix):**

- Review skips any of the 4 criteria
- No star rating or verdict provided
- Verdict contradicts the criteria scores (e.g., all Pass but rated ⭐⭐)

**IMPORTANT (should fix):**

- File references not verified
- Blocking issues lack specific fix instructions
- No distinction between blocking and non-blocking concerns

**SUGGESTION:**

- Could verify more file references
- Could suggest parallel execution opportunities
