---
name: adr-generator
description: Use when a significant design decision surfaces while writing a design doc, when someone asks to record a decision as an ADR ("document this as an architecture decision record", "create an ADR for choosing X over Y"), or when an existing ADR lacks alternatives, consequences, or status. Produces a complete inline ADR. For PDRs, UXDRs, or guidance on writing a decision record, use decision-writing.
version: 1.0.0
tags: [skill, adr, decision, architecture, design-doc]
---

# ADR Generator

Produces a complete Architecture Decision Record (ADR) for a significant design decision, with these sections: Context, Decision, Status, Alternatives Considered, Consequences. Uses the formal ADR format defined in the `decision-writing` skill. ADRs are generated inline during design doc creation and embedded under the `## Architecture Decision Records` section.

## When to Use

- During `k-design-doc-creation.sop.md` **Phase 2** (creation) — triggered automatically for every significant design decision; Phase 3 uses this skill primarily to verify placement, not for full regeneration, but may still apply Step 1's automated fallback to fill in a still-missing Alternatives row
- Standalone: engineer asks to document a specific decision as an ADR
- When an existing ADR is incomplete (missing alternatives, consequences, or status)

A decision is **significant** if it:

- Chooses between two or more viable architectural options
- Has non-trivial cost, latency, complexity, scalability, or operability implications
- Will be difficult or expensive to reverse

## Steps

### Step 1: Gather Decision Context

Collect from the current conversation or document:

- **Decision context** — what problem triggered this decision, what constraints apply
- **Chosen option** — the option selected and the primary reason
- **Alternatives** — at least 2 alternatives with pros and cons (use `trade-off-evaluator` scores if available)
- **Status** — one of: `Proposed`, `Accepted`, `Deprecated`, `Superseded`

If alternatives are not yet documented:

- **Automated SOP workflow (e.g., invoked from `k-design-doc-creation` Phase 3 — no user interaction allowed):** infer at least one viable alternative from the decision context and available trade-off data (from `trade-off-evaluator`). Do NOT ask the engineer. If no credible alternative can be inferred, still produce an Alternatives table with the chosen option PLUS a placeholder row `| <TBD — flagged for adversarial review> | — | — | — |`, and flag the ADR for the adversarial-review phase. This ensures the Alternatives table always has ≥ 2 rows so the Quality Gate is satisfied.
- **Standalone / interactive use:** if the conversation already contains discussed alternatives, record those. If no alternatives have been explored yet, suggest 1-2 plausible alternatives and discuss them with the engineer before generating the ADR — do not silently invent alternatives the engineer never considered.

### Step 2: Generate ADR

Apply the formal ADR format from `decision-writing`:

```markdown
### ADR-N: <Title>

**Status:** Accepted

#### Context

<What situation or problem triggered this decision. What constraints apply.
One paragraph. Specific — include data where available.>

#### Decision

<The decision in one sentence. Active voice. "We will use X because Y." — state the concrete technical reason for acceptance; crisp, specific, fact-checked.>

#### Alternatives Considered

| Option            | Pros | Cons | Why Not Chosen (crisp, specific, fact-checked — 1–3 sentences)   |
| ----------------- | ---- | ---- | ---------------------------------------------------------------- |
| Option A (chosen) | ...  | ...  | — (chosen; acceptance rationale in Decision above)               |
| Option B          | ...  | ...  | <concrete technical reason: limit / latency / cost / ops burden> |
| Option C          | ...  | ...  | <concrete technical reason: limit / latency / cost / ops burden> |

_Scored trade-off matrix: see `<name>-tradeoffs.md` or inline table above._

#### Consequences

**Good:**

- <specific, measurable positive outcome>

**Bad:**

- <specific cost, risk, or constraint introduced>

**Neutral:**

- <process or tooling change with no net positive/negative>
```

### Step 3: Assign ADR Number

ADRs are numbered sequentially within the document. Check the existing `## Architecture Decision Records` section for the highest existing ADR number and increment by 1. If no ADRs exist yet, start at ADR-1. Numbers are scoped to a single document — the same ADR-N in different design docs are unrelated decisions. When cross-referencing an ADR from outside its own document, name the source document (e.g., "see ADR-3 in payments-design.md") rather than the bare number.

### Step 4: Embed in Document

Insert the ADR under the `## Architecture Decision Records` section of the design doc. If the section does not exist, create it after the Implementation Plan section.

Cross-reference the ADR from the relevant section of the design doc (e.g., in the Solution Overview where the decision is first mentioned, add: `_(See ADR-N)_`).

## Pitfalls

- **Do not generate an ADR for implementation details** — ADRs are for architectural choices, not for "which variable name to use" or "which library version to pin".
- **Do not omit alternatives** — an ADR with no alternatives is a record of a fait accompli, not a decision. Minimum 2 alternatives including the chosen option.
- **Do not use vague consequences** — "will improve performance" is not a consequence. "Expected to reduce p99 latency from 450ms to <200ms based on load test" is.
- **Status must be set** — default to `Accepted` for decisions made during creation. Use `Proposed` if the engineer has not yet confirmed the choice.

## Verification

After generating the ADR, confirm:

- ADR number is unique within the document
- Context section is specific (includes data or constraints, not just "we needed to decide")
- Decision is one sentence in active voice
- At least 2 alternatives are listed with specific pros/cons
- Consequences are split into Good / Bad / Neutral with at least one entry each
- ADR is cross-referenced from the relevant section of the design doc

## Quality Gate

The ADR passes when:

- All required sections are present: Context, Decision, Status, Alternatives Considered, Consequences
- Alternatives table has ≥ 2 rows (including the chosen option)
- No consequence is vague (no "will improve X" without a metric or qualifier)
- ADR is embedded in the document under `## Architecture Decision Records`
- **Rationale quality bar met** — every `Decision` (acceptance) and every `Why Not Chosen` cell (rejection) is crisp (1–3 sentences), technically specific (cites limits/latency/cost/ops), and fact-checked (AWS claims validated via `aws-service-validator`). See `decision-writing` ADR format for the full bar and example. Rows flagged `<TBD — flagged for adversarial review>` are exempt and deferred to the adversarial-review phase.
