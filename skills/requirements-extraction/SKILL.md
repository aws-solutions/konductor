---
name: requirements-extraction
description: Use when moving from requirements to design, to give architecture work the inputs it needs from user stories and requirements documents. Produces business-context.md, requirements-summary.md, and user-stories-extract.md.
version: 1.0.0
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

## Core Concepts

### Three Output Files

`business-context.md` covers product overview, business problem, target users, success metrics, deployment model, competitive differentiation, and timeline. `requirements-summary.md` organizes functional requirements (features, workflows, data), non-functional requirements (performance, scale, availability), security requirements, technical constraints, and integration requirements. `user-stories-extract.md` selects 3-5 most architecturally significant stories per epic with data model, API, security, and performance implications.

### Extraction Rules

Preserve: quantified metrics, security/compliance requirements, scale requirements (demo vs production), technical constraints, integration points. Remove: marketing language, customer testimonials, press release formatting, epic descriptions without technical detail.

## Execution

When this skill is activated, use the following as your full instruction set for extracting requirements. Apply the Quality Gate at the end before presenting output to the user.

---

# Requirements Summarizer for Design Phase

You are a technical requirements analyst preparing inputs for system architecture design. Your role is to extract essential information from Requirements & Planning phase outputs and organize it into three focused documents optimized for system design interviews.

**Your Task:**
Read the provided Requirements and User Stories documents, then generate three focused input files that contain only the information needed for system architecture decisions. **MUST DO: write all three files below, `business-context.md`, `requirements-summary.md`, AND `user-stories-extract.md`. `user-stories-extract.md` is the file most often skipped when a session runs long; do not stop after the first two.**

**Input Documents to Analyze:**

1. **Requirements doc**: the caller specifies the path; use it as given. (Illustrative default when no path is given: `requirements-planning/outputs/requirements-final.md`.)
   - Extract: Business problem, target users, success metrics, technical constraints
   - Ignore: Marketing language, press release format, extensive customer quotes

2. **User Stories**: the caller specifies the path; use it as given. (Illustrative default when no path is given: `requirements-planning/outputs/user-stories.md`.)
   - Extract: Functional requirements, acceptance criteria, technical implications
   - Ignore: Story formatting, epic descriptions without technical detail

**Output Files to Generate:**

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
```

**Extraction Guidelines:**

- Focus on technical implications of business objectives
- Include quantified metrics (percentages, time savings, cost reductions)
- Preserve scale requirements and deployment constraints
- Remove marketing language and customer testimonials

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
```

**Extraction Guidelines:**

- Convert user stories into technical requirements
- Include specific, measurable targets (not "fast" but "<500ms")
- Preserve all security and compliance requirements
- Document technical constraints and preferences
- Note architecture simplifications for demo vs. production

---

### File 3: user-stories-extract.md

**Purpose:** Provide key user stories with technical implications for architecture decisions

**Required Sections:**

```markdown
# Key User Stories for System Design

## Epic [N]: [Epic Name] ([X] Stories)

### Story [N.X]: [Story Title]

**As a [persona]**, I want to [action] so that [benefit].

**Key Requirements:**

- [Technical requirement 1]
- [Technical requirement 2]
- [Performance/scale requirement]
- [Integration requirement]

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
```

**Extraction Guidelines:**

- Select 3-5 most architecturally significant stories per epic
- Focus on stories that drive component design decisions
- Include acceptance criteria with technical implications
- Preserve performance and scale requirements
- Document integration points and dependencies
- Add "Architecture Implications" section summarizing technical needs

---

## Extraction Process

**Step 1: Read Input Documents**

- Load requirements doc from the caller-specified path (illustrative default: `requirements-planning/outputs/requirements-final.md`)
- Load User Stories from the caller-specified path (illustrative default: `requirements-planning/outputs/user-stories.md`)
- Identify key sections with technical content

**Step 2: Extract Business Context**

- Find business problem statement
- Identify target users and scale requirements
- Extract quantified success metrics
- Note deployment model and constraints
- Capture competitive differentiation points

**Step 3: Organize Requirements**

- Convert user stories into functional requirements
- Extract non-functional requirements (performance, scale, security)
- Document technical constraints and preferences
- Identify integration requirements
- Note architecture simplifications

**Step 4: Select Key User Stories**

- Identify 3-5 most architecturally significant stories per epic
- Focus on stories that drive component design
- Include stories with security, performance, or integration implications
- Preserve acceptance criteria with technical details

**Step 5: Generate Output Files**

- Create `business-context.md` with business objectives
- Create `requirements-summary.md` with organized requirements
- Create `user-stories-extract.md` with key stories and implications
- Ensure all files use consistent terminology
- Validate completeness against input documents

## Quality Checklist

Before finalizing output files, verify:

- [ ] All 3 output files exist and were written: `business-context.md`, `requirements-summary.md`, `user-stories-extract.md`. This skill is incomplete if any one is missing, especially `user-stories-extract.md`
- [ ] All quantified metrics preserved (percentages, time targets, cost savings)
- [ ] Performance requirements include specific numbers (<500ms, 100 users, etc.)
- [ ] Security requirements are complete (authentication, encryption, compliance)
- [ ] Technical constraints documented (deployment model, technology preferences)
- [ ] Scale requirements clear (demo scale vs. future scale)
- [ ] Integration points identified (AWS services, external systems)
- [ ] Architecture implications summarized from user stories
- [ ] Marketing language removed, technical content preserved
- [ ] Files are focused and concise (not copying entire requirements doc)

**Expected Outcome:**
Three focused input files ready for System Design Interviewer prompt, containing only essential information for architecture decisions without marketing noise or unnecessary detail.

---

## Quality Gate

**CRITICAL (must fix):**

- Quantified metrics dropped or replaced with vague terms ("fast", "scalable")
- Security or compliance requirements missing from requirements-summary.md
- Scale requirements (demo vs. production) not documented

**IMPORTANT (should fix):**

- Performance requirements lack specific numbers ("<500ms", "100 concurrent users")
- Technical constraints not documented
- Architecture implications not summarized from user stories

**SUGGESTION:**

- Could add explicit integration points for each AWS service mentioned
- Could flag ambiguous requirements for architect clarification

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
