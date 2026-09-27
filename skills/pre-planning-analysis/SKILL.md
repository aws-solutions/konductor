---
name: pre-planning-analysis
description: Use when a request is ambiguous and it is unclear which skill or SOP should handle it. Classifies the intent into one of 6 types, surfaces ambiguities, bounds the scope, and recommends a procedure chain.
version: 1.0.0
tags: [skill, pre-planning, analysis, intent-classification, scope, orchestration]
---

# Pre-Planning Analysis

## Overview

Provides a structured framework for analyzing ambiguous requests before selecting skills and SOPs. Classifies the work intent, identifies ambiguities and AI failure risks, bounds scope, and recommends which procedures to run.

## Usage

Use this skill when:

- You cannot determine which skill or SOP handles a request
- A request spans multiple SDLC phases and needs decomposition
- The request is vague and needs scope bounding before execution

Do NOT use when:

- The request clearly maps to one skill or SOP (e.g., "write user stories" → `user-story-writing`, "design the system" → `system-design-patterns`)
- The user just needs a clarifying question: ask it directly instead

## Phase 0: Intent Classification

Classify the request into one of 6 types:

| Intent                 | Signals                                  | Primary Focus                                        |
| ---------------------- | ---------------------------------------- | ---------------------------------------------------- |
| **Refactoring**        | "refactor", "restructure", "clean up"    | SAFETY: regression prevention, behavior preservation |
| **Build from Scratch** | "create new", "add feature", greenfield  | DISCOVERY: explore patterns first                    |
| **Mid-sized Task**     | Scoped feature, specific deliverable     | GUARDRAILS: exact deliverables, explicit exclusions  |
| **Collaborative**      | "help me plan", "let's figure out"       | INTERACTIVE: incremental clarity through dialogue    |
| **Architecture**       | "how should we structure", system design | STRATEGIC: long-term impact, architect involvement   |
| **Research**           | Investigation needed, path unclear       | INVESTIGATION: exit criteria, time bounds            |

## Phase 1: Intent-Specific Analysis

### Refactoring

Questions: What behavior must be preserved? Rollback strategy? Propagation scope? Hidden dependencies?
Directives: Pre-refactor verification, verify after EACH change, document preserved behavior. Do NOT combine with feature changes.
Run: the applicable implementation skill

### Build from Scratch

Questions: Similar existing code? Codebase conventions? Existing utilities? Testing strategy?
Directives: Research patterns BEFORE implementation, reference specific files, define "done" criteria. Do NOT invent new patterns.
Run: `user-story-writing` for a new product, or the applicable implementation skill for a new module

### Mid-sized Task

Questions: Exact deliverables? Explicit exclusions? Assumptions? Verification criteria?
Directives: List deliverables and exclusions explicitly, define acceptance criteria per deliverable. Do NOT expand scope.
Run: the applicable implementation skill

### Collaborative

Questions: Most important thing to get right? Timeline? Constraints? Options vs recommendation?
Directives: Present choices at decision points, confirm understanding, break into checkpoints. Do NOT make major decisions without user input.
Run: `socratic-elicitation` when the domain or decision remains unclear

### Architecture

Questions: Long-term implications? Optimizing for what? Constraints? Alternatives considered?
Directives: Run `system-design-patterns` or `architecture-advisor`, and document trade-offs. Do NOT optimize prematurely.
Run: `system-design-patterns` for a full design or `architecture-advisor` for a focused recommendation

### Research

Questions: Specific question to answer? "Good enough" criteria? Time budget? What to do with findings?
Directives: Define exit criteria, set time bounds, specify output format. Do NOT research indefinitely.
Run: `external-research` for external sources or `k-context-gathering` for codebase and mixed-source investigation

## Phase 2: Anti-Pattern Detection

Flag these common AI failure patterns:

| Pattern                | Signal                              | Action                         |
| ---------------------- | ----------------------------------- | ------------------------------ |
| Over-engineering       | Adding features not requested       | Ask: "Is X actually needed?"   |
| Scope Creep            | Vague boundaries that grow          | Enforce explicit exclusions    |
| Assumption Cascade     | Building on unvalidated assumptions | Validate assumptions first     |
| Premature Optimization | Optimizing before it works          | Focus on "working" first       |
| Analysis Paralysis     | Researching forever                 | Set time bounds, exit criteria |
| Hero Syndrome          | Trying to do everything             | Decompose with `task-decomposition` |

## Escalation to Socratic Elicitation

If this analysis produces any of the following, invoke the `socratic-elicitation` skill (Mode A: Intake) directly, before presenting Phase 3 output to the user:

- Intent classified as **Collaborative** at Medium or Low confidence
- Intent classified as **Architecture** at Low confidence
- An anti-pattern of **Assumption Cascade** or **Scope Creep** flagged in Phase 2

Run the `socratic-elicitation` skill's Mode A intake questioning to resolve the triggering ambiguity, and incorporate the resulting requirements summary into the Key Ambiguities and Questions for User sections below before recommending an agent chain.

## Phase 3: Output Format

```markdown
## PRE-PLANNING ANALYSIS

### Intent Classification

- **Type**: [Refactoring | Build from Scratch | Mid-sized Task | Collaborative | Architecture | Research]
- **Confidence**: [High | Medium | Low]
- **Rationale**: [Why this classification]

### Key Ambiguities

1. [What's unclear and why it matters]

### Questions for User (if any)

> [Question — what we need to know and why]

### Recommended Procedure Chain

1. [skill or SOP] → [Purpose]
2. [skill or SOP] → [Purpose]

### Scope Boundaries

- **IN SCOPE**: [Explicit list]
- **OUT OF SCOPE**: [Explicit list]
- **DEFERRED**: [Things to do later]
```

## Quality Gate

**CRITICAL (must fix):**

- No intent classification provided
- Scope boundaries missing (no IN/OUT distinction)
- Recommended procedure chain references skills or SOPs that do not exist

**IMPORTANT (should fix):**

- Low confidence classification without questions to resolve ambiguity
- Assumptions not documented
- Anti-patterns not checked

**SUGGESTION:**

- Could identify parallel execution opportunities in the procedure chain
- Could estimate effort per phase
