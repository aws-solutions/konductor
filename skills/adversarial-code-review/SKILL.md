---
name: adversarial-code-review
description: 'Targets the three gap categories standard review misses: information disclosure, data integrity, and schema validation. Use for a second-pass review after standard code review, as the checker in a maker-checker cycle, or before submitting a change that touches auth, data writes, or external API boundaries.'
version: 1.1.0
tags:
  [
    skill,
    security,
    code-review,
    adversarial,
    data-integrity,
    schema-validation,
    checker,
  ]
---

# Adversarial Code Review

## Overview

Takes the stance of a security-focused architect arguing against approval. Does not duplicate what style or quality reviewers catch — focuses exclusively on the three gap categories where standard review consistently misses: security/information disclosure, data integrity failure modes, and schema/validation completeness. Every finding must make a case for blocking or conditioning approval.

## Usage

Use this skill when:

- Running a second-pass review after standard code review is complete
- Spawned by the orchestrator as the checker in a maker-checker cycle
- Reviewing a change before submission when the change touches auth, data writes, or external API boundaries

## Modes

This skill operates in two modes. The invoker selects the mode; the two modes must not be mixed in one pass.

### Generator Mode (Maker)

The default. Read the diff and produce findings through each of the three review lenses in `Review Lenses`. Findings may be incomplete or noisy — that is expected. A different persona in Validator Mode will filter them before they reach the CR.

### Validator Mode (Checker)

You are a filter. Never propose new findings in this mode.

For each proposed finding you review:

- Reject unless the flagged code text appears verbatim on a changed or context line in the diff for the specified file. Line-number drift within a hunk is tolerated; content invention is not.
- Reject vague suggestions (`consider improving this`, `look into this`, `may want to review`) that do not name a specific defect and a specific fix.
- Reject speculation about code outside the visible diff — you cannot review what you cannot see.
- Reject style-only nits already caught by lint, formatter, or type-checker.
- Reject praise of correct code — it is not a finding.
- Reject duplicates: if two findings reference the same file:line and the same root cause, keep the highest-severity one and drop the rest.
- When in doubt, reject. A false positive posted to a CR wastes reviewer attention and erodes trust in the whole review pipeline. A missed issue costs less.

Output for each finding: `KEEP` with the finding unchanged, or `REJECT` with a one-line reason drawn from the list above.

**Scope note for Validator Mode:** the two rule lists above are exhaustive for this mode. Everything below (`## Review Lenses`, the pass skills it points to, `## Quality Gate`, and the closing "Ask: 'Fix these issues?'" line) is Generator Mode content. In Validator Mode, treat it as reference only (e.g. to recognize which lens a candidate finding belongs to); it adds no further rejection criteria beyond the list above, it never authorizes proposing a new finding, and the closing offer-to-fix line does not apply — Validator Mode never offers to fix anything, it only returns `KEEP`/`REJECT`.

## Review Lenses

Each lens has its own pass skill, which is the single source for that lens's checklist, codebase-awareness rules, out-of-scope exemptions, and severity guidance. In Generator Mode, load all three and apply each to the diff. A coordinator SOP such as `k-adversarial-pull-request-review` runs them as parallel subagents instead.

When you run the passes inline, you are the coordinator: merge findings that share a file:line and root cause, and keep the highest severity. A direct run is Generator Mode only. The Validator Mode filter does not run on its output, because the two modes must not be mixed in one pass; the merged findings go to the user with the closing "Fix these issues?" prompt. To filter them, run Validator Mode separately, as a different persona, the way the coordinator SOP does.

| Lens                                   | Pass skill                               | Covers                                                                                                          |
| -------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Security / information disclosure      | `adversarial-code-review-pass-security`  | Stack traces and internal details reaching callers, logged payloads, unvalidated tokens and input, secrets, IAM |
| Data integrity / failure modes         | `adversarial-code-review-pass-integrity` | Non-atomic multi-item writes, unconditional overwrites, missing condition checks, untested write paths          |
| Schema / validation completeness       | `adversarial-code-review-pass-schema`    | Breaking contract changes, missing guards and defaults, validate-then-act ordering, unwired handlers            |

## Quality Gate

Severity for each finding comes from the pass skill that owns its lens. A CRITICAL finding blocks approval; IMPORTANT should be fixed before merge; SUGGESTION is optional.

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. If invoked directly (not via SOP): Ask: "Fix these issues? [y/n]"

## Output Format

Each finding must include:

```
[SEVERITY] Category — file:line
Problem: {what is wrong and why it is a risk}
Fix: {concrete suggested change}
```
