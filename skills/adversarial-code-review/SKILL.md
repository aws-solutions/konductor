---
name: adversarial-code-review
description: 'Targets the three gap categories standard review misses: information disclosure, data integrity, and schema validation. Use for a second pass after code review, as the checker in a maker-checker cycle, or before submitting a change to auth, data writes or external APIs.'
version: 1.1.1
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

The full adversarial pull request review (`k-adversarial-pull-request-review`: four `k-developer` generator passes, then this skill's Validator Mode in a fresh `k-architect` session) is coordinated by the orchestrator, which alone declares that SOP. Asked for it directly, say to run it through `konductor` instead of running the passes yourself.

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

Each lens has its own pass skill, which is the single source for that lens's checklist, codebase-awareness rules, out-of-scope exemptions, and severity guidance. The coordinator SOP `k-adversarial-pull-request-review` spawns the three lens passes as parallel generator passes and then a fourth reuse pass, each in its own session. Per the Usage note above, this skill never runs a pass itself.

| Lens                                   | Pass skill                               | Covers                                                                                                          |
| -------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Security / information disclosure      | `adversarial-code-review-pass-security`  | Stack traces and internal details reaching callers, logged payloads, unvalidated tokens and input, secrets, IAM |
| Data integrity / failure modes         | `adversarial-code-review-pass-integrity` | Non-atomic multi-item writes, unconditional overwrites, missing condition checks, untested write paths          |
| Schema / validation completeness       | `adversarial-code-review-pass-schema`    | Breaking contract changes, missing guards and defaults, validate-then-act ordering, unwired handlers            |

## Quality Gate

Severity for each finding comes from the pass skill that owns its lens. Running directly, with no pass skill loaded, rate against the list below. It is the union of the three pass skills' severity guidance, each item taken at the strictest rating any pass gives it, so a direct run rates the same diff no lower than a pass does. A CRITICAL finding blocks approval; IMPORTANT should be fixed before merge; SUGGESTION is optional.

**CRITICAL:**

- A stack trace, internal ID, internal error code, or raw exception message reaching a caller
- Unvalidated input reaching a query, path, or command
- A hardcoded credential, API key, or embedded token
- A widened IAM policy, grant, or trust relationship on a production role
- A multi-item mutation that has to succeed or fail as a unit, with no transaction
- An unconditional overwrite on a resource that can see concurrent writes
- A delete or overwrite on an error path with no rollback or compensation
- A breaking change to a shipped API or data model with no migration path
- A field the write path requires that the read path does not default, leaving existing records unparseable

**IMPORTANT:**

- A request payload, response body, or auth header logged at info or debug level
- A write path with no test exercising the mutation
- A map or optional access with no existence guard
- A new field missing validation or a default in one or more entry points
- Validation that runs after the side effect it is meant to guard
- A handler or route registered but not wired into the router, authorizer, or middleware
- A retry of a non-idempotent operation with no idempotency key
- Reimplementing an existing transaction or batch-write helper, bypassing shared validation middleware or a schema validator, bypassing an established error-mapping layer, or decoding an opaque token inline where a utility exists

**SUGGESTION:**

- An abstraction boundary leak that does not itself expose sensitive data
- A condition expression present but weaker than warranted
- A log field that could carry something sensitive under some inputs
- An extra query where a write's return value would serve
- An enum, error code, or status name change that consumers may pattern-match on

For a finding the list does not name, rate it CRITICAL when it discloses internal detail to a caller, corrupts or loses data, or lets unvalidated input reach a query; IMPORTANT when a guarantee is weakened but still mostly held; SUGGESTION otherwise.

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. If invoked directly (not via SOP): Ask: "Fix these issues? [y/n]"

## Output Format

Each finding must include:

```
[SEVERITY] Category — file:line
Problem: {what is wrong and why it is a risk}
Fix: {concrete suggested change}
```
