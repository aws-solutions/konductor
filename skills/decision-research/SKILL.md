---
name: decision-research
description: Use before an ADR, decision record or tool or migration choice to research current state, prior decisions, alternatives, trade-offs, constraints and evidence. Also use after rubric-based quality checks (Maker-Checker Pattern) to surface prior art and missing context an artifact overlooks; doc-accuracy-analyzer checks the claims. Slack threads and exports count as sources.
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

Use this phase when the user gives Slack thread URLs, a thread export, or asks you to search Slack for prior discussion.

Resolve every Slack user ID to the person's name and never put raw IDs (such as `U01ABC`) in findings, not even in parentheses after the name. Readers of a decision record can't map IDs to people.

Open `references/slack.md` (relative to this file) for how to read and search threads, what to extract, and how thread content maps to the research output.

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

## Verifying an Existing Artifact

To verify claims in an existing artifact, use `doc-accuracy-analyzer`.

This skill adds the prior-art angle that a claim check misses. When an artifact makes landscape claims ("no existing solution", "no team has built this", "customers need X"), run Phases 2 and 3 against them and report, skipping empty categories:

1. **Missing Context**: prior art, adjacent work, or existing solutions the author may not know about
2. **Strengthening Suggestions**: evidence that supports the artifact but was not cited
3. **Alternative Perspectives**: different approaches found in sources worth considering
4. **Open Questions**: claims you could neither confirm nor refute, which need human input

End with the artifact's strongest aspect and the single most important improvement.
