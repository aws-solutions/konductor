# Analyze

## Overview

Use it before implementing features in unfamiliar code, for complex multi-system changes, when debugging after 2+ failed attempts, for architecture decisions, or when understanding existing patterns.

> **Execution context:** Steps below run shell commands and may write files. An agent without those tools delegates them to specialist agents per its routing rules.

## Parameters

- **target** (required): What to analyze (e.g., a feature area, codebase section, system component, or bug)
- **analysis_questions** (optional): Specific questions to answer during analysis
- **scope** (optional): Directories, services, or components to focus on

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding

## Steps

### 1. Gather Context

Spawn agents and use direct tools simultaneously to gather information.

**Constraints:**

- You MUST spawn agents in parallel where possible:
  - `k-researcher` (1-2 agents): Codebase patterns, implementations, file structure
  - `k-researcher` (1-2 agents): External library documentation (if external dependencies are involved)
- You MUST also use direct tools in parallel with agent spawning:
  - `grep`/`rg` for targeted text searches
  - `ast-grep` for structural code pattern searches
- You MUST scope searches to the `scope` parameter if provided
- You MUST NOT skip test files during context gathering

**Expected Output:** Raw findings from agents and direct tools: file paths, code snippets, documentation references, and pattern observations

### 2. Define Analysis Questions

Establish what needs to be understood before implementation can proceed.

**Constraints:**

- You MUST define at least these 5 questions (and add more as needed):
  1. How does the existing system work?
  2. What patterns are currently used?
  3. What dependencies are involved?
  4. What are the integration points?
  5. What tests exist?
- If `analysis_questions` parameter was provided, You MUST include those questions in addition to the standard ones
- You MUST NOT proceed to synthesis without answering all questions

**Expected Output:** A numbered list of analysis questions, each with its answer based on context gathered in Step 1

### 3. Assess Complexity

Determine if the task requires escalation to a senior architect review.

**Constraints:**

- You MUST check each of these indicators:

| Indicator                                 | Action                     |
| ----------------------------------------- | -------------------------- |
| Architecture decision required            | Escalate to k-architect    |
| Multi-system coordination (3+ components) | Escalate to k-architect    |
| Debugging after 2+ failed fix attempts    | Escalate to k-architect    |
| Security implications                     | Escalate to k-architect    |
| Simple implementation with clear patterns | Proceed without escalation |

- If ANY escalation indicator is true, You MUST note it and recommend architect consultation before implementation
- You MUST NOT skip the complexity check

**Expected Output:** A complexity assessment with each indicator checked and a clear recommendation: "Proceed" or "Escalate to k-architect with [reason]"

### 4. Synthesize Findings

Consolidate all gathered context into a structured analysis summary.

**Constraints:**

- You MUST include all of these sections in the synthesis:
  - Current State: How the system currently works
  - Patterns Identified: Coding patterns, naming conventions, file organization
  - Dependencies: Libraries involved, integration points
  - Constraints: Technical limitations, requirements to follow
  - Recommended Approach: Based on findings
- You MUST NOT include raw tool output. Synthesize into actionable insights
- If findings exceed ~100 lines, You MUST write to `.konductor/handoff/<analysis-name>.md` and return the path

**Expected Output:** A structured analysis summary:

```markdown
## Analysis Summary

### Current State

- [How the system currently works]

### Patterns Identified

- [Coding patterns in use]
- [Naming conventions]
- [File organization]

### Dependencies

- [Libraries involved]
- [Integration points]

### Constraints

- [Technical limitations]
- [Requirements to follow]

### Recommended Approach

- [Based on findings]
```

### 5. Proceed to Implementation

Transition from analysis to action using the gathered context.

**Constraints:**

- You MUST NOT proceed to implementation if any analysis questions from Step 2 remain unanswered
- You MUST NOT proceed if complexity assessment in Step 3 recommended escalation and escalation has not occurred
- You MUST create an implementation plan (using the plan SOP) based on the analysis summary
- You MUST define success criteria before writing any code

**Expected Output:** Confirmation that analysis is complete, with either:

- A handoff to the plan SOP for implementation planning, or
- A recommendation to escalate to k-architect with specific questions
