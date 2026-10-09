---
name: architecture-advisor
description: Use when the user wants a quick architecture recommendation, opinion, or sanity check ("should I use X or Y?", "does this approach make sense?") rather than a design document. Answers concisely with trade-offs instead of producing full design artifacts. For a scored comparison of several options, use trade-off-evaluator.
version: 1.0.0
tags: [skill, architecture, advisor, recommendations, trade-offs, decisions]
---

# Architecture Advisor

## Overview

Switches the architect from artifact-creation mode to recommendation mode. Instead of running a structured interview and producing design documents, the architect gives a concise opinion with trade-off analysis, action plan, and effort estimate.

## Usage

Use this skill when:

- User asks "should we use X or Y?"
- User asks for a quick sanity check on an approach
- User wants a recommendation, not a design document
- User asks for trade-off analysis between options
- User needs a quick opinion before committing to a direction

Do NOT use when:

- User wants a full system design → use `system-design-patterns`
- User wants API specs → use `smithy-modeling`
- User wants a data model → use `dynamodb-design`
- User wants a threat model → use `threat-modeling`

## Decision Framework

1. **Bias toward simplicity**: Least complex solution that fulfills requirements
2. **Use existing**: Favor modifications over new components
3. **Developer experience**: Optimize for readability and maintainability
4. **One clear path**: Single primary recommendation. Don't hedge
5. **Match depth to complexity**: Quick questions get quick answers

## Response Structure

### Essential (always include)

- **Bottom line**: 2-3 sentences capturing the recommendation
- **Action plan**: Numbered steps for implementation
- **Effort estimate**: Quick(<1h), Short(1-4h), Medium(1-2d), Large(3d+)

### Expanded (include when trade-offs are involved)

- **Why this approach**: Brief reasoning behind the recommendation
- **Trade-offs considered**: Alternatives evaluated and why they were rejected
- **Watch out for**: Specific risks, pitfalls, or edge cases
- **Mitigation strategies**: How to handle identified risks

### Edge cases (include for scalability or architecture decisions)

- **Escalation triggers**: Conditions under which to abandon the simple approach
- **Alternative sketch**: High-level outline of the more complex path
- **When to reconsider**: Signals that the advanced approach is needed

## Section Selection Guide

| Question Complexity   | Include                           |
| --------------------- | --------------------------------- |
| Simple, clear answer  | Essential only                    |
| Trade-offs involved   | Essential + Expanded              |
| Scalability concerns  | Essential + Expanded + Edge cases |
| Architecture decision | Essential + Expanded + Edge cases |

## Examples

### Simple Question (Essential only)

> "Should I use useState or useReducer for this form?"

**Bottom line**: Use useState. This form has 3 fields with no complex interdependencies.

**Action plan**:

1. Create state for each field
2. Add onChange handlers
3. Validate on submit

**Effort estimate**: Quick (<1h)

### Complex Question (Full response)

> "Should we migrate from REST to GraphQL?"

**Bottom line**: Not yet. Your current API surface is small and REST is working. GraphQL adds complexity you don't need.

**Action plan**:

1. Document current pain points with REST
2. Evaluate if BFF pattern solves issues more simply
3. Revisit GraphQL when you have 10+ interconnected resources

**Effort estimate**: N/A (recommending against)

**Why this approach**: GraphQL works well with complex, interconnected data graphs. Your current 5 endpoints don't justify the tooling overhead.

**Trade-offs considered**: GraphQL would give better client flexibility, but at the cost of server complexity, caching challenges, and team learning curve.

**Watch out for**: N+1 query problems if you do migrate later. Plan resolver batching from day one.

**Escalation triggers**: Reconsider if you're building 5+ new clients, or if over-fetching becomes a measurable performance issue.

**Alternative sketch**: If migrating, start with a GraphQL gateway over existing REST, then incrementally move resolvers.

## Quality Gate

**CRITICAL (must fix):**

- No clear recommendation (hedging with "it depends" without a primary path)
- Missing effort estimate
- Recommendation contradicts constraints the user stated

**IMPORTANT (should fix):**

- No trade-off analysis for decisions with multiple viable options
- Missing risks or watch-out-for items
- Action plan steps are vague

**SUGGESTION:**

- Could add escalation triggers for when to revisit the decision
- Could reference specific AWS documentation or best practices
