---
name: adversarial-design-review
description: Use when someone wants the decisions, trade-offs, or architecture of a design document challenged rather than proofread ("adversarial design review", "challenge my design", "devil's advocate on this design doc", "review design decisions"). Works on design doc sections, not code diffs, and classifies findings as CRITICAL, IMPORTANT, or MINOR. For writing and structure, use design-doc-guidelines.
version: 1.0.0
tags: [skill, design, adversarial, review, architecture, checker]
---

# Adversarial Design Review

## Overview

Takes an adversarial stance against every major design decision, trade-off, and architectural choice in a design document. Unlike `adversarial-code-review` (which operates on code diffs), this skill operates on design doc sections.

Use `argumentation-reference` skill during this review to identify logical fallacies in decision justifications.

## When to Use

- `k-design-doc-creation.sop.md` Phase 4 (adversarial review loop)
- `k-principal-engineer-design-review.sop.md` Step 3 (adversarial review loop)
- Engineer explicitly requests adversarial review of a design doc

## Core Concepts

### Classification

**CRITICAL (architectural):**

- Wrong architecture choice for the stated requirements (e.g., synchronous design for a stated async requirement)
- Missing security boundary (no auth, no encryption at rest/transit where PII is involved)
- Fundamental scalability flaw (design cannot meet stated NFRs at stated load)
- Single point of failure with no stated mitigation

**CRITICAL (factual):**

- Incorrect technical claim about a service or technology (e.g., wrong service limit, nonexistent feature)
- Contradictory requirements (two requirements that cannot both be satisfied)

**IMPORTANT:**

- Weak or missing justification for a significant decision (no alternatives considered, no trade-off)
- Missing alternative in a decision that has obvious alternatives
- Incomplete trade-off (dimensions missing: cost, latency, complexity, scalability, operability)
- Logical fallacy in a decision justification (use `argumentation-reference` to identify)
- Unstated assumption that materially affects the design

**MINOR:**

- Style or clarity issue in a decision section
- Minor omission (e.g., missing consequence in an ADR)
- Weak rebuttal acknowledgment

### Fallacy Checking

For each decision justification, load `argumentation-reference` and check:

- Is the warrant explicit? (Does the evidence actually support the claim?)
- Is there a false dichotomy? (Are only two options presented when more exist?)
- Is there circular reasoning? (Does the justification restate the claim?)
- Is there an appeal to authority without evidence?

Flag any identified fallacy as IMPORTANT with the fallacy name and the affected section.

## Review Checklist

### Architecture Choices

- [ ] Each major choice has at least two alternatives considered
- [ ] The chosen option is justified against stated requirements (not just preference)
- [ ] Security boundaries are explicit (auth, encryption, network isolation)
- [ ] Scalability path is stated for 10× current load

### Trade-offs

- [ ] Each decision includes a trade-off across ≥3 dimensions
- [ ] Cost implications are addressed
- [ ] Operational complexity is addressed

### Assumptions

- [ ] All load/traffic assumptions are stated and sourced
- [ ] All external dependency assumptions are stated
- [ ] Failure modes are identified for each external dependency

### Logical Soundness

- [ ] No circular reasoning in justifications
- [ ] No false dichotomies in option selection
- [ ] No unsupported quantitative claims

## Steps

1. **Parse sections.** Identify all design decision sections, ADRs, trade-off tables, and architecture choice paragraphs.

2. **Deliberation Panel Confirmation Gate.** Before invoking the panel, present the cost estimate and obtain explicit user opt-in. Per the `deliberation-panel` skill's consent contract, the caller (this skill) is responsible for setting `consent_confirmed` explicitly. The panel will not infer consent on its own.

   > Panel-enhanced adversarial review is available for this document: axes derived from this document's own decisions and tradeoffs each challenge every parsed decision in adversarial stance, followed by an anonymous cross-examination round and an arbiter synthesis. Cost: roughly 2–3 minutes, scaling with the number of derived axes (typically 3–6).
   >
   > 1. Convene the deliberation panel (recommended for high-stakes designs)
   > 2. Proceed without the panel: apply the Classification and Fallacy Checking sections above directly, single-voice
   - If the user opts in, proceed to Step 3 with `consent_confirmed=true`.
   - If the user declines or gives no confirmation, skip the panel entirely: apply the Classification and Fallacy Checking sections (above) directly to each decision from Step 1. Evaluate each justification against the Toulmin model, flag fallacies via `argumentation-reference`, and classify findings directly using the Classification table (CRITICAL architectural/factual, IMPORTANT, MINOR). Then skip to Step 6 (Architecture stress test).

3. **Adversarial Panel: Axis-Derived Challenge** (panel path only, per Step 2). Invoke the `deliberation-panel` skill with `decision_domain=design, stance=adversarial, consent_confirmed=true`. Pass the parsed design decisions and tradeoffs as the subject. The panel derives 3–6 axes specific to this document's decisions (Phase 0), then runs the adversarial challenge per axis (Phase 1: each axis argues why the currently-favored option fails on that axis), the anonymous cross-examination round (Phase 2), and the arbiter synthesis (Phase 3).

   Each axis applies the Toulmin model (claim → data → warrant); the `argumentation-reference` skill is available to identify fallacies in decision justifications within each axis's analysis.

4. **Anonymous Cross-Examination** (panel path only). Handled internally by the `deliberation-panel` skill's Phase 2. Each axis-advocate reviews every other axis's challenges for logical soundness and blind spots without knowing which axis produced each finding, and must produce a weakness-or-corroboration pair per argument reviewed.

5. **Arbiter Mapping** (panel path only). Map the panel's axis-weighted confidence output to the severity classification below.

   Confidence is the `deliberation-panel` skill's own Axis-Weighted Convergence output (`stance=adversarial`). This skill does not define a separate scale, only reinterprets what convergence means in the adversarial stance: "the same option" that axes converge on is agreement that the currently-favored option fails. See `deliberation-panel`'s Axis-Weighted Convergence table for the HIGH/MEDIUM/LOW thresholds themselves.

   **Severity mapping (panel path only; the single-voice path classifies via the Classification table in Step 2, not this mapping):**
   - HIGH-confidence architectural flaw → **CRITICAL (architectural)**
   - HIGH-confidence factual claim error → **CRITICAL (factual)**
   - MEDIUM-confidence architectural or factual flaw → **IMPORTANT** (not yet corroborated enough for CRITICAL, but too load-bearing to leave unclassified)
   - HIGH or MEDIUM-confidence justification gap or logical fallacy → **IMPORTANT**
   - LOW-confidence or stylistic observation → **MINOR**

6. **Architecture stress test.** For the overall design:
   - Does it meet every stated NFR at stated load?
   - Are all security boundaries present?
   - Is there a single point of failure without mitigation?

7. **Output findings.** For each finding:

   ```
   [SEVERITY] Section — {heading}
   Challenge: {the adversarial challenge}
   Axis/axes: {which derived axis/axes surfaced this — or "single-voice" if the panel was declined in Step 2}
   Confidence: HIGH | MEDIUM | LOW — corroboration strength, not a severity gate (single-voice: MEDIUM for a clear Toulmin warrant, LOW for a weak/speculative warrant — HIGH requires multi-axis corroboration and is unavailable when the panel is declined)
   Rebuttal needed: {what the author must address}
   Fallacy (if any): {fallacy name from argumentation-reference}
   ```

8. **Summary.** Report: N CRITICAL (architectural), N CRITICAL (factual), N IMPORTANT, N MINOR. Include axis attribution for all CRITICAL findings (or note "single-voice review, panel declined" if applicable).

## Quality Gate

**CRITICAL findings require immediate resolution.** The document does not advance to PE review with any CRITICAL finding present.

**Exit condition for pe-review loop:** 0 CRITICAL + 0 IMPORTANT + fewer than 3 MINOR findings.

Present findings as: CRITICAL (architectural) → CRITICAL (factual) → IMPORTANT → MINOR.
