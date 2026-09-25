---
name: task-decomposition
description: 'Use when a feature or its design has to be divided into pieces of work for a team: breaking it down, splitting it, decomposing it, or allocating it across engineers, whether or not the skill is named, typically after the system design (HLD) is complete and before Kiro spec generation. Produces independent features that individual engineers can build with minimal overlap.'
version: 1.0.0
tags: [skill, feature-splitting, task-decomposition, planning, agile]
---

# Task Decomposition (Feature Splitting)

## Overview

Takes user stories and system design / HLD and splits them into independent features scoped for individual engineers. The goal is to minimize overlap and dependency between team members so each engineer can work on their feature track independently.

This skill sits between Design and Kiro Spec Generation in the SDLC. One HLD fans out into multiple independent feature tracks, each going through its own Kiro spec workflow.

## Usage

Use this skill when:

- The request says "break down," "split," or "decompose" a feature/project into (implementation) tasks. This phrasing means produce the Feature Split format below, NOT a generic layer-by-layer technical breakdown (e.g. Data Model → Backend → API Contract → Frontend → Cross-cutting), even when the skill isn't named explicitly
- System design / HLD is approved and ready for implementation planning
- Breaking a project into independent feature tracks for a team
- Scoping work so each engineer can work with minimal coordination

Do NOT use when:

- Generating Kiro IDE tasks.md for a single feature → use `kiro-task-generation`
- Writing requirements.md → use `kiro-requirements-generation`
- Writing design.md → use `kiro-design-generation`

## Splitting Criteria

Each split feature should:

1. **Be independently implementable**: one engineer can complete it without blocking on others
2. **Have clear boundaries**: well-defined inputs, outputs, and interfaces
3. **Map to user stories**: traceable back to one or more user stories
4. **Be testable in isolation**: can be verified without other features being complete
5. **Minimize shared state**: avoid features that read/write the same data concurrently

## Output Format

```markdown
# Feature Split: [Project Name]

## Feature 1: [Feature Name]

- **Scope**: [What this feature covers]
- **User Stories**: [US-1, US-3, US-7]
- **Key Components**: [API endpoints, data models, services involved]
- **Dependencies**: [External dependencies or shared interfaces]
- **Engineer**: [Assigned or TBD]

## Feature 2: [Feature Name]

- **Scope**: [What this feature covers]
- **User Stories**: [US-2, US-4, US-5]
- **Key Components**: [API endpoints, data models, services involved]
- **Dependencies**: [External dependencies or shared interfaces]
- **Engineer**: [Assigned or TBD]

## Shared Interfaces

- [Interface 1]: Used by Feature 1 and Feature 2 — define first
- [Interface 2]: Used by Feature 2 and Feature 3 — define first
```

## Execution

1. Read user stories and system design / HLD from the paths supplied by the caller
2. Identify natural feature boundaries (by domain, by API surface, by data ownership)
3. Check for overlap. If two features touch the same data model or API, consider merging or defining a shared interface
4. Produce the feature split with scope, user story mapping, and dependencies
5. Present to user for approval

## Quality Gate

**CRITICAL (must fix):**

- Features have circular dependencies
- A feature requires another feature to be complete before it can start (tight coupling)
- User stories are missing from the split (every story must map to a feature)

**IMPORTANT (should fix):**

- More than 2 features share the same data model (consider a shared-interfaces feature)
- A feature is too large (>2 weeks of work for one engineer)
- A feature is too small (<2 days of work; consider merging)

**SUGGESTION:**

- Could identify a "foundation" feature that defines shared interfaces first
- Could estimate effort per feature
- Could suggest implementation order based on dependencies
