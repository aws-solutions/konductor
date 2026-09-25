---
name: design-quality-check
description: Use when a design document needs a writing-quality check before review ("check doc quality", "is this doc ready", "slop detection", "check for filler language"). Scores structure, completeness, and KISS/YAGNI compliance, and flags filler, hedging, unsupported claims, and circular reasoning. To rewrite prose that sounds AI-written, use humanize-writing.
version: 1.0.0
tags: [skill, design, quality, slop-detection, completeness, clarity, checker]
---

# Design Quality Check

## When to Use

Use this skill when:

- Running the final quality gate before design review submission
- Invoked as the first quality gate step in design review workflows
- Engineer asks to check doc quality, detect filler language, or verify KISS/YAGNI compliance

## Steps

1. **Load document**: accept a markdown file path or inline content. Report section count and approximate word count.

2. **Structural completeness check**: verify the document contains all required outside-in sections:
   - Problem / Background
   - Requirements
   - Solution Overview
   - How It Works (with at least one diagram reference)
   - Implementation Details / Plan
   - Architecture Decision Records (at least one ADR if decisions were made)

   Flag each missing required section as an issue of type `missing_section`.

3. **Slop detection**: scan every paragraph for the following issue types:

   | Type                    | Examples                                                                                                   | Severity  |
   | ----------------------- | ---------------------------------------------------------------------------------------------------------- | --------- |
   | `filler_phrases`        | "it is worth noting", "needless to say", "as mentioned above", "in order to", "it should be noted that"    | MINOR     |
   | `hedge_words`           | "might", "could potentially", "may or may not", "somewhat", "fairly" (when used to avoid commitment)       | MINOR     |
   | `unsupported_claims`    | Performance/latency/cost assertions with no evidence URL or measurement                                    | IMPORTANT |
   | `passive_voice_overuse` | >30% passive constructions in a section                                                                    | MINOR     |
   | `circular_reasoning`    | Justification restates the claim without adding evidence (e.g., "we chose X because X is the best choice") | IMPORTANT |
   | `yagni_violation`       | Features, abstractions, or extensibility points not required by stated requirements                        | IMPORTANT |
   | `missing_section`       | Required section absent                                                                                    | IMPORTANT |

4. **Complexity scoring**: for each decision or design choice, check:
   - Is the simplest option chosen, or is complexity justified by a stated requirement?
   - Are there abstractions with no current use case?

   Flag unjustified complexity as `yagni_violation`.

5. **Score**: compute overall score 1–5:
   - 5: No issues
   - 4: Only MINOR issues (≤3)
   - 3: MINOR issues (>3) or IMPORTANT issues (1–2)
   - 2: IMPORTANT issues (3+), no missing required sections
   - 1: IMPORTANT issues (3+) AND one or more missing sections (structural gaps)

6. **Output**: return:

   ```
   Quality Score: N/5
   Issues: {N} IMPORTANT, {N} MINOR
   [For each issue: location (section + approximate line), type, suggestion]
   ```

## Rubric

| Score | Meaning                                           | Gate                        |
| ----- | ------------------------------------------------- | --------------------------- |
| 5     | No issues                                         | Review-ready                |
| 4     | Only MINOR issues (3 or fewer)                    | Review-ready with notes     |
| 3     | More than 3 MINOR issues, or 1–2 IMPORTANT issues | Advance with revision notes |
| 2     | 3 or more IMPORTANT issues, no missing required sections     | Significant revision needed |
| 1     | 3 or more IMPORTANT issues plus one or more missing sections | Rewrite required            |

**Quality gate:** Score ≥ 3 required to advance to adversarial review. Score < 3 blocks advancement and requires revision.

## Pitfalls

- Do not flag technical hedging that is accurate (e.g., "Lambda cold starts typically add 100–500ms" is not a hedge; it is a range).
- Do not flag passive voice in formal definitions or standards references.
- Do not penalize brevity. A short, complete doc scores higher than a verbose, incomplete one.
- `unsupported_claims` applies only to quantitative assertions (latency, cost, throughput). Qualitative design rationale does not require evidence URLs.

## Verification

After scoring, confirm:

- [ ] Every IMPORTANT issue has a concrete suggestion for resolution
- [ ] Score reflects the worst issue type present (one IMPORTANT issue cannot yield score 5)
- [ ] Missing required sections are flagged even if the document is otherwise well-written
