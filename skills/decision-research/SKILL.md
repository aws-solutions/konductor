---
name: decision-research
description: Use before drafting a decision record to gather context systematically, discovering prior art, framing alternatives, assessing trade-offs, and building an evidence base. Also use as a verification step after rubric-based quality checks (Maker-Checker Pattern) to validate an artifact's factual claims.
---

# Decision Research

## Overview

Every decision record needs an evidence base. This skill provides patterns for gathering context systematically before drafting a decision.

## Research Phases

### Phase 1: Understand the Current State

Before exploring alternatives, understand what exists today.

**Codebase search:**

- Search for existing implementations related to the decision topic
- Look for configuration files, infrastructure definitions, or API contracts
- Find existing tests that reveal current behavior and assumptions
- Check for TODO comments, tech debt markers, or prior attempts

**Commands:**

```bash
rg "pattern" --type ts          # Search by file type
rg -l "pattern"                 # List files only
find . -name "*.config.*"       # Find configuration files
```

**Tools:**

- `Grep` and `Glob` to search the codebase for existing implementations and similar patterns

### Phase 1b: Extract Slack Discussion Context

When the user provides Slack thread URLs or asks to search Slack for prior discussions:

**Reading a specific thread:**

- Use your Slack MCP integration's thread-replies tool with the Slack URL to read the full conversation
- Use your Slack MCP integration's user-lookup tool to resolve Slack user IDs to real names — never use raw IDs in findings
- Use your Slack MCP integration's channel-info tool to get channel name and context

**Searching for related discussions:**

- Use `search` with topic keywords to find relevant Slack conversations
- Combine with channel filters (e.g., `in:#architecture-reviews`) for precision
- Read the top results via your Slack MCP integration's thread-replies tool for full context

**What to extract from threads:**

- The core question or problem being discussed
- Each participant's position and their reasoning
- Arguments for and against each position (with attribution)
- Constraints or requirements mentioned
- Consensus points and unresolved tensions
- Links or references shared in the thread
- Timeline context (when was this discussed, is it still relevant?)

**Mapping thread content to research output:**

| Thread element        | Maps to                                     |
| --------------------- | ------------------------------------------- |
| Participants          | Deciders / stakeholders                     |
| Positions taken       | Alternatives (with evidence from arguments) |
| Consensus points      | Proposed recommendation                     |
| Unresolved tensions   | Key trade-offs to address                   |
| Constraints mentioned | Constraints section                         |
| Links shared          | Sources                                     |

### Phase 2: Find Prior Decisions

Check if this decision has been made before — in this project or elsewhere.

**Local:**

```bash
# Search existing decision records
find . -name "*.md" | xargs rg -l "topic keyword"
# Check decision log
cat decision-log.md
```

**Broader sources:**

- `WebSearch` for public docs, blogs, or existing ADRs on the topic
- `WebFetch` for specific doc pages found via search
- `Grep` for `ADR` or `decision` references in available code repositories

### Phase 3: Discover Alternatives

Systematically find options rather than relying on what comes to mind first.

**Technology decisions:**

1. Consult official AWS docs and public best-practice guides for recommended-tooling guidance
2. `Grep` available code repositories to see what patterns are in use
3. `WebSearch` for public evaluations or comparisons
4. `WebFetch` official vendor/tool documentation for specific tools

**Architecture decisions:**

1. `WebSearch` for public design patterns and reference architectures
2. `Grep` available code repositories for similar systems and patterns
3. Check for relevant guiding principles or engineering tenets that apply

**Product decisions:**

1. Search for customer data, usage metrics, or research
2. Look for similar product decisions in adjacent teams
3. Check for relevant product frameworks or strategies

### Phase 4: Gather Evidence for Trade-offs

For each alternative, collect evidence on both strengths and weaknesses.

**What to collect:**

- Performance benchmarks (with methodology and conditions)
- Adoption data (how many teams use it, since when)
- Operational data (incident frequency, on-call burden)
- Cost data (infrastructure, licensing, team ramp-up)
- Maturity indicators (version history, community size, support model)

**How to present:**

- Always include the source link
- Distinguish between measured data and estimates
- Note sample sizes and time periods for metrics
- Flag where data is missing and state assumptions

### Phase 5: Identify Constraints

Constraints narrow the decision space. Document them explicitly.

**Technical constraints:**

- Existing technology stack requirements
- Performance SLAs or latency budgets
- Security or compliance requirements
- Integration requirements with existing systems

**Organizational constraints:**

- Team expertise and ramp-up capacity
- Timeline and delivery commitments
- Budget limitations
- Organizational standards or mandates

**Operational constraints:**

- On-call support model
- Deployment pipeline compatibility
- Monitoring and observability requirements
- Disaster recovery requirements

## Research Output Template

```markdown
## Research: [Topic]

### Current State

[What exists today, how it works, relevant metrics]

### Prior Decisions

- [ID]: [Title] — [Status] — [Relevance to this decision]

### Alternatives

#### Option A: [Name]

- **Description**: [What it is]
- **Evidence for**: [Data-backed strengths]
- **Evidence against**: [Data-backed weaknesses]
- **Adoption**: [Who uses it, since when]
- **Source**: [Links]

#### Option B: [Name]

[Same structure]

### Constraints

- [Constraint 1]: [Source/rationale]
- [Constraint 2]: [Source/rationale]

### Gaps

- [What we could not find that would strengthen the decision]

### Sources

1. [URL]: [What it contains]
2. [URL]: [What it contains]
```

## Anti-Patterns

MUST guard against these biases when challenging assumptions, forcing source-backed findings rather than accepting the first plausible answer:

1. **Confirmation bias** — Searching only for evidence that supports the preferred option. Force yourself to search for weaknesses of the leading option and strengths of alternatives.

2. **Recency bias** — Favoring new technologies just because they are new. Check for maturity indicators: how long has it been in production use?

3. **Anchoring** — Letting the first option found dominate the analysis. Document at least 3 alternatives before evaluating any of them.

4. **Authority bias** — "Team X uses it so it must be good." Ask why they chose it and whether their context matches yours.

5. **Missing data** — Presenting incomplete data as if it is complete. Always note what you could not find and what assumptions you are making.

## Artifact Verification Mode

When used as a verification step after rubric-based quality checks (Maker-Checker Pattern), focus research on validating the artifact's claims rather than exploring alternatives.

### What to Verify

- Factual claims ("no existing solution", "customers need X", "this will reduce latency by Y%")
- Assumptions ("the current architecture can't support X")
- Competitive/landscape assertions ("no team has built this")
- Technical claims ("DynamoDB can handle this access pattern")

### Verification Output

Present findings in these categories (skip empty ones):

1. **Factual Corrections** — Claims contradicted by evidence (with source links)
2. **Missing Context** — Relevant prior art, adjacent work, or existing solutions the author may not know about
3. **Strengthening Suggestions** — Evidence that supports the artifact but was not cited
4. **Alternative Perspectives** — Different approaches found in sources worth considering
5. **Open Questions** — Claims that could not be verified or refuted — need human input

End with: strongest aspect of the artifact + single most important improvement.
