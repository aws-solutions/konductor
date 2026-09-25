---
name: asdlc-aspect-review
description: Use when the user asks for an "aspect review", "n-aspect review", or "multi-aspect review", or wants a design, spec, code change, or other artifact reviewed thoroughly from several angles at once. Runs one subagent per aspect in parallel.
version: 1.0.0
tags: [skill, aspect-review, review, subagent, parallel, quality]
---

# Aspect Review

## Overview

An aspect review decomposes artifact evaluation into independent dimensions (aspects) and reviews them in parallel using subagents. Each subagent focuses on exactly one aspect, producing a focused critique free from cross-concern dilution. The orchestrator then synthesizes findings into a unified review.

## Usage

When users need to:

- Review a design document, task spec, system spec, code, script, or other artifact
- Get thorough multi-dimensional feedback on generated output
- Validate an artifact before sharing or implementing it

**Concrete triggers:**

- "do an aspect review"
- "n-aspect review on this"
- "review this from multiple angles"
- "4-aspect review" / "8-aspect review"
- "review this thoroughly" / "give me a detailed review"

## Instructions

### 1. Select Aspects

Choose aspects appropriate to the artifact type. The user may specify aspects, a count, or leave it to your judgment. Default to 4 aspects for a focused review or 8 for a comprehensive one.

**Aspect ideas by artifact type** (choose what fits — don't use all of these):

| Artifact              | Candidate Aspects                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Design / Architecture | feasibility, scalability, security, maintainability, operational readiness, cost efficiency, simplicity    |
| Task / Story Spec     | completeness, clarity, testability, scope accuracy, acceptance criteria quality, dependency identification |
| Code                  | correctness, readability, performance, error handling, security, idiomatic style, test coverage            |
| Written Document      | clarity, structure, data support, actionability, audience fit, conciseness                                 |
| System Spec           | completeness, consistency, feasibility, observability, failure modes, integration points                   |
| Script / Automation   | correctness, idempotency, error handling, portability, logging, edge cases                                 |

These are starting points, not a fixed menu — tailor them to the specific artifact and context, or set them aside and define your own aspects entirely if that's what will best surface real issues. The best aspects are always the ones most likely to surface real issues for the artifact in front of you.

### 2. Spawn Parallel Subagent Reviews

Launch one subagent per aspect in a single call. Each subagent receives:

- The artifact (or a reference to it)
- Its assigned aspect with a brief, neutral definition
- Instructions to review only through that lens

**Graceful degradation.** If subagent spawning is unavailable in the current environment (environment limitation, token budget, or tool unavailability), offer the user the option to review the aspects inline instead: "Parallel subagent review isn't available right now — would you like me to work through each aspect directly instead?"

**Critical: Avoid biasing subagent results.** The orchestrator must not signal expected findings, use leading language, or share opinions about the artifact's quality.

**Prompt template for each subagent:**

```
Review the following artifact through the lens of **[ASPECT]**.

[ASPECT] means: [one-sentence neutral definition]

Artifact:
[artifact content or file reference]

References (if applicable):
[requirements, specs, conventions, API contracts, or other context
the reviewer may need to evaluate this aspect — omit if none]

Evaluate strengths and weaknesses related to [ASPECT] only.
Provide specific, actionable findings. Rate the artifact on this aspect as:
strong / adequate / needs improvement.
```

### 3. Synthesize Results

After all subagents return:

1. Present each aspect's findings grouped under its heading
2. Highlight cross-cutting themes that appeared in multiple aspects
3. Summarize with an overall assessment and prioritized action items

## Core Concepts

### Why Parallel Aspects Work

A single reviewer asked to evaluate "everything" tends to anchor on the first issue found and under-explore other dimensions. Isolated aspect reviews eliminate this bias — each subagent gives full attention to its assigned dimension.

### Aspect Independence

Aspects should be as orthogonal as possible. Overlapping aspects (e.g., "readability" and "clarity") waste a subagent slot. If two aspects feel similar, merge them or sharpen their definitions.

### Unbiased Delegation

The orchestrator's job is logistics, not opinion. When framing the review for subagents, use neutral, definitional language. The subagent should arrive at its own conclusions from the artifact alone.

## Quick Reference

| Step          | Action                                                                     |
| ------------- | -------------------------------------------------------------------------- |
| Pick aspects  | Choose orthogonal dimensions suited to the artifact (typically 4–10)       |
| Spawn reviews | One subagent per aspect, single parallel call, neutral prompts             |
| Synthesize    | Group findings by aspect, surface cross-cutting themes, prioritize actions |

## Common Mistakes

### Biased Delegation

**Problem:** Orchestrator tells subagent "the error handling looks weak — review it."
**Fix:** Use neutral framing: "Review through the lens of error handling."

### Too Many Overlapping Aspects

**Problem:** Choosing "readability", "clarity", and "understandability" as separate aspects.
**Fix:** Merge overlapping concerns into a single well-defined aspect.

### Reviewing Everything in Each Aspect

**Problem:** Subagent drifts into general feedback instead of staying on its assigned aspect.
**Fix:** Explicitly instruct each subagent to evaluate only its assigned dimension.

### Skipping Synthesis

**Problem:** Dumping raw subagent outputs without integration.
**Fix:** Always synthesize — identify cross-cutting themes and produce prioritized action items.

---

## Deliberation Panel Mode (Design Context)

Deliberation panel mode invokes a decision-specific, axis-derived deliberation structure that applies when reviewing a design artifact with multiple viable options or significant ambiguity. It is **always user-confirmed** — it never activates automatically.

### When Deliberation Panel Mode Applies

Deliberation panel mode is available **only for design artifacts** (system designs, architecture decision records, design documents). Code reviews, scripts, task specs, written documents, and any non-design artifact use the standard user-chosen-aspects mechanism above, unchanged.

### Trigger: User-Confirmed Only

After reviewing a design artifact normally, if the review surfaces **multiple viable options** or **a significant ambiguity** — a decision where no clear winner emerges — present the following offer to the user before proceeding:

```
I found a decision with multiple viable options / an ambiguity — convene a
deliberation panel, or decide directly?

  1. Answer directly (share your preference and we will continue)
  2. Convene a deliberation panel (~2–3 minutes) — the panel derives a
     small set of axes specific to this decision, argues each
     independently, cross-examines the arguments, and returns a scored
     recommendation

Note: panel size scales with the decision (typically 3–6 derived axes) —
roughly 2–3 times the cost of a standard 4-aspect review.
```

Do **not** convene the panel unless the user explicitly selects option 2. If the user decides directly, incorporate their decision and continue with the standard aspect-review synthesis.

**Once-per guard:** Offer the panel at most once per review session per topic. If a subsequent tradeoff or ambiguity is detected in the same session for the same artifact, use a lighter re-prompt instead: "I found another decision point — same treatment?" Do not re-present the full cost/time disclosure.

### Delegation to Deliberation Panel

When the user opts in, invoke the `deliberation-panel` skill with:

- `decision_domain=design`
- `stance=evaluative`
- `consent_confirmed=true` (the user's opt-in above satisfies the panel's own consent gate — pass it through explicitly)

Pass the specific tradeoff or ambiguity as the subject. The panel derives its own axes for this decision (Phase 0), argues each independently (Phase 1), cross-examines them anonymously (Phase 2), and returns a Decision Scorecard with an axis-weighted confidence level (Phase 3). Present that scorecard to the user.

The `deliberation-panel` skill owns axis derivation, per-axis advocacy, anonymous cross-examination, and the scorecard synthesis, including its own Axis-Weighted Convergence confidence calibration. See the `deliberation-panel` skill for the full mechanism and the HIGH/MEDIUM/LOW thresholds.

### Scope of Deliberation Panel Mode

- Non-design artifacts (code, scripts, written docs, task plans) use the **standard user-chosen-aspects mechanism** and are **unaffected** by deliberation panel mode.
- Deliberation panel mode applies to the **specific tradeoff or ambiguity** detected, not to the entire artifact — the rest of the artifact is reviewed using the standard mechanism.
- After the panel's scorecard is presented, the user decides; the aspect-review synthesis incorporates their decision.
