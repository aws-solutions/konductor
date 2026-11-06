---
name: design-evaluation
description: Evaluates complete design packages for production readiness across 10 dimensions. Use as the final quality gate before a design goes to implementation, or when a design SOP asks for 10-dimension scores. Lists missing artifacts (system design, threat model, API specs, data models, diagrams, IAM policies) before scoring.
version: 1.0.0
tags:
  [
    skill,
    design,
    evaluation,
    design-reviewer,
    production-readiness,
    architecture,
  ]
---

# Design Evaluation

## Overview

Acts as a senior design reviewer to evaluate technical designs across the ten dimensions in Step 1 below: template adherence, high-level assessment, scalability, performance, security, maintainability & extensibility, failure handling & resilience, code & implementation quality, testability & automation readiness (including CI/CD readiness), and actionable recommendations. Produces scope-tailored feedback (small/medium/large projects).

## Usage

Use this skill when:

- The design artifacts are ready for implementation handoff (Step 0 lists any that are missing)
- Running a final quality gate before the design is locked
- Preparing for a senior architecture review

## Core Concepts

### 10 Evaluation Dimensions

Template adherence, high-level assessment, scalability, performance, security, maintainability & extensibility, failure handling & resilience, code & implementation quality, testability & automation readiness (including CI/CD readiness), and actionable recommendations. These are the ten numbered items in Step 1 below, each scored 1 to 5.

### Scope-Tailored Feedback

Small projects (1-2 services) get focused feedback on core patterns. Medium projects (3-10 services) get cross-service interaction analysis. Large projects (10+ services) get organizational and operational maturity assessment.

## Execution

### Inputs

- **Design package**: the documents to evaluate. Load every artifact you are given.
- **Project scope**: small, medium or large. If the caller doesn't say, infer it from the service count in Scope-Tailored Feedback and state the inference.
- **Templates** (optional): design templates to compare against. Without one, use the section structure in `design-doc-guidelines`. Treat templates as references, not strict requirements.

### Step 0: Check the package

List which of these artifacts are missing: system design, threat model, API specs, data models, architecture diagrams, IAM policies. Then:

- When invoked standalone, show the list and ask whether to score what is present or wait for the rest. Don't score until the user answers.
- When invoked from a SOP, or `scope_confirmed` is true, don't ask. Mark each missing artifact "not provided" in the report and score what is present.

A dimension that depends on a missing artifact (security without a threat model, for example) gets its score capped at 3, with the gap named as a finding.

### Step 1: Score the 10 dimensions

Score each dimension from 1 to 5 and list its findings. Tailor the depth to the project scope:

- **Small:** prioritize simplicity and maintainability, and flag over-engineering.
- **Medium:** balance scalability, security and performance while keeping services modular.
- **Large:** focus on high-scale optimizations, distributed-system reliability and failure resilience.

Evaluate only what applies to this design. When a section is absent, say whether the omission is reasonable for the scope. When a template asks for a feature this scope doesn't need, say why, and note when it might be needed later.

1. **Template adherence:** does the design follow the relevant template sections? Justify each deviation against the scope, and flag a missing section only if this project needs it.
2. **High-level assessment:** summarize strengths and weaknesses and judge overall technical soundness.
3. **Scalability** (if relevant): can the system handle growth in traffic and data, and what does it cost at target load? Name bottlenecks and the patterns that fix them (load balancing, caching, sharding).
4. **Performance** (if relevant): latency issues, inefficient queries, resource limits, and access patterns the data model can't serve. Suggest optimizations such as indexing, caching or async processing.
5. **Security** (if relevant): vulnerabilities in APIs and data protection, and threats left unmitigated. Recommend controls such as authentication, encryption and rate limiting.
6. **Maintainability and extensibility** (if relevant): how easily the system can change. Check modularity, separation of concerns, SOLID, and API versioning.
7. **Failure handling and resilience** (if relevant): fault tolerance, redundancy, recovery, runbooks, high availability and disaster recovery.
8. **Code and implementation quality:** architectural anti-patterns and inefficiencies, with fixes.
9. **Testability and automation readiness:** ease of unit, integration and end-to-end testing; obstacles to mocking, stubbing and fault injection; CI/CD readiness; structured logging, metrics, traces and monitoring.
10. **Actionable recommendations:** concrete steps to improve the design, aligned with published industry practice, with architecture patterns and examples where they help.

### Step 2: Report

- Be rigorous but constructive.
- Keep the output readable without horizontal scrolling, and don't cut off text at the end of a section.
- Don't ask clarifying questions during the review. Present all findings, then ask only the fix-confirmation question in the Quality Gate.

## Quality Gate

Each item names the dimension it belongs to.

**CRITICAL (blocks implementation):**

- Security (5): unmitigated HIGH severity threats
- Failure handling (7): no failure handling strategy for external dependencies
- Performance (4): the data model cannot serve every documented access pattern
- Maintainability (6): breaking-change risk in the API with no versioning strategy

**IMPORTANT (should address before implementation):**

- Testability and automation (9): no observability strategy (metrics, logs, traces)
- Failure handling (7): no runbook or operational playbook referenced
- Scalability (3): cost at target load not estimated or not checked against the architecture

**SUGGESTION:**

- Testability and automation (9): could add chaos engineering scenarios for fault injection
- Performance (4): could define SLOs and error budgets

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]". If `scope_confirmed` is true, report all the findings and leave fixing to the caller without asking.
