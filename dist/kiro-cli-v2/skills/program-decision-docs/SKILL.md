---
name: program-decision-docs
description: Creates program-level decision documents with options analysis, trade-offs, and recommendations. Use when a program decision needs formal documentation.
version: 1.0.0
tags: [skill, tpm, decision, options-analysis, trade-offs]
---

# Program Decision Docs


## Core Concepts

### Decision Context

Every decision doc starts with: what decision is needed, why now (trigger/urgency), who are the stakeholders, what constraints exist (budget, timeline, compliance), and what happens if no decision is made (default outcome).

### Options Analysis

Each option has: description, pros, cons, effort estimate (T-shirt size), risk level (High/Medium/Low), and alignment with program goals. Include a "do nothing" option as baseline. Minimum 2 options, maximum 5.

### Weighted Evaluation Matrix

Define criteria (e.g., cost, time-to-market, scalability, risk, team capability). Assign weights (must sum to 100%). Score each option per criterion (1-5). Calculate weighted score. Highest score = recommended option unless overriding factors exist.

### Decision Record

After decision is made, record: decision date, decision maker(s), option selected, rationale (why this over alternatives), dissenting opinions (if any), revisit conditions (what would trigger reconsideration), and expiry date (when to review regardless).

## Output Format

1. **Decision Title & Status** — Draft / Under Review / Decided / Superseded
2. **Context** — background, trigger, constraints, default outcome
3. **Stakeholders** — decision maker, consulted, informed (DACI model)
4. **Options Table** — columns: Option, Description, Pros, Cons, Effort, Risk
5. **Evaluation Matrix** — columns: Criteria, Weight, Option A Score, Option B Score, ... Weighted Totals
6. **Recommendation** — recommended option with rationale (2-3 sentences)
7. **Decision Record** — date, decision maker, selected option, dissent, revisit conditions

## Quality Gate

**CRITICAL (must fix):**

- No "do nothing" baseline option
- Evaluation criteria weights don't sum to 100%
- Decision record missing decision maker or date
- Recommendation contradicts evaluation matrix without stated rationale

**IMPORTANT (should fix):**

- Fewer than 2 options analyzed
- Pros/cons missing for any option
- No revisit conditions defined
- Stakeholders not identified (DACI)

**SUGGESTION:**

- Could add cost comparison table for options with budget impact
- Could link decision to program milestones affected

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
