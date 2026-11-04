---
name: decision-writing
description: Use when drafting or reviewing a decision record (ADR, PDR, or UXDR), and to generate a complete inline ADR (Context, Decision, Status, Alternatives, Consequences) for a significant design decision during design doc creation. Covers structure, tone, alternatives framing, consequence articulation, and plain-writing tenets for data-driven, specific, and actionable decisions. Trigger phrases include "generate an ADR for this decision", "document this as an architecture decision record", and "create an ADR for choosing X over Y".
version: 1.1.0
tags: [skill, adr, decision, architecture, design-doc, writing]
---

# Decision Writing

## Overview

Decision records are permanent artifacts. Six months from now, someone will read your record to understand why a choice was made. Write for that future reader.

## Usage

Use this skill when drafting a decision record from scratch, when reviewing an existing one for structure and tone, or when generating an inline ADR during design doc creation (see ADR Mode). Applies to ADR, PDR, and UXDR formats. The shared structure and language guidelines below hold across all three, with format-specific notes in Template-Specific Guidance.

## The One-Sentence Test

Every decision record must contain one sentence that states the decision. If you cannot state the decision in one sentence, you have not decided yet.

Good: "We will use PostgreSQL as the primary datastore for the order service."
Bad: "We discussed several database options and decided to go with a relational approach."

## Context Section

The context sets the stage. A reader unfamiliar with the topic should understand the situation after reading this section.

Include:

- What system or process is affected
- What problem exists (be specific — "API latency exceeds p99 SLA of 200ms" not "API is slow")
- Why this needs to be addressed now
- Constraints: timeline, budget, team size, technical limitations

Exclude:

- Judgment about which option is better (save for the decision)
- Implementation details (save for after the decision)
- Vague problem statements without data

## Alternatives Section

Present at least 2-3 genuine alternatives. The hallmark of a weak decision record is alternatives that are obviously inferior (straw men).

For each alternative:

1. **Describe it fairly** — someone who advocates for this option should recognize it
2. **State its strengths** — every viable alternative has genuine strengths
3. **State its weaknesses** — be specific, with data where possible
4. **Explain why it was not chosen** — the rationale must be evidence-based

### Avoid Straw-Manning

Bad: "Option 2: Use MongoDB. MongoDB is a NoSQL database that lacks ACID transactions and would be inappropriate for financial data."

Good: "Option 2: Use MongoDB. Document model aligns well with our varied order schemas and would reduce ORM complexity. However, our team has no MongoDB operational experience (0 of 6 engineers), and our data access patterns require multi-document transactions that MongoDB added in v4.0 but are still less mature than PostgreSQL's implementation (see [benchmark link])."

## Consequences Section

Consequences describe what changes as a result of the decision. Organize into Good, Bad, and Neutral.

### Be Specific and Measurable

Bad: "This will improve performance."
Good: "Expected to reduce p99 API latency from 450ms to under 200ms based on load testing of the prototype (see appendix)."

Bad: "Team needs to learn new technology."
Good: "3 of 6 engineers need PostgreSQL training (~2 weeks ramp-up based on prior TypeScript migration timeline)."

### Don't Forget Neutral Consequences

Neutral consequences are process and tooling changes that are neither good nor bad:

- "CI/CD pipeline needs a new PostgreSQL test stage"
- "On-call runbook needs updating for new failure modes"
- "Monitoring dashboards need new database metrics"

## Data and Evidence

Every quantitative claim needs a source. Every qualitative claim needs supporting reasoning.

### Metrics Must Be Precise

Bad: "We increased throughput significantly."
Good: "Throughput increased from 1,200 to 3,400 requests/second under identical load conditions (see load test report [link])."

### Always Include Baselines

Bad: "Latency improved by 40%."
Good: "Latency improved by 40%, from 450ms p99 to 270ms p99 (measured over 7 days in gamma, [dashboard link])."

### Cite Your Sources

Every link you include should:

1. Actually resolve (check before including)
2. Support the specific claim you are making
3. Be described so the reader knows what they will find

## Language Guidelines

### Use Active Voice

Bad: "It was decided that PostgreSQL would be used."
Good: "We will use PostgreSQL."

### Avoid Vague Quantifiers

Replace with data or remove entirely:

| Vague                   | Better                        |
| ----------------------- | ----------------------------- |
| many teams              | 12 teams (per [source])       |
| significant improvement | 40% improvement (from X to Y) |
| recently                | in Q3 2025                    |
| often                   | in 7 of 10 observed cases     |
| some concerns           | 3 specific concerns: [list]   |

### Be Direct

Bad: "After careful consideration of the various options available, we have determined that it would be most beneficial to proceed with Option A."
Good: "We chose Option A because [reason]."

## Template-Specific Guidance

### ADR Format

Architecture Decision Records use a five-section structure. ADR Mode below produces ADRs in this format during design doc creation.

```markdown
### ADR-N: <Title>

**Status:** Accepted | Proposed | Deprecated | Superseded by ADR-M

#### Context

What situation or problem triggered this decision. What constraints apply.
One paragraph. Specific — include data where available (latency targets, team size, timeline).

#### Decision

We will use X because Y. (One sentence. Active voice. State the concrete technical reason for acceptance — crisp, specific, fact-checked.)

#### Alternatives Considered

| Option            | Pros | Cons | Why Not Chosen (crisp, specific, fact-checked — 1–3 sentences)   |
| ----------------- | ---- | ---- | ---------------------------------------------------------------- |
| Option A (chosen) | ...  | ...  | — (chosen; acceptance rationale in Decision above)               |
| Option B          | ...  | ...  | <concrete technical reason: limit / latency / cost / ops burden> |

_Scored trade-off matrix: see `<name>-tradeoffs.md` or inline table above._

#### Consequences

**Good:**

- <specific, measurable positive outcome>

**Bad:**

- <specific cost, risk, or constraint introduced>

**Neutral:**

- <process or tooling change — neither good nor bad>
```

**Rationale quality bar** — applies to every `Decision` (why accepted) and every `Why Not Chosen` cell (why rejected):

- **Crisp and simple** — one to three sentences per option; no filler or hedging.
- **Technically accurate and specific** — cite the concrete technical reason: limits, latency, cost, consistency model, throughput, or operational burden. Not vague generalities.
- **Fact-checked** — any AWS service/feature claim MUST be validated via the `aws-service-validator` skill before it is written. Never assert an unverified capability as the basis for a decision.

> Weak: "DynamoDB scales better." Strong: "DynamoDB sustains our projected 50k writes/s at p99 <5ms without table-level locking; RDS Aurora peaks at ~10k writes/s on db.r6g.2xlarge under the same load test (verified via `aws-service-validator`)."

**ADR authoring rules:**

- Status must be set. Default to `Accepted` for decisions made during creation; `Proposed` if the engineer has not yet confirmed the choice.
- Minimum 2 alternatives including the chosen option. No straw men — each alternative must be genuinely viable. An ADR with no alternatives records a fait accompli, not a decision.
- Consequences must be specific. "Will improve performance" is not a consequence. "Expected to reduce p99 latency from 450ms to <200ms based on load test" is.
- Write ADRs for architectural choices only, not implementation details such as a variable name or a pinned library version.
- Number ADRs sequentially within the document (ADR-1, ADR-2, …). Cross-reference from the section where the decision is first mentioned: `_(See ADR-N)_`.
- Include architecture diagrams (Mermaid supported) when the decision involves a topology change.
- Reference related ADRs by ID when decisions are interdependent.
- Describe integration points with other systems.
- Consider operational impact (monitoring, on-call, deployment).

### ADR Mode

Generates a complete ADR inline in a design doc, in the ADR Format above. Use it:

- During `k-design-doc-creation` Phase 2 (creation), for every significant design decision. Phase 3 uses it mainly to verify placement, not to regenerate, but may still apply the no-interaction fallback in step 1 to fill a still-missing Alternatives row.
- Standalone, when an engineer asks to document a specific decision as an ADR.
- When an existing ADR is incomplete (missing alternatives, consequences, or status).

A decision is **significant** if it chooses between two or more viable architectural options, has non-trivial cost, latency, complexity, scalability, or operability implications, or will be difficult or expensive to reverse.

1. **Gather the decision context** from the conversation or document: the problem and constraints, the chosen option and its primary reason, at least 2 alternatives with pros and cons (use `trade-off-evaluator` scores if available), and the status (`Proposed`, `Accepted`, `Deprecated`, or `Superseded`). If alternatives are not yet documented:
   - **Automated SOP run (no user interaction allowed, e.g. `k-design-doc-creation` Phase 3):** infer at least one viable alternative from the decision context and any `trade-off-evaluator` data. Do not ask the engineer. If no credible alternative can be inferred, still produce an Alternatives table with the chosen option plus a placeholder row `| <TBD — flagged for adversarial review> | — | — | — |`, and flag the ADR for the adversarial-review phase. The table then always has at least 2 rows.
   - **Standalone or interactive use:** record alternatives already discussed in the conversation. If none have been explored, suggest 1-2 plausible alternatives and discuss them with the engineer before writing the ADR. Do not silently invent alternatives the engineer never considered.
2. **Write the ADR** in the ADR Format above.
3. **Assign the number.** Find the highest ADR number under the document's `## Architecture Decision Records` section and add 1; start at ADR-1 if there are none. Numbers are scoped to one document, so the same ADR-N in two design docs are unrelated decisions. When citing an ADR from another document, name the source (e.g. "see ADR-3 in payments-design.md"), not the bare number.
4. **Embed it** under the `## Architecture Decision Records` section of the design doc. If that section does not exist, create it after the Implementation Plan section. Cross-reference the ADR from the section where the decision is first mentioned (e.g. in the Solution Overview add `_(See ADR-N)_`).

**Verification.** After writing the ADR, confirm:

- The ADR number is unique within the document
- Context is specific (includes data or constraints, not just "we needed to decide")
- Decision is one sentence in active voice
- At least 2 alternatives are listed with specific pros and cons
- Consequences are split into Good, Bad, and Neutral with at least one entry each
- The ADR is cross-referenced from the relevant section of the design doc

**Quality gate.** The ADR passes when:

- All required sections are present: Context, Decision, Status, Alternatives Considered, Consequences
- The Alternatives table has at least 2 rows, including the chosen option
- No consequence is vague (no "will improve X" without a metric or qualifier)
- The ADR is embedded under `## Architecture Decision Records`
- The rationale quality bar above is met for every `Decision` and every `Why Not Chosen` cell. Rows marked `<TBD — flagged for adversarial review>` are exempt and deferred to the adversarial-review phase.

### PDR Tips

- Lead with customer impact
- Include success metrics with targets
- Address pricing/cost implications
- Reference competitive landscape with sources

### UXDR Tips

- Include mockups or wireframe references
- Address accessibility (WCAG compliance)
- Reference user research findings with participant counts
- Consider responsive/cross-platform implications
