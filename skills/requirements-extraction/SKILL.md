---
name: requirements-extraction
description: Extracts design inputs from Requirements & Planning outputs (user stories, requirements docs) into three focused files for architecture work. Use when existing requirements and user stories must be summarized or handed off for system design, such as preparing design inputs for an architect. Not for a request that has no requirements yet; write user stories first. Produces business-context.md, requirements-summary.md, and user-stories-extract.md.
version: 1.1.0
tags: [skill, requirements, design-handoff, extraction, system-design]
---

# Requirements Extraction

## Overview

Transforms Requirements & Planning outputs (user stories, requirements docs) into three focused input files for system architecture design. Removes marketing language while preserving all technical requirements, constraints, and business context.

## Usage

Use this skill when:

- Transitioning from Requirements & Planning to Design & Architecture phase
- Preparing inputs for the system design interview
- Creating a handoff document between PM and architect

## Extraction Rules

These apply to all three files:

- **Preserve:** quantified metrics (percentages, time savings, cost reductions), security and compliance requirements, scale requirements (demo vs. production), deployment model and technical constraints, integration points.
- **Remove:** marketing language, customer testimonials, press release formatting, epic descriptions without technical detail.
- Use specific, measurable targets: not "fast" but "<500ms".
- **Don't invent.** The templates below list sections the source may not cover (competitive differentiation, monitoring, uptime outside a stated window, peak load). When the source is silent, write "Not specified in source" and add an open question; don't fill the section with plausible content. Tag anything you derive or assume as `[Assumption]`, and keep vendor or service choices the source doesn't name out of the files.
- **Flag ambiguities.** Each run ends with an Open Questions list for the architect: stories with no acceptance criteria, requirements that conflict with each other, and constraints that leave a design choice open (for example, which region supporting services and stores must use under a data residency rule).

Write all three files: `business-context.md`, `requirements-summary.md`, and `user-stories-extract.md`. The last one is the file most often skipped when a session runs long, so don't stop after the first two. Apply the Quality Gate before presenting the files.

## Input Documents

1. **Requirements doc**: the caller specifies the path; use it as given. (Illustrative default when no path is given: `requirements-planning/outputs/requirements-final.md`.)
   - Extract: Business problem, target users, success metrics, technical constraints
   - Ignore: Marketing language, press release format, extensive customer quotes

2. **User Stories**: the caller specifies the path; use it as given. (Illustrative default when no path is given: `requirements-planning/outputs/user-stories.md`.)
   - Extract: Functional requirements, acceptance criteria, technical implications
   - Ignore: Story formatting, epic descriptions without technical detail

## Output Files

### File 1: business-context.md

**Purpose:** Provide business context for architectural decisions

**Required Sections:**

```markdown
# Business Context for System Design

## Product Overview

[Product name and one-sentence description]

## Business Problem

[Clear problem statement - what pain point does this solve?]

## Target Users

- **Primary**: [Primary user role and organization size]
- **End Users**: [Actual system users]
- **Scale**: [Expected user count and data volume for demo/production]

## Key Business Objectives

- [Objective 1 with quantified target]
- [Objective 2 with quantified target]
- [Objective 3 with quantified target]

## Success Metrics

- [Metric 1 with target value]
- [Metric 2 with target value]
- [Metric 3 with target value]

## Deployment Model

- [How will this be deployed? Cloud, on-premises, hybrid?]
- [Who manages infrastructure?]
- [Any deployment constraints?]

## Competitive Differentiation

- [Key differentiator 1]
- [Key differentiator 2]
- [Key differentiator 3]

## Timeline

- **Launch Date**: [Target launch date]
- **Current Phase**: Design & Architecture (System Requirements)
- **Phase 1 Exclusions**: [Features explicitly out of scope]
```

Focus on the technical implications of each business objective.

---

### File 2: requirements-summary.md

**Purpose:** Organize functional and non-functional requirements for architecture design

**Required Sections:**

```markdown
# Requirements Summary for System Design

## Functional Requirements

### Core Features

1. **[Feature 1]**: [Description with key capabilities]
2. **[Feature 2]**: [Description with key capabilities]
   [Continue for all major features]

### User Workflows

- **[Workflow 1]**: [Step-by-step description]
- **[Workflow 2]**: [Step-by-step description]
  [Continue for critical workflows]

### Data Requirements

- **[Data Type 1]**: [Storage, processing, access patterns]
- **[Data Type 2]**: [Storage, processing, access patterns]

## Non-Functional Requirements

### Performance

- **Query Response Time**: [Specific latency targets]
- **Concurrent Users**: [Expected concurrent load]
- **Throughput**: [Requests per second or data volume]

### Scale

- **Demo Scale**: [Initial scale targets]
- **Future Scale**: [Growth projections]
- **Concurrent Operations**: [Peak load expectations]

### Availability & Reliability

- **Uptime**: [SLA target]
- **Error Handling**: [Failure tolerance requirements]
- **Data Consistency**: [Consistency requirements]

## Security Requirements

### Authentication & Authorization

- [Authentication mechanism]
- [Authorization model]
- [Access control requirements]

### Data Protection

- **Encryption at Rest**: [Requirements]
- **Encryption in Transit**: [Requirements]
- **Data Residency**: [Geographic constraints]

### Compliance & Auditing

- [Compliance standards required]
- [Audit logging requirements]
- [Data retention policies]

## Technical Constraints

### Deployment Environment

- [Cloud provider and services]
- [Infrastructure preferences]
- [Operational constraints]

### Technology Stack

- **Backend**: [Preferred languages/frameworks]
- **Database**: [Data store preferences]
- **API**: [API style and protocols]
- **Frontend**: [UI technology if applicable]

### Architecture Simplifications

- [Any scope limitations for initial release]
- [Deferred features or complexity]

## Integration Requirements

### AWS Services

- [Required AWS services]
- [Integration patterns]

### Monitoring & Observability

- [Monitoring requirements]
- [Logging requirements]
- [Alerting requirements]

## Success Criteria

### Performance Targets

- [Specific performance goals]

### User Experience

- [UX quality targets]

### Business Outcomes

- [Measurable business results]

## Assumptions

- [Each assumption made, tagged where it is used]

## Open Questions for the Architect

- [Ambiguity or conflict, with the stories or requirements involved]
```

Convert user stories into technical requirements, and note architecture simplifications for demo vs. production.

---

### File 3: user-stories-extract.md

**Purpose:** Provide key user stories with technical implications for architecture decisions

**Required Sections:**

```markdown
# Key User Stories for System Design

## Epic [N]: [Epic Name] ([X] Stories)

### Story [N.X]: [Story Title]

**As a [persona]**, I want to [action] so that [benefit].

**Acceptance Criteria:** [Technical criteria from the source, or "None stated in source"]

**Technical Implications:**

- [What this story forces in the design: component, pattern, store or integration]
- [Performance/scale requirement it carries]

**Dependencies:** [Other stories, components or integrations it relies on]

[Repeat for 3-5 most architecturally significant stories per epic]

## Architecture Implications

### Data Model Requirements

- [Data entities and relationships]
- [Query patterns needed]
- [Data access patterns]

### API Design Requirements

- [Endpoint patterns]
- [Request/response formats]
- [Query parameters needed]

### Security Architecture Requirements

- [Authentication flows]
- [Authorization patterns]
- [Audit requirements]

### Performance Architecture Requirements

- [Scaling requirements]
- [Caching needs]
- [Performance optimization areas]

## Excluded Stories

- [Story ID and title, with the reason it doesn't drive architecture]

## Open Questions

- [Stories with no acceptance criteria, conflicts between stories]
```

Select the 3-5 most architecturally significant stories per epic: the ones that drive component design or carry security, performance, or integration implications. Keep their acceptance criteria where they have technical detail, and say so when a story has none rather than writing criteria for it. Technical implications must go past restating the story: name the mechanism it requires (for example, idempotent sync for offline writes, push updates for live screens, an append-only store for audit logs).

---

## Extraction Process

1. **Read the inputs** from the caller-specified paths and find the sections with technical content.
2. **Extract business context**: problem statement, target users and scale, quantified success metrics, deployment model and constraints, competitive differentiation.
3. **Organize requirements**: functional requirements from the stories, non-functional requirements (performance, scale, security), technical constraints and preferences, integration requirements, architecture simplifications.
4. **Select key user stories** as described under File 3.
5. **Write the three files** using consistent terminology across them, and check them for completeness against the inputs. Keep them focused; don't copy the whole requirements doc.

The three files are the inputs for the `system-design-patterns` interview.

---

## Quality Gate

**CRITICAL (must fix):**

- Any of the three output files missing, especially `user-stories-extract.md`
- Quantified metrics dropped or replaced with vague terms ("fast", "scalable")
- Security or compliance requirements (authentication, encryption, compliance standards) missing from requirements-summary.md
- Scale requirements (demo vs. production) not documented
- A section filled with content the source doesn't support, or an assumption left untagged

**IMPORTANT (should fix):**

- Performance requirements lack specific numbers ("<500ms", "100 concurrent users")
- Technical constraints (deployment model, technology preferences) not documented
- Integration points (AWS services, external systems) not identified
- Architecture implications not summarized from user stories
- Marketing language left in, or the files copy the requirements doc instead of summarizing it
- No Open Questions list, or one that misses stories without acceptance criteria

**SUGGESTION:**

- Could add explicit integration points for each AWS service mentioned

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]". If `scope_confirmed` is true, report all the findings and leave fixing to the caller, without asking. If the caller said not to ask questions, fix the CRITICAL and IMPORTANT findings yourself, then report what you fixed and what assumptions remain.
