---
name: k-aspect-review
description: 'Parallel n-aspect review of artifacts using subagents. Use when the user asks for an aspect or n-aspect review, or a thorough multi-angle review of a design, spec or code.'
version: 1.1.0
tags: [skill, k-aspect-review, review, subagent, parallel, quality]
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

**Aspect ideas by artifact type** (choose what fits, don't use all of these):

| Artifact              | Candidate Aspects                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Design / Architecture | feasibility, scalability, security, maintainability, operational readiness, cost efficiency, simplicity    |
| Task / Story Spec     | completeness, clarity, testability, scope accuracy, acceptance criteria quality, dependency identification |
| Code                  | correctness, readability, performance, error handling, security, idiomatic style, test coverage            |
| Written Document      | clarity, structure, data support, actionability, audience fit, conciseness                                 |
| System Spec           | completeness, consistency, feasibility, observability, failure modes, integration points                   |
| Script / Automation   | correctness, idempotency, error handling, portability, logging, edge cases                                 |

These are starting points, not a fixed menu. Tailor them to the specific artifact and context, or set them aside and define your own aspects entirely if that's what will best surface real issues. The best aspects are always the ones most likely to surface real issues for the artifact in front of you.

### 2. Spawn Parallel Subagent Reviews

Launch one subagent per aspect in a single call. Each subagent receives:

- The artifact (or a reference to it)
- Its assigned aspect with a brief, neutral definition
- Instructions to review only through that lens

**Graceful degradation.** If subagent spawning is unavailable (environment limitation, token budget, or tool unavailability), offer the user the option to review the aspects inline instead: "Parallel subagent review isn't available right now. Would you like me to work through each aspect directly instead?" If the user has asked for no questions, go inline without asking and say so in the output.

Inline review loses the isolation subagents give you, so keep it by discipline: finish one aspect before starting the next, and file each finding under the one aspect it mainly affects. When an issue touches several aspects (say a retry loop that hurts both reliability and scalability), describe it once under its main aspect and connect it to the others in the cross-cutting themes rather than repeating it in each section.

**Critical: Avoid biasing subagent results.** The orchestrator must not signal expected findings, use leading language, or share opinions about the artifact's quality.

**Prompt template for each subagent:**

```
Review the following artifact through the lens of **[ASPECT]**.

[ASPECT] means: [one-sentence neutral definition]

Artifact:
[artifact content or file reference]

References (if applicable):
[requirements, specs, conventions, API contracts, or other context
the reviewer may need to evaluate this aspect; omit if none]

Evaluate strengths and weaknesses related to [ASPECT] only.
Provide specific, actionable findings. Rate the artifact on this aspect as:
strong / adequate / needs improvement.
```

### 3. Synthesize Results

After all subagents return:

1. Present each aspect's findings grouped under its heading, with its rating. Give each finding a short ID (R1, S2) so the rest of the review can point to it.
2. Highlight cross-cutting themes that appeared in multiple aspects, citing the finding IDs.
3. Summarize with an overall assessment and prioritized action items (for example must-fix, should-fix, nice-to-have), each naming the findings it resolves.

Keep findings tied to the artifact's text and label any assumption you made. Claims about a third-party service's features, quotas, or limits that you are recalling rather than checking get marked as "verify", so the reader knows which facts the conclusion rests on.

## Core Concepts

### Why Parallel Aspects Work

A single reviewer asked to evaluate "everything" tends to anchor on the first issue found and under-explore other dimensions. Isolated aspect reviews eliminate this bias: each subagent gives full attention to its assigned dimension.

### Aspect Independence

Aspects should be as orthogonal as possible. Overlapping aspects (e.g., "readability" and "clarity") waste a subagent slot. If two aspects feel similar, merge them or sharpen their definitions.

### Unbiased Delegation

The orchestrator's job is logistics, not opinion. When framing the review for subagents, use neutral, definitional language. The subagent should arrive at its own conclusions from the artifact alone.

## Quick Reference

| Step          | Action                                                                     |
| ------------- | -------------------------------------------------------------------------- |
| Pick aspects  | Choose orthogonal dimensions suited to the artifact (typically 4-10)       |
| Spawn reviews | One subagent per aspect, single parallel call, neutral prompts             |
| Synthesize    | Group findings by aspect, surface cross-cutting themes, prioritize actions |

## Common Mistakes

### Biased Delegation

**Problem:** Orchestrator tells subagent "the error handling looks weak, review it."
**Fix:** Use neutral framing: "Review through the lens of error handling."

### Too Many Overlapping Aspects

**Problem:** Choosing "readability", "clarity", and "understandability" as separate aspects.
**Fix:** Merge overlapping concerns into a single well-defined aspect.

### Reviewing Everything in Each Aspect

**Problem:** Subagent drifts into general feedback instead of staying on its assigned aspect.
**Fix:** Explicitly instruct each subagent to evaluate only its assigned dimension.

### Skipping Synthesis

**Problem:** Dumping raw subagent outputs without integration.
**Fix:** Always synthesize: identify cross-cutting themes and produce prioritized action items.

---

## Deliberation Panel Mode (Design Context)

For a design artifact only (system design, ADR, design doc), when the review finds a decision with multiple viable options or a significant ambiguity and no clear winner, do not settle it inside the review. Name the options, give the tradeoffs and what would need verifying, and offer the user two choices:

1. Decide directly and tell us the preference.
2. Convene a deliberation panel (about 2-3 minutes, roughly 2-3 times the cost of a standard 4-aspect review) that derives axes for this decision, argues each, and returns a scored recommendation.

Convene the panel only when the user picks option 2, using the `deliberation-panel` skill's "Offering the Panel from a Host Skill" section with `decision_domain=design`. If that skill isn't available, offer to reason through the tradeoff together instead. When the user asked for no questions, write the offer into the review as an open decision rather than asking it. You can note which option the evidence leans toward, but keep the decision open: no final pick and no action item that assumes one.

The rest of the artifact gets the standard aspects. Other artifacts use the standard aspects only.
