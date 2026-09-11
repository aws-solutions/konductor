---
name: deliberation-panel
description: Multi-perspective deliberation for high-stakes, multi-option decisions. Derives a small set of decision-specific axes directly from the tradeoff at hand, argues each axis independently, cross-examines the arguments anonymously, and synthesizes a scored recommendation. Requires an explicit consent_confirmed flag before running — it is not free.
version: 1.0.0
tags:
  [skill, deliberation, tradeoff, decision, design, research, viability, panel]
---

# Deliberation Panel

## Overview

Deliberation Panel is a structured decision-support mechanism for high-stakes, multi-option choices. Rather than running every decision through the same fixed set of named reviewer personas, it first asks what actually matters for _this_ decision, derives a small panel of perspectives from those axes, has each argue its case, cross-examines the arguments without revealing who made them, and closes with a scored recommendation rather than a prose verdict.

This is **artifact-facing deliberation** — it operates on a described tradeoff or decision, not on a human. It is not a substitute for eliciting information from a person (use `socratic-elicitation` for that).

---

## Consent Gate

**This is not free: expect roughly 2–3 minutes and a handful of subagent calls, scaling with the number of derived axes (typically 3–6).**

The skill takes an explicit `consent_confirmed` parameter (see below) precisely so that "has the user agreed to pay this cost" is never a guess. There is exactly one path:

1. If `consent_confirmed` is `false` or omitted: STOP after Phase 0 (Axis Derivation) and present the derived axis count plus the cost estimate to the user. Do not proceed to Phase 1 until the caller re-invokes with `consent_confirmed=true`.
2. If `consent_confirmed` is `true`: the caller has already obtained consent (either the end user said yes directly, or an upstream skill like `socratic-elicitation` relayed an in-conversation opt-in) — proceed straight through Phases 0–3 without pausing again.

There is no second, implicit "re-confirm if invoked directly" path. Whoever invokes this skill — the user, `socratic-elicitation`, or `asdlc-aspect-review` — sets `consent_confirmed` explicitly and is responsible for what they pass. The skill itself never infers consent from conversational tone.

---

## Parameters

| Parameter           | Values                                                                          | Default      | Required |
| ------------------- | ------------------------------------------------------------------------------- | ------------ | -------- |
| `consent_confirmed` | `true` \| `false`                                                               | `false`      | no       |
| `decision_domain`   | `design` \| `research-options` \| `viability-feasibility` \| `general-tradeoff` | (required)   | yes      |
| `stance`            | `evaluative` \| `adversarial`                                                   | `evaluative` | no       |

### `decision_domain` Descriptions

| Domain                  | When to use                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `design`                | Architectural decisions, design alternatives, system structure choices                               |
| `research-options`      | Competing research approaches, investigative paths, information-gathering strategies                 |
| `viability-feasibility` | "Can we build / should we build this?" — technical feasibility, market viability, organizational fit |
| `general-tradeoff`      | Any multi-option comparison that does not fit a more specific domain                                 |

### `stance` Descriptions

| Stance        | Each axis-advocate's job                                | When to use                                                             |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `evaluative`  | Argue its axis's strongest case for the best-fit option | Balanced deliberation; surfacing the strongest option across dimensions |
| `adversarial` | Argue why the currently-leading option fails its axis   | Stress-testing a leading option before committing to it                 |

---

## Flow

Unlike a fixed reviewer roster, the number and identity of perspectives are derived anew for every decision. A decision about caching strategy and a decision about vendor selection will not produce the same panel.

### Phase 0 — Axis Derivation

Before assigning any perspective, identify the 3–6 dimensions that actually distinguish the options in _this_ decision. Read the decision/tradeoff description and extract axes — e.g., a database choice might yield `cost`, `operational-burden`, `team-familiarity`, `scaling-headroom`; a vendor choice might yield `total-cost-of-ownership`, `lock-in-risk`, `support-quality`. Do not reuse a fixed list across decisions — re-derive every time.

Output of this phase: an ordered list of 3–6 named axes, each with a one-sentence definition of what it measures for this specific decision. This list is shown to the user at the consent gate (Phase 0 runs even before consent, since it is cheap — a single pass, not a subagent fan-out — and the axis count determines the cost estimate the user is consenting to).

### Phase 1 — Per-Axis Advocacy

Once `consent_confirmed=true`, spawn one subagent per derived axis, in parallel. Each receives:

- The decision/tradeoff description (exact subject passed by the caller)
- Its assigned axis name and the one-sentence definition derived in Phase 0
- The active `decision_domain` and `stance`
- Instructions to argue strictly from its axis — which option best serves this axis, and why

**Prompt template for each axis subagent:**

```
You are advocating for the following decision through the axis of **[AXIS NAME]**.

[AXIS NAME] measures, for this decision: [one-sentence definition derived in Phase 0]

Decision / tradeoff:
[tradeoff description or artifact content]

Domain: [decision_domain]
Stance: [evaluative | adversarial]

[If adversarial:] Argue why the option currently favored fails on this axis specifically. Do not soften the case for balance.
[If evaluative:] Argue which option best serves this axis and why. Acknowledge the strongest case against your own conclusion in one sentence.

Focus strictly on the [AXIS NAME] axis. Do not reason from other axes.
Provide:
1. Your recommended option for this axis
2. Your strongest supporting reason
3. The one thing that would change your recommendation
```

### Phase 2 — Anonymous Cross-Examination

After all axis-advocates return, run a second parallel round. Each advocate reviews every _other_ advocate's output — anonymized, with axis names stripped, presented only as "Argument A", "Argument B", etc. Each cross-examiner must produce exactly two things: one specific weakness in another argument, and one point where it independently reaches the same conclusion as its own axis. This differs from a generic peer-review pass — it forces a concrete rebuttal-or-corroboration output per argument reviewed, not a free-form critique.

### Phase 3 — Arbiter Synthesis

A single arbiter pass consumes Phase 1's per-axis arguments and Phase 2's cross-examination, and produces the **Decision Scorecard** (see Output Format). The arbiter does not introduce new arguments — it only aggregates and scores what the axes and cross-examination surfaced.

---

## Confidence: Axis-Weighted Convergence

Because the number of axes varies per decision (never a fixed 5), confidence is computed as a **proportion of axes converging**, not a fixed headcount threshold:

| Level      | Meaning                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| **HIGH**   | ≥75% of derived axes recommend the same option, AND no cross-examination rebuttal against it stands unaddressed        |
| **MEDIUM** | 50–74% of axes converge, OR ≥75% converge but with at least one unresolved (non-structural) cross-examination rebuttal |
| **LOW**    | <50% of axes converge, OR cross-examination surfaced a structural flaw that no axis addressed                          |

This is deliberately proportional rather than count-based: a 4-axis decision with 3 axes agreeing (75%) and a 6-axis decision with 5 axes agreeing (83%) are both HIGH, even though the raw counts differ — what matters is the share of the panel that was actually derived for this decision, not an absolute number carried over from some other decision's panel size.

---

## Output Format: Decision Scorecard

The arbiter's synthesis is the panel's final output — a scorecard, not a six-part narrative:

```
## Deliberation Panel — Decision Scorecard

**Decision reviewed:** [brief restatement of the tradeoff]
**Domain:** [decision_domain] | **Stance:** [stance] | **Axes derived:** [N]

| Axis            | Recommends       | Confidence contribution                  |
| ---------------- | ------------------ | ------------------------------------------- |
| [axis 1 name]      | [option]             | [supports / contests overall convergence]     |
| [axis 2 name]      | [option]             | [supports / contests overall convergence]     |
| ...               | ...                 | ...                                          |

**Overall recommendation:** [option] — **Confidence: [HIGH/MEDIUM/LOW]** ([X] of [N] axes converged)

### Unresolved cross-examination rebuttals
[Any rebuttal from Phase 2 that was not addressed by the arbiter — surfaced explicitly rather than absorbed silently]

### What would change this recommendation
[The single most decision-changing fact identified across all axes, drawn from Phase 1's "what would change your recommendation" answers]
```

---

## Rules

- **Consent is explicit, not inferred.** See Consent Gate — `consent_confirmed` is the only signal this skill acts on.
- **Axes are re-derived every invocation.** Never carry over a prior decision's axis list, and never default to a fixed named roster regardless of domain.
- **Once-per-session-per-topic guard (when called from `socratic-elicitation` or `asdlc-aspect-review`).** The host skill enforces this guard; the panel itself does not duplicate it.
- **Graceful degradation.** If the panel cannot spawn the subagents Phase 1/2 require (environment limitation, token budget, or tool unavailability), offer the user the option to deliberate inline instead: "A full deliberation panel isn't available right now — would you like to reason through the axes together directly?"
- **Parameter contract is fixed.** `decision_domain`, `stance`, and `consent_confirmed` must not be renamed or aliased by callers.

---

## Quality Gate

**CRITICAL:**

- Panel proceeds past Phase 0 without `consent_confirmed=true`
- Confidence computed as a fixed headcount instead of a proportion of derived axes
- An axis-advocate's output shown to another advocate before the cross-examination phase (breaks independence)
- Parameter names renamed by callers

**IMPORTANT:**

- Fewer than 3 or more than 6 axes derived (signals the decision wasn't decomposed carefully, or was over-decomposed)
- Cross-examination skips the required weakness-or-corroboration pair for any argument
- Scorecard omits the "what would change this recommendation" line

**SUGGESTION:**

- Could persist derived axes alongside the decision record for future related decisions to reference
- Could flag when two decisions in the same session derive near-identical axis sets, as a signal the two decisions may actually be one decision
