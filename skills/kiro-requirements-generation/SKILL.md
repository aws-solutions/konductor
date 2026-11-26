---
name: kiro-requirements-generation
description: Writes a Kiro IDE requirements.md, or bugfix.md for a bug. Use when turning user stories into a Kiro requirements.md with EARS acceptance criteria, or a bug report into bugfix.md. For a bare feature request, write user stories first.
version: 1.1.0
tags: [skill, kiro, specs, requirements, ears, acceptance-criteria]
---

# Kiro Requirements Generation

## Overview

Bridges product management artifacts to Kiro IDE's spec-driven development workflow. Takes user stories (from `user-story-writing`) and extracted requirements (from `requirements-extraction`) and produces `{spec_dir}/requirements.md` files using the EARS (Easy Approach to Requirements Syntax) format for acceptance criteria.

This skill sits at the handoff point between product management and design — after user stories are approved and before architecture work begins. The output drives Kiro IDE's spec-driven development, where requirements.md is the source of truth for design and task generation.

Every requirement names the user story it came from by ID, so a reader can trace a requirement back to the PM handoff, and design and tasks can trace forward to it.

Two parameters choose what to write:

- `spec_type` (optional): `feature` (default) writes `requirements.md`. `bugfix` writes `bugfix.md` instead; see [Bugfix Mode](#bugfix-mode).
- `workflow` (optional): `requirements-first` (default) or `design-first`. In a design-first spec, `{spec_dir}/design.md` already exists; see Step 4.

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

- Handoff files from the PM phase, such as `.konductor/handoff/product-manager-user-stories.md`, `user-stories-raw.md`, or `user-stories-extract.md` from `requirements-extraction`
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

[2-4 sentence summary of the feature, its purpose, and the primary user persona it serves. Name the source user stories file.]

## Glossary

- **[System_Name]**: [The system or component the criteria name, e.g. the service this feature adds.]
- **[Term]**: [One-sentence definition, with limits and units where they apply.]

## Requirements

### Requirement 1: [Short descriptive title]

**User Story:** As a [role], I want [feature], so that [benefit]

**Source:** [Story ID] ([story title]), [feature-split or stories file name]

#### Acceptance Criteria

1. WHEN [event], THE [system] SHALL [response]
2. WHILE [precondition], WHEN [trigger], THE [system] SHALL [response]
3. IF [error condition], THEN THE [system] SHALL [response]

### Requirement 2: [Short descriptive title]

**User Story:** As a [role], I want [feature], so that [benefit]

**Source:** [Story ID] ([story title]), [source file name]

#### Acceptance Criteria

1. THE [system] SHALL [response]
2. WHEN [event], THE [system] SHALL [response]
3. WHERE [feature included], THE [system] SHALL [response]

### Requirement N: [Short descriptive title]

**User Story:** As a [role], I want [feature], so that [benefit]

**Source:** [Story ID] ([story title]), [source file name]

#### Acceptance Criteria

1. [EARS-format criterion]
2. [EARS-format criterion]
```

### Format Rules

- An optional `## Out of Scope` section may sit between the Introduction and the Glossary, listing the non-goals no requirement covers. Kiro's design-first requirements.md can include one
- Each requirement maps to one user story and names it on its `**Source:**` line. A story may produce several requirements (for example, the behavior and its input validation); each of them cites the same story
- The Glossary defines every system, component and domain term the criteria use. Write multi-word terms as one token with underscores (`Notes_API`, `Create_Request`) and use them with that exact spelling in every criterion, so each criterion reads unambiguously. Put limits in the definition (`A valid Title is 1 to 200 characters`) rather than repeating them loosely
- Requirement titles are short and descriptive (3-8 words)
- Each requirement has 3-8 acceptance criteria in EARS format
- Every criterion MUST contain the keyword `SHALL`
- Number criteria sequentially within each requirement
- Group related requirements logically (e.g., CRUD operations together, error handling together)

## Bugfix Mode

With `spec_type: bugfix`, write `{spec_dir}/bugfix.md` instead of `requirements.md`. Kiro's bugfix specs replace the requirements document with a bug analysis, so the fix and the behavior that must not change are both stated before any design work. The layout below is the one Kiro writes.

Input is a bug report rather than user stories: the observed behavior, reproduction steps, and the issue or ticket ID. Read the code the report names before writing, so each condition names real inputs and states.

````markdown
# Bugfix Requirements Document

## Introduction

[What is wrong and where, the root cause if the code shows it, the reproduction with actual and expected results, the impact, and the source bug report ID.]

## Bug Analysis

### Current Behavior (Defect)

[One sentence defining any value the conditions use, such as `start`.]

1.1 WHEN [condition] THEN the system [incorrect behavior it shows today]
1.2 WHEN [condition] THEN the system [incorrect behavior]

### Expected Behavior (Correct)

2.1 WHEN [condition of 1.1] THEN the system SHALL [correct behavior]
2.2 WHEN [condition of 1.2] THEN the system SHALL [correct behavior]

### Unchanged Behavior (Regression Prevention)

3.1 WHEN [condition] THEN the system SHALL CONTINUE TO [existing behavior]

### Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type [input type]
  OUTPUT: boolean
  RETURN [the predicate that is true exactly when the defect shows]
END FUNCTION
```

```pascal
// Property: Fix Checking - [what the fix guarantees]
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT [expected result of the fixed function f'(X)]
END FOR
```

```pascal
// Property: Preservation Checking - every other input behaves as before
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT f(X) = f'(X)
END FOR
```
````

Rules:

- Items are plain lines numbered `section.item`, not a Markdown list: section 1 is Current, 2 is Expected, 3 is Unchanged. `kiro-design-generation` and `kiro-task-generation` cite them by that number, for example `_Requirements: 2.1, 3.2_`
- Current Behavior items describe the defect as it is, so they carry no `SHALL`. Each one is reproducible from its condition
- Expected Behavior item `2.N` has the same condition as Current Behavior item `1.N`
- Unchanged Behavior lists the nearby behavior a fix could break: other inputs to the same code path, the success case next to the failing one, existing error handling, and the function's signature. Give at least one item per changed code path
- Bug Condition defines `isBugCondition` precisely enough to generate inputs from, then states the fix property over inputs that meet it and the preservation property over inputs that do not, with `f` the current function and `f'` the fixed one
- The Introduction names the bug report ID the way a feature requirement names its story ID

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

1. The feature split and user stories paths the caller passes, or a handoff file such as `.konductor/handoff/product-manager-user-stories.md` or `user-stories-extract.md`
2. User stories provided directly in the conversation
3. Existing requirements documents referenced by the user

When the caller passes a feature split (`feature_scope_path`, from `task-decomposition`), its story IDs are authoritative: use the ID the split gives each story, even where the stories file numbers it differently, take the title from the stories file, and name the feature-split file on the Source line. Without a split, record each story's ID as the stories file gives it, for example `Story 2.1` from `user-stories-extract.md`. If the stories carry no IDs, number them `US-1`, `US-2`, ... in the order they appear in the source and say so in the Introduction, so the IDs stay reproducible.

### Step 2: Confirm Feature Scope

This skill produces one `requirements.md` per invocation, for the single feature identified by `spec_dir` (or its default `.kiro/specs/{feature-name}/`). Feature splitting happens upstream, via `task-decomposition`. If the user stories read in Step 1 span multiple features, filter to only those in scope for this invocation's feature before continuing — do not group them into multiple features or write more than one `requirements.md` in a single run. If multiple features need specs, invoke this skill once per feature with that feature's own `spec_dir`, the same way `kiro-spec-workflow` does by passing a single `feature_name`.

### Step 3: Create Output Path

For this invocation's feature, create:

```
{spec_dir}/requirements.md
```

For a bugfix spec, create `{spec_dir}/bugfix.md` and follow [Bugfix Mode](#bugfix-mode) instead of Steps 4 and 5.

### Step 4: Convert Each Story to EARS

In a design-first spec, read `{spec_dir}/design.md` first. Derive the criteria from the components, interfaces and error cases it defines, still grouped under the user stories they serve, and list any design behavior that no story asks for in the Introduction as an open question. `kiro-design-generation` then adds the requirement numbers to the design.

For each user story in the feature:

1. Preserve the original user story statement ("As a... I want... so that...") and add its `**Source:**` line
2. Convert each Given/When/Then acceptance criterion to EARS format using the conversion rules above
3. Add edge case criteria that may not be in the original stories (error handling, boundary conditions, concurrent access)
4. Ensure every criterion contains `SHALL` and uses one of the 6 EARS patterns

### Step 5: Write requirements.md

Assemble the full `requirements.md` following the output format:

1. Write the Introduction section summarizing the feature
2. Write the Glossary: every system name and domain term the criteria use
3. Add each requirement with its user story, its Source line and EARS acceptance criteria
4. Number all criteria sequentially within each requirement
5. Verify the document against the Quality Gate before presenting to the user

### Step 6: Validate

Before presenting a feature spec's requirements.md, verify:

- [ ] Every acceptance criterion contains `SHALL`
- [ ] Every criterion uses one of the 6 EARS patterns
- [ ] Every requirement has a user story and a `**Source:**` line whose ID exists in the feature split, or in the stories file when there is no split
- [ ] Every in-scope story is the source of at least one requirement
- [ ] Every term the criteria capitalize as a defined term is in the Glossary
- [ ] No vague terms without measurable values (replace "fast" with "< 200ms", "many" with specific counts)
- [ ] Error/failure scenarios are covered with Unwanted (IF/THEN) patterns
- [ ] Feature directory name is kebab-case

Before presenting a bugfix spec's bugfix.md, verify:

- [ ] The Current, Expected and Unchanged Behavior sections and the Bug Condition are all present
- [ ] Items are plain lines numbered `section.item`, not a Markdown list
- [ ] Every Current Behavior item states the defect without `SHALL` and is reproducible from its condition
- [ ] Every Current Behavior item `1.N` has an Expected Behavior item `2.N` with the same condition and a `SHALL`
- [ ] Every Unchanged Behavior item uses `SHALL CONTINUE TO`, with at least one per changed code path
- [ ] `isBugCondition` is defined precisely enough to generate inputs, with the fix and preservation properties after it
- [ ] The Introduction names the bug report ID
- [ ] No vague terms without measurable values
- [ ] Spec directory name is kebab-case

## Quality Gate

**CRITICAL (must fix before done):**

- Feature spec: an acceptance criterion missing EARS keywords (`SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF/THEN`)
- Feature spec: no `SHALL` keyword in a criterion — every criterion must specify what the system SHALL do
- Feature spec: a requirement missing its source user story, or its `**Source:**` ID not found in the feature split (or the stories file when there is no split)
- Feature spec: an in-scope user story with no requirement citing it
- Feature spec: requirements.md missing the Introduction or Requirements sections
- Bugfix spec: bugfix.md missing one of its three behavior sections or the Bug Condition, or an Unchanged Behavior item without `SHALL CONTINUE TO`
- Bugfix spec: a Current Behavior item with no Expected Behavior item of the same number, or an Expected Behavior item without `SHALL`
- Spec directory name not in kebab-case

**IMPORTANT (should fix):**

- Feature spec: no Glossary, or a term used in criteria that the Glossary does not define
- Bugfix spec: a Current Behavior item that carries `SHALL` or cannot be reproduced from its condition, or an Introduction without the bug report ID
- Vague triggers without specific events ("when something happens" → specify the exact event)
- Untestable criteria — no measurable outcome or observable behavior
- Feature spec: missing error/failure scenarios for a requirement that involves external calls or user input
- Acceptance criteria describe implementation details instead of observable behavior
- Feature spec: fewer than 3 acceptance criteria per requirement

**SUGGESTION:**

- Could add edge case criteria (concurrent access, boundary values, empty states)
- Could add performance criteria using Ubiquitous pattern (THE system SHALL respond within X ms)
- Could add security criteria using Unwanted pattern (IF unauthorized access attempted, THEN...)
- Could cross-reference NFRs from `requirements-extraction` as additional criteria

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking. If the user said not to ask questions, fix CRITICAL and IMPORTANT findings yourself and finish without the prompt. If both apply, `scope_confirmed` wins: the caller owns the fix step, so report the findings and leave fixing to the caller. Fix the findings yourself only in no-questions mode without `scope_confirmed`.
