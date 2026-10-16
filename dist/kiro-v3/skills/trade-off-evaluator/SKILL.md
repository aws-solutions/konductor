---
name: trade-off-evaluator
description: 'Scores design trade-offs across five dimensions — cost, latency, complexity, scalability, operability — producing a structured comparison matrix and a recommendation. Use when a design decision has multiple options, when an engineer asks to evaluate trade-offs, or when the k-design-doc-creation SOP reaches its trade-off evaluation step. Trigger phrases — "evaluate the trade-offs between X and Y", "score these options", "which is better: SQS or EventBridge for this use case", "compare these alternatives".'
version: 1.0.0
tags: [skill, design, trade-offs, evaluation, decision, architecture]
---

# Trade-Off Evaluator

Produces a scored comparison matrix for design decisions with multiple options. Each option is scored 1–5 across five dimensions. Outputs a recommendation with rationale and per-option risks.

## When to Use

- During `k-design-doc-creation.sop.md` Phase 3 — runs automatically for each significant decision
- Standalone: engineer asks to compare options for a specific decision
- When an ADR's Alternatives table needs scored backing

## Scoring Rubric

Score each option 1–5 per dimension. Higher is better.

| Dimension       | 1 (Poor)                                       | 3 (Acceptable)                               | 5 (Excellent)                                       |
| --------------- | ---------------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| **Cost**        | Significantly more expensive than alternatives | Comparable cost to alternatives              | Lowest cost or best cost/value ratio                |
| **Latency**     | Adds >100ms or introduces synchronous blocking | Adds <50ms or acceptable async delay         | Minimal latency impact; sub-10ms or fully async     |
| **Complexity**  | Requires new expertise, significant new infra  | Familiar patterns, moderate operational load | Simple, uses existing patterns and tooling          |
| **Scalability** | Hard ceiling or requires manual intervention   | Scales with effort (e.g., shard management)  | Auto-scales to 10× current load without changes     |
| **Operability** | New failure modes, no existing runbooks        | Manageable with runbook updates              | Existing monitoring, runbooks, and on-call coverage |

## Steps

### Step 1: Identify Decision and Options

Extract from context:

- **Decision context** — what problem is being solved, what constraints apply
- **Options** — at least 2, at most 5; each with a name and brief description
- **Dimensions** — default to all five; omit a dimension only if it is genuinely not applicable (state why)

### Step 2: Score Each Option

For each option × dimension pair:

1. Reason about the score based on the decision context and known service characteristics
2. Assign a score 1–5
3. Write a one-line justification

Do not assign scores from memory alone for AWS service characteristics — cross-reference with `aws-service-validator` findings. When `aws-service-validator` is not used, you MUST note the assumption explicitly.

### Step 3: Produce Comparison Table

```markdown
## Trade-Off Analysis: <Decision Title>

| Option   | Cost | Latency | Complexity | Scalability | Operability | Total |
| -------- | ---- | ------- | ---------- | ----------- | ----------- | ----- |
| Option A | 4    | 3       | 5          | 4           | 4           | 20    |
| Option B | 3    | 5       | 3          | 5           | 3           | 19    |
| Option C | 5    | 2       | 2          | 3           | 2           | 14    |

**Scores:** 1 = poor, 5 = excellent. Higher total = better overall fit.
```

### Step 4: Recommendation and Risks

After the table, provide:

```markdown
**Recommendation:** Option A — highest operability and complexity scores align with the team's
existing Lambda + DynamoDB expertise. Latency score of 3 is acceptable given the async processing
requirement.

**Risks per option:**

- **Option A:** Cost increases at >10k events/min; monitor with CloudWatch billing alarms.
- **Option B:** Latency advantage disappears under fan-out scenarios; test at 5× peak load.
- **Option C:** Complexity score of 2 reflects no existing team expertise; budget 2-week ramp-up.
```

### Step 5: Write Report

Write the full trade-off report to `docs/design/<name>-tradeoffs.md`. If called during the creation SOP, embed the table in the relevant ADR's Alternatives section.

## Pitfalls

- **Do not score from memory for AWS service characteristics** — use `aws-service-validator` or note the assumption explicitly.
- **Do not omit a dimension without stating why** — "not applicable" must be justified.
- **Do not recommend the option with the highest total if context overrides it** — a hard constraint (e.g., "must be synchronous") can disqualify an option regardless of score.
- **Avoid straw-manning** — every option must be scored fairly; a score of 1 requires a specific justification.

## Verification

After producing the report, confirm:

- Every option has a score for every applicable dimension
- Every score has a one-line justification (inline or in a notes section)
- The recommendation references the scores explicitly
- Risks are specific, not generic ("may be slower" is not a risk; "adds ~80ms per hop under fan-out" is)

## Quality Gate

The trade-off evaluation passes when:

- At least 2 options are scored
- All five dimensions are addressed (or explicitly excluded with justification)
- The recommendation names the chosen option and references at least 2 dimension scores
- The report is written to `docs/design/<name>-tradeoffs.md` or embedded in the ADR
