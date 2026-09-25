---
name: kiro-requirements-generation
description: Use when user stories are approved and a Kiro IDE requirements.md is needed before design begins. Transforms stories and requirements into EARS-format acceptance criteria.
version: 1.0.0
tags: [skill, kiro, specs, requirements, ears, acceptance-criteria]
---

# Kiro Requirements Generation

## Overview

Bridges product management artifacts to Kiro IDE's spec-driven development workflow. Takes user stories (from `user-story-writing`) and extracted requirements (from `requirements-extraction`) and produces `{spec_dir}/requirements.md` files using the EARS (Easy Approach to Requirements Syntax) format for acceptance criteria.

This skill sits at the handoff point between product management and design — after user stories are approved and before architecture work begins. The output drives Kiro IDE's spec-driven development, where requirements.md is the source of truth for design and task generation.

## Usage

Use this skill when:

- User stories from `user-story-writing` are approved and ready for design handoff
- Requirements have been extracted via `requirements-extraction` and need Kiro IDE formatting
- Starting a new feature in Kiro IDE that needs a spec-driven workflow
- Converting existing BDD-style (Given/When/Then) acceptance criteria to EARS format

Do NOT use when:

- User stories are not yet written or approved — use `user-story-writing` first
- You need to generate design artifacts — use `kiro-design-generation` after this skill
- Requirements are still being gathered — use `requirements-extraction` first

## Input

This skill consumes two upstream artifacts:

1. **User Stories** from `user-story-writing` — INVEST-format stories with Given/When/Then acceptance criteria
2. **Requirements** from `requirements-extraction` — Structured design inputs including functional requirements, NFRs, constraints, and assumptions

Input can come from:

- Handoff files in `.konductor/handoff/` (e.g., `product-manager-user-stories.md`)
- Direct user stories provided in conversation
- Existing requirements documents

## Output

```
{spec_dir}/requirements.md
```

`spec_dir` (optional): path where spec artifacts are written. Defaults to `.kiro/specs/{feature-name}/` if not provided — the same location Kiro IDE itself writes specs to, so this skill behaves identically whether invoked standalone in any Kiro project or as part of a larger workflow. A caller that keeps its artifacts elsewhere — an SDLC workflow collecting everything under one output directory, for instance — passes its own `spec_dir` and this skill MUST write there instead. Directory names MUST be kebab-case either way.

One `requirements.md` per feature.

Examples, using the default `spec_dir`:

- `.kiro/specs/network-monitoring/requirements.md`
- `.kiro/specs/vpc-analyzer/requirements.md`
- `.kiro/specs/user-authentication/requirements.md`

## EARS Format Reference

EARS (Easy Approach to Requirements Syntax) provides 6 patterns for writing unambiguous, testable requirements. Every acceptance criterion MUST use one of these patterns.

### 1. Ubiquitous

For requirements that apply at all times with no trigger or precondition.

**Template:** `THE [system] SHALL [response]`

**Example:** `THE monitoring service SHALL encrypt all data at rest using AES-256`

### 2. Event-Driven

For requirements triggered by a specific event.

**Template:** `WHEN [trigger], THE [system] SHALL [response]`

**Example:** `WHEN a new VPC is discovered, THE monitoring service SHALL create a baseline configuration record`

### 3. State-Driven

For requirements that apply while a precondition holds.

**Template:** `WHILE [precondition], THE [system] SHALL [response]`

**Example:** `WHILE the monitoring agent is in degraded mode, THE system SHALL buffer metrics locally and retry upload every 60 seconds`

### 4. Optional

For requirements tied to an optional feature or configuration.

**Template:** `WHERE [feature included], THE [system] SHALL [response]`

**Example:** `WHERE custom alerting rules are enabled, THE system SHALL evaluate user-defined thresholds alongside default rules`

### 5. Unwanted

For requirements handling error conditions, failures, or unwanted behavior.

**Template:** `IF [trigger], THEN THE [system] SHALL [response]`

**Example:** `IF the DynamoDB write fails with a ConditionalCheckFailedException, THEN THE system SHALL retry with exponential backoff up to 3 times`

### 6. Complex

For requirements combining a precondition with a trigger.

**Template:** `WHILE [precondition], WHEN [trigger], THE [system] SHALL [response]`

**Example:** `WHILE the system is processing a batch import, WHEN a duplicate record is detected, THE system SHALL skip the duplicate and log a warning with the record ID`

## Conversion Rules: BDD to EARS

User stories from `user-story-writing` use Given/When/Then (BDD) acceptance criteria. Convert them to EARS using these mappings:

| BDD Keyword | EARS Keyword | Role                                            |
| ----------- | ------------ | ----------------------------------------------- |
| **Given**   | **WHILE**    | Precondition — the state that must hold         |
| **When**    | **WHEN**     | Trigger — the event that initiates the behavior |
| **Then**    | **SHALL**    | Response — the required system behavior         |

### Conversion Examples

**BDD Input:**

```
Given the user is authenticated
When they submit a monitoring configuration
Then the system saves the configuration and returns a confirmation
```

**EARS Output:**

```
WHILE the user is authenticated, WHEN a monitoring configuration is submitted, THE system SHALL save the configuration and return a confirmation with the configuration ID
```

**BDD Input:**

```
Given the API rate limit is exceeded
Then the system returns a 429 status with a Retry-After header
```

**EARS Output:**

```
IF the API rate limit is exceeded, THEN THE system SHALL return a 429 status code with a Retry-After header indicating the reset time in seconds
```

### Conversion Guidelines

- If only **Then** exists → use **Ubiquitous** pattern (THE system SHALL...)
- If **When + Then** → use **Event-Driven** pattern (WHEN... THE system SHALL...)
- If **Given + Then** (no When) → check the Given clause:
  - If it describes an error or failure condition → use **Unwanted** pattern (IF... THEN THE system SHALL...)
  - Otherwise → use **State-Driven** pattern (WHILE... THE system SHALL...)
- If **Given + When + Then** → use **Complex** pattern (WHILE... WHEN... THE system SHALL...)
- Always make the response more specific than the original Then — add concrete values, status codes, timeouts, and identifiers

## Output Format

The generated `requirements.md` MUST follow this exact structure:

```markdown
# Requirements Document

## Introduction

[2-4 sentence summary of the feature, its purpose, and the primary user persona it serves. Reference the source user stories or product requirements document.]

## Requirements

### Requirement 1: [Short descriptive title]

**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria

1. WHEN [event] THE [system] SHALL [response]
2. WHILE [precondition], WHEN [trigger], THE [system] SHALL [response]
3. IF [error condition], THEN THE [system] SHALL [response]

### Requirement 2: [Short descriptive title]

**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria

1. THE [system] SHALL [response]
2. WHEN [event], THE [system] SHALL [response]
3. WHERE [feature included], THE [system] SHALL [response]

### Requirement N: [Short descriptive title]

**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria

1. [EARS-format criterion]
2. [EARS-format criterion]
```

### Format Rules

- Each requirement maps to one user story
- Requirement titles are short and descriptive (3-8 words)
- Each requirement has 3-8 acceptance criteria in EARS format
- Every criterion MUST contain the keyword `SHALL`
- Number criteria sequentially within each requirement
- Group related requirements logically (e.g., CRUD operations together, error handling together)

## Feature Naming

Directory names under `spec_dir`'s parent MUST use kebab-case:

- Use lowercase letters, numbers, and hyphens only
- Derive from the feature or epic name
- Keep concise but descriptive (2-4 words)

| Feature                      | Directory Name                 |
| ---------------------------- | ------------------------------ |
| Network Monitoring Dashboard | `network-monitoring-dashboard` |
| VPC Flow Log Analyzer        | `vpc-flow-log-analyzer`        |
| User Authentication & SSO    | `user-authentication`          |
| Alert Rule Management        | `alert-rule-management`        |

## Execution

When this skill is activated, follow these steps:

### Step 1: Read User Stories

Read the approved user stories from the upstream artifact. Sources (in priority order):

1. Handoff file: `.konductor/handoff/product-manager-user-stories.md`
2. User stories provided directly in the conversation
3. Existing requirements documents referenced by the user

### Step 2: Confirm Feature Scope

This skill produces one `requirements.md` per invocation, for the single feature identified by `spec_dir` (or its default `.kiro/specs/{feature-name}/`). Feature splitting happens upstream, via `task-decomposition`. If the user stories read in Step 1 span multiple features, filter to only those in scope for this invocation's feature before continuing — do not group them into multiple features or write more than one `requirements.md` in a single run. If multiple features need specs, invoke this skill once per feature with that feature's own `spec_dir`, the same way `kiro-spec-workflow` does by passing a single `feature_name`.

### Step 3: Create Output Path

For this invocation's feature, create:

```
{spec_dir}/requirements.md
```

### Step 4: Convert Each Story to EARS

For each user story in the feature:

1. Preserve the original user story statement ("As a... I want... so that...")
2. Convert each Given/When/Then acceptance criterion to EARS format using the conversion rules above
3. Add edge case criteria that may not be in the original stories (error handling, boundary conditions, concurrent access)
4. Ensure every criterion contains `SHALL` and uses one of the 6 EARS patterns

### Step 5: Write requirements.md

Assemble the full `requirements.md` following the output format:

1. Write the Introduction section summarizing the feature
2. Add each requirement with its user story and EARS acceptance criteria
3. Number all criteria sequentially within each requirement
4. Verify the document against the Quality Gate before presenting to the user

### Step 6: Validate

Before presenting output, verify:

- [ ] Every acceptance criterion contains `SHALL`
- [ ] Every criterion uses one of the 6 EARS patterns
- [ ] Every requirement has a user story
- [ ] No vague terms without measurable values (replace "fast" with "< 200ms", "many" with specific counts)
- [ ] Error/failure scenarios are covered with Unwanted (IF/THEN) patterns
- [ ] Feature directory name is kebab-case

## Quality Gate

**CRITICAL (must fix before done):**

- Acceptance criterion missing EARS keywords (`SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF/THEN`)
- No `SHALL` keyword in a criterion — every criterion must specify what the system SHALL do
- Requirement missing its source user story
- Feature directory name not in kebab-case
- requirements.md missing the Introduction or Requirements sections

**IMPORTANT (should fix):**

- Vague triggers without specific events ("when something happens" → specify the exact event)
- Untestable criteria — no measurable outcome or observable behavior
- Missing error/failure scenarios for a requirement that involves external calls or user input
- Acceptance criteria describe implementation details instead of observable behavior
- Fewer than 3 acceptance criteria per requirement

**SUGGESTION:**

- Could add edge case criteria (concurrent access, boundary values, empty states)
- Could add performance criteria using Ubiquitous pattern (THE system SHALL respond within X ms)
- Could add security criteria using Unwanted pattern (IF unauthorized access attempted, THEN...)
- Could cross-reference NFRs from `requirements-extraction` as additional criteria

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
