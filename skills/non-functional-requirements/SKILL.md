---
name: non-functional-requirements
description: Extracts measurable non-functional requirements from system design documents. Use after system design to produce NFRs across performance, availability, security, scalability, and observability. Outputs are used as inputs for test planning and architecture validation.
version: 1.0.0
tags: [skill, nfr, requirements, performance, availability, security, architecture]
---

# Non-Functional Requirements

## Execution

When this skill is activated, apply the following directly:

Extract NFRs from the provided system design document across these categories:

- Performance: response time targets (p50, p99), throughput (requests/second)
- Availability: uptime target (e.g., 99.9%), RTO, RPO
- Security: authentication method, encryption standards, compliance requirements
- Scalability: min/max instance counts, scale trigger thresholds
- Observability: required metrics, log retention, trace sampling rate
- Cost: monthly budget target, cost per transaction target

All NFRs must be measurable — no vague terms ("fast", "reliable", "secure").

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

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
