---
name: design-impact-review
description: Use when changing a data model, API schema, system interface, or other design-level decision, before the change cascades into other artifacts. Traces the downstream impact (for example DB column to API to UX) and classifies each affected artifact BREAKING, STALE, or UNAFFECTED.
version: 2.1.0
tags: [skill, design, review, impact, deviation]
---

# Design Impact Review

## What this skill is

A reasoning method, not an automated gate. It gives you a structured way to
answer one question: _"What else does this change touch?"_ Agents tend to make a
local change, such as adding a database column or altering a response shape, and
continue without re-evaluating the artifacts that depend on it. Applying this
method forces that re-evaluation.

## When to apply it

Apply it whenever you change a data model, API contract, schema, system
interface, or any design-level decision, or when you are about to deviate from
a design doc or requirement. The developer agent's prompt directs it to pause
and run this analysis before such a change; you can also invoke it on your own.
It is guidance the agent applies by judgment, not a hook that fires on every
file write.

## Artifact Dependency Map

```text
User Story / Requirement
  ├── System Design (HLD)
  │     ├── Threat Model
  │     ├── API Schema / Contracts
  │     │     ├── Data Model
  │     │     └── UX / FE Design
  │     └── Non-Functional Requirements
  └── Test Strategy
```

A change at any node can affect its descendants and may require reassessing
siblings and parents.

## Procedure

### Step 1 — Identify the change's origin layer

| Layer          | Examples                                                           |
| -------------- | ------------------------------------------------------------------ |
| Requirement    | User story modified, acceptance criteria changed, scope adjusted   |
| System Design  | New component, changed interaction pattern, altered sequence flow  |
| API / Contract | New endpoint, modified request/response shape, changed auth model  |
| Data Model     | New entity, changed relationship, added/removed field, type change |
| UX / FE        | New screen, changed flow, altered component hierarchy              |
| Threat Model   | New trust boundary, changed data classification, new threat vector |
| Implementation | Class refactor, module split, dependency change, pattern deviation |

### Step 2 — Trace impact

Using the dependency map, list every artifact the change may affect:

| Change at      | Re-assess                                                         |
| -------------- | ----------------------------------------------------------------- |
| Requirement    | All of them: system design, UX, threat model, API, data model, tests |
| System Design  | Threat model, API, data model, UX, NFRs, tests                    |
| API / Contract | UX (consumer), data model, tests, threat model (new surface)      |
| Data Model     | API (exposure), threat model (data sensitivity), tests            |
| UX / FE        | Requirements (still aligned?), API (new endpoints needed?)        |
| Threat Model   | System design (new controls), implementation (mitigations)        |
| Implementation | API (if interface changed), data model (if schema altered), tests |

### Step 3 — Classify each impacted artifact

| Severity   | Meaning                                                   |
| ---------- | --------------------------------------------------------- |
| BREAKING   | Assumptions are invalidated; the artifact must be updated |
| STALE      | Inconsistent but still functional; drift will accumulate  |
| UNAFFECTED | No impact                                                 |

### Step 4 — Report

```text
## Design Impact Review

**Change:** <one line: what is changing>
**Origin layer:** <requirement | system design | API | data model | UX | threat model | implementation>
**Reason:** <why>

### Impact Assessment

| Artifact      | Status     | Impact                | Action                      |
| ------------- | ---------- | --------------------- | --------------------------- |
| System Design | BREAKING   | <what's invalidated>  | Revise before proceeding    |
| Threat Model  | STALE      | <what's inconsistent> | Update before merge         |
| API Schema    | UNAFFECTED | —                     | —                           |
| Data Model    | BREAKING   | <what changed>        | Revise before proceeding    |
| UX / FE       | STALE      | <what's inconsistent> | Update before merge         |
| Test Strategy | STALE      | <new coverage needed> | Update before merge         |
| Requirements  | UNAFFECTED | —                     | —                           |

### Recommendation

<one of:>
- BREAKING IMPACTS (N): surface these to the user before continuing; involve the
  architect for design-artifact updates and the product owner for requirement
  changes. Do not silently proceed past a breaking impact.
- STALE ONLY (N): inform the user, propose tracking the updates as follow-ups,
  and ask whether to proceed.
- CONTAINED: impact is limited to the implementation layer; record the rationale
  and continue.
```

> This skill reports and recommends; it does not enforce. The decision to stop,
> update artifacts, or proceed rests with the user.

## Anti-patterns this method catches

- Adding a data-model field and breaking API-contract assumptions.
- Refactoring classes without checking threat-model boundaries.
- Changing a UX flow the API does not yet support.
- Deviating from the spec without reviewing upstream impact.
- A "small" change that cascades into design-level inconsistency.

## When to skip

- Purely cosmetic changes (rename, formatting, comments).
- Bug fixes that restore the original design intent (conforming, not deviating).
- Changes the user has explicitly authorized this session with full scope
  awareness.
