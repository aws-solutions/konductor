---
name: decision-writing
description: How to write effective decision records — structure, tone, alternatives framing, consequence articulation, and Amazon writing tenets for data-driven, specific, and actionable decisions
---

# Decision Writing

## Overview

Decision records are permanent artifacts. Six months from now, someone will read your record to understand why a choice was made. Write for that future reader.

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

Architecture Decision Records use a five-section structure. The `adr-generator` skill produces ADRs in this format automatically during design doc creation.

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

- Status must be set. Default to `Accepted` for decisions made during creation; `Proposed` if not yet confirmed.
- Minimum 2 alternatives including the chosen option. No straw men — each alternative must be genuinely viable.
- Consequences must be specific. "Will improve performance" is not a consequence. "Expected to reduce p99 latency from 450ms to <200ms" is.
- Number ADRs sequentially within the document (ADR-1, ADR-2, …). Cross-reference from the section where the decision is first mentioned: `_(See ADR-N)_`.
- Include architecture diagrams (Mermaid supported) when the decision involves a topology change.
- Reference related ADRs by ID when decisions are interdependent.
- Describe integration points with other systems.
- Consider operational impact (monitoring, on-call, deployment).

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
