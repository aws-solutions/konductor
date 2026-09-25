---
name: socratic-elicitation
description: 'Use when a request leaves information, assumptions, or trade-offs unstated and work has not started yet, or when the user wants a plan they already hold stress-tested. Asks Socratic questions in two modes: A (intake, before work) and B (challenge, applied to a plan rather than a finished artifact).'
version: 1.0.0
tags: [skill, elicitation, requirements, intake, challenge, socratic, pre-planning]
---

# Socratic Elicitation

## Overview

Socratic Elicitation surfaces what is missing, ambiguous, or assumed BEFORE work begins (Mode A), or stress-tests a plan the user already holds before any artifact exists to review (Mode B). It works through one focused question at a time, waits for the answer, and lets each answer determine whether to follow up or move on — never a fixed script read start to finish.

This is a conversation with the human, not an evaluation of a document. If a finished artifact already exists, evaluate it with `asdlc-aspect-review` instead of running this skill against the human who wrote it.

Both modes draw on the same underlying discipline: [Socratic questioning](https://en.wikipedia.org/wiki/Socratic_questioning), a public method of directed inquiry with six recognized question categories — clarification, probing assumptions, probing evidence/reasons, probing implications, examining alternative viewpoints, and questioning the question itself. Mode A and Mode B apply that discipline to two different situations.

---

## Mode A: Intake Elicitation (pre-work)

**Purpose:** Surface missing functional requirements, unstated constraints, unvalidated assumptions, missing non-functional requirements, conflicting stakeholder needs, and unclear scope boundaries — BEFORE drafting or implementing anything.

**Triggers:**

- User says "ask me questions first", "what am I missing?", "help me think this through before we start"
- Pre-planning analysis detects Collaborative intent at Medium or Low confidence
- Pre-planning analysis detects Architecture intent at Low confidence
- Anti-pattern detected: Assumption Cascade or Scope Creep
- k-design-doc-creation Phase 1 invokes this skill (default path for all new design docs)

**Question dimensions (generate questions from these areas):**

| Dimension                                | What to surface                                                    | Stakeholder tag |
| ----------------------------------------- | ------------------------------------------------------------------- | --------------- |
| Business value and success metrics        | What does success look like? Who benefits and how?                  | `[PM]`           |
| Technical feasibility and dependencies     | What are the hard technical constraints? What must already exist?   | `[SDE]`          |
| Timeline and cross-team coordination       | When does this need to ship? What teams are involved?                | `[TPM]`          |
| Auth, data protection, threat surface      | What is sensitive? Who should NOT have access?                       | `[Security]`     |
| Observability, failure modes, deployment   | How will this fail? How will we know it is broken?                   | `[Ops]`          |

**Stakeholder tags** are advisory — they signal WHY a question matters (e.g., `[Security]` tells the user this is a security-relevant question). They are not prescriptive.

---

## Mode B: Challenge Mode (plan not yet an artifact)

**Purpose:** Stress-test an idea, plan, or decision the user already holds, while it still exists only as an intention — before it has become a document or a design an evaluator could review. If a completed artifact exists, use `asdlc-aspect-review` instead.

**Triggers:**

- User says "challenge this", "poke holes in this", "stress-test this idea", "what could go wrong?"
- User says "argue against my own plan before I commit to it"

**Question categories** (draw fresh questions from these, do not reuse the same wording twice in one session):

| Category                       | Purpose                                                        | Example shape                                                          |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Clarification                   | Force the plan into one unambiguous sentence                     | "Can you restate the outcome you expect, in a single sentence?"           |
| Probing assumptions              | Surface load-bearing beliefs that haven't been checked            | "What would have to be true for this to work that you haven't verified?"  |
| Probing evidence and reasons      | Ask what actually supports the chosen path                       | "What evidence points you toward this option over the others?"            |
| Probing implications              | Trace consequences forward, including for people not in the room  | "If this goes exactly as planned, what changes for whoever depends on it?" |
| Alternative viewpoints            | Introduce a perspective the plan hasn't accounted for             | "Who would push back on this, and what would their objection be?"        |
| Questioning the question          | Check whether this is even the right decision to be making now    | "Is this the decision that matters most right now, or is something else?" |

---

## Stopping Conditions

This skill stops as soon as ANY of these is true:

| Condition                 | Default        | Notes                                 |
| -------------------------- | --------------- | --------------------------------------- |
| Max questions reached       | 10 (standard)    | Range: 5–15 per `elicitation_depth`     |
| Max questions per branch    | 3                | Prevents rabbit-holing on one topic      |
| Max turns reached           | 15               | Hard budget cap — summarize and exit     |
| Early exit signal            | —                | Always respected immediately             |

**`elicitation_depth` mapping** (honors the parameter directly — do not map to a different internal parameter):

| `elicitation_depth` | Max questions |
| --------------------- | -------------- |
| `quick`                | 5              |
| `standard`             | 10 (default)   |
| `deep`                 | 15             |

**Early exit signals** (always honored immediately, with no follow-up question):

- "enough"
- "proceed"
- "skip"
- "just do it"
- "I'm satisfied"
- "move on"

---

## Question Cadence

**Default: sequential.** Ask one question at a time. Wait for the user's answer before asking the next. This allows follow-up depth and prevents information overload.

**Batch escape:** When the user signals time pressure ("just give me the list", "batch these", "I'm in a hurry"), switch to batch mode: present 3–4 questions per round. Return to sequential if the user engages deeply with one question.

---

## Escalation to Deliberation Panel

When this skill reaches an unresolved ambiguity or a significant tradeoff where:

- The user's answer reveals 2+ viable paths with non-trivial trade-offs, AND
- No clear winner emerges from the user's stated preference

this skill OFFERS (never auto-runs) a deliberation panel. Present the offer with a cost/time note:

```
I've identified a significant tradeoff:

  [Option A]: <description> — favors <dimension>
  [Option B]: <description> — favors <dimension>
  [Option C]: <description> (if applicable)

How would you like to proceed?

  1. Answer directly (tell me your preference and we'll keep going)
  2. Convene a deliberation panel (~2-3 minutes) — independent
     perspectives derived from this specific tradeoff's own axes
     argue it out, then an arbiter synthesizes a confidence-scored
     recommendation
```

**When the user opts in:**

1. This skill pauses its question sequence.
2. Invoke the `deliberation-panel` skill directly with `decision_domain` inferred from context (default `general-tradeoff`), `stance=evaluative`, and `consent_confirmed=true` (the user's opt-in above satisfies the panel's consent gate — pass it through explicitly rather than making the panel ask again). Pass the specific tradeoff as the subject.
3. Present the panel's recommendation to the user.
4. Resume elicitation with the user's decision incorporated into the requirements summary.

**Rules:**

- Offer the panel at MOST once per session per topic. Subsequent tradeoffs get a lighter prompt: "I found another tradeoff — same treatment?"
- Never auto-run the panel without the user's explicit opt-in.
- If the `deliberation-panel` skill is not available in the current environment, offer the user the option to think it through together instead: "I found a significant tradeoff — would you like to reason through it together, or decide directly?"

---

## Output

Each mode concludes with its own summary shape — Mode A produces a Requirements Summary, Mode B produces a Challenge Summary. Do NOT proceed to drafting/implementation (Mode A) or to acting on the plan (Mode B) without presenting the summary for the mode that was run. If no early-exit signal was given, also confirm with the user that the summary is complete before proceeding. If an early-exit signal was given, skip the confirmation and proceed directly -- per Stopping Conditions, early-exit signals are honored immediately with no follow-up question.

### Mode A Output: Requirements Summary

When Mode A concludes (max questions reached, early exit, or user satisfied), produce a brief requirements summary:

```markdown
## Requirements Confirmed

### Functional Requirements

- [Extracted from answers]

### Constraints

- [Extracted from answers]

### Non-Functional Requirements

- [Extracted from answers]

### Open Items (unresolved)

- [Anything not answered — flag for user attention]
```

### Mode B Output: Challenge Summary

Mode B stress-tests a plan rather than gathering requirements, so its summary is challenge-shaped, not intake-shaped. When Mode B concludes (max questions reached, early exit, or user satisfied), produce a brief challenge summary:

```markdown
## Plan Challenged

### Challenged Assumptions

- [Load-bearing beliefs surfaced as unverified — from probing-assumptions questions]

### Surfaced Risks

- [Weaknesses, failure modes, or objections surfaced from probing-implications and alternative-viewpoints questions]

### Unresolved Tradeoffs

- [Tradeoffs the user's answers did not resolve to a clear winner — see Escalation to Deliberation Panel]

### Open Items (unresolved)

- [Anything not answered — flag for user attention]
```

---

## Quality Gate

**CRITICAL (must fix before proceeding):**

- Asking more than `elicitation_depth` questions total
- Asking more than 3 questions on the same branch
- Not honoring an early exit signal
- Producing a summary that omits answers the user gave
- Asking multiple questions simultaneously in sequential mode

**IMPORTANT (should fix):**

- Questions that have clear answers in the already-provided context
- Redundant questions covering the same ground
- Questions biased toward a particular answer

**SUGGESTION:**

- Could tag questions with stakeholder class where not obvious
- Could group summary into categories matching stakeholder tags
