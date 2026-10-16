---
name: program-planning
description: Creates program plans with timelines, milestones, dependencies, and critical path analysis. Use when starting a new program or replanning an existing one.
version: 1.0.0
tags: [skill, tpm, planning, timeline, milestones, dependencies]
---

# Program Planning

## Core Concepts

### Milestone Definition

Each milestone has: name, target date, exit criteria (measurable), owning team, and dependencies. Milestones mark phase transitions — not individual task completion. Use SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound).

### Dependency Mapping

Classify dependencies as: internal (within program), cross-team (other teams), external (vendors/partners). Each dependency has: source milestone, target milestone, type (finish-to-start, start-to-start), lead/lag time, and risk level if delayed.

### Critical Path

The longest sequence of dependent milestones determining minimum program duration. Identify float (slack) for non-critical milestones. Flag milestones with zero float as critical path items.

### Timeline Estimation

Convert T-shirt sizes to calendar ranges: XS (1-2d), S (3-5d), M (1-2w), L (3-4w), XL (5-8w). Apply buffer: 20% for well-understood work (the floor, applied to all work — there is no zero-buffer tier), 40% for novel, complex, unfamiliar, or otherwise uncertain work — the same estimation-uncertainty buffer the plan SOP's Step 5 (Estimate Timeline) applies ahead of its agentic-conversion projection. Account for holidays, on-call rotations, and team availability.

## Output Format

Generate a program plan with these sections:

1. **Program Summary** — name, objective, sponsor, TPM, start/end dates, team size
2. **Milestones Table** — columns: ID, Milestone, Owner, Target Date, Exit Criteria, Dependencies, Status
3. **Gantt-Style Timeline** — ASCII table showing milestones across weeks/months with `[====]` bars and `|` for dependencies
4. **Critical Path** — ordered list of critical path milestones with zero-float callout
5. **Dependency Map** — table: Source → Target, Type, Lag, Risk Level
6. **Resource Allocation** — team/person → workstream mapping with utilization %
7. **Risks to Plan** — top 3 schedule risks with mitigation (link to risk-management skill for full RAID)
8. **Task Management Integration** — task breakdown ready for import: task title, assignee, sprint, story points

## Quality Gate

**CRITICAL (must fix):**

- Milestones without measurable exit criteria
- Circular dependencies in the dependency map
- Critical path not identified or incorrect
- End date earlier than critical path minimum duration

**IMPORTANT (should fix):**

- No buffer applied to estimates (see Timeline Estimation above; the plan SOP's Step 5 carries the equivalent buffer, kept independent of its agentic projection)
- Dependencies missing risk assessment
- Resource over-allocation (>100% utilization)

**SUGGESTION:**

- Could add confidence levels per milestone (High/Medium/Low)
- Could identify parallel workstreams to compress timeline

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
