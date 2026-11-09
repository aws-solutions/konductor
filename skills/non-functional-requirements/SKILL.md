---
name: non-functional-requirements
description: Extracts measurable non-functional requirements from system design documents. Use when a requirements or design document needs measurable latency, throughput, availability, scalability, security or observability targets. Applies when writing or reviewing one, even if the request just says 'requirements' or 'design'.
version: 1.1.0
tags: [skill, nfr, requirements, performance, availability, security, architecture]
---

# Non-Functional Requirements

## Execution

When this skill is activated, apply the following directly:

Extract NFRs from the provided system design document across these categories:

- Performance: targets per operation type. Interactive reads and writes get p50/p99 latency and requests/second. Async jobs (exports, reports) get a time-to-complete percentile. Batch runs get a completion deadline with timezone and a required throughput
- Availability: uptime target (e.g., 99.9%), RTO, RPO
- Security: authentication method, encryption standards, compliance requirements mapped to the named standard's specific requirements
- Scalability: min/max instance counts, scale-out and scale-in thresholds for each scaled component
- Observability: required metrics, log retention, trace sampling rate
- Cost: monthly budget target, cost per 1,000 transactions (or per unit of work, such as per statement)

All NFRs must be measurable, with no vague terms ("fast", "reliable", "secure"). Give each one a how-measured entry: the metric, test or audit that proves it.

When the design does not give a number, pick a reasonable value and tag it inline at the target (for example `p99 <= 300 ms [A3]`), then list every assumption with a one-line rationale. This covers every number you chose, including scaling and alarm thresholds, error rates, key rotation and scan intervals. A number taken from a standard cites it instead (for example `PCI DSS 10.5.1`). Untagged numbers read as design facts, and a tester cannot tell which ones to confirm, so do not claim the untagged numbers come from the design unless each one does.

Check the targets against each other before finishing. Unit cost times volume must fit the stated budget. Batch throughput times the window must cover the volume, including growth. Keep any limit the design states. If it looks infeasible, record the conflict as an open issue rather than inventing a different figure.

## Quality Gate

**CRITICAL (must fix):**

- NFRs use vague terms instead of measurable targets
- Performance targets not separated by operation type (read vs write)
- Availability target not expressed as a percentage with RTO/RPO

**IMPORTANT (should fix):**

- Scale thresholds not defined (when to scale out, when to scale in)
- Compliance requirements not mapped to specific standards (SOC2, PCI, HIPAA)
- Observability requirements missing trace sampling rate

**SUGGESTION:**

- Could add NFRs for cold start latency if Lambda is used
- Could define degraded mode behavior when targets cannot be met

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking. If the user said not to ask questions, fix the findings and report what changed.
