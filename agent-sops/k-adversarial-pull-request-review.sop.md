# Adversarial Pull Request Review

## Overview

Runs an adversarial review of code changes. Not a replacement for standard code review. It runs after standard review to catch what style and quality reviewers miss: information disclosure, data integrity failures, and schema/validation gaps.

Structure: three independent generator passes (security, integrity, schema), an independent reuse pass, a validator (checker) pass, and a historical-issues filter. Generator and checker independence is what keeps false positives out of the review.

## Parameters

- **diff_input** (required, see the `pr_url` note below): The changes to review. Accepts:
  - Git diff output (`git diff` or `git diff HEAD~N`)
  - File paths to read directly
  - Raw pull request diff content
- **pr_url** (optional, context only): Pull request URL. **This SOP does not fetch a diff from `pr_url`.** It assumes no tool that resolves an arbitrary pull-request URL to its diff content (see Roles); `diff_input` MUST always be supplied directly, even when `pr_url` is also given. When `pr_url` is present, Step 0 still uses it to look up linked issues or design docs referenced in the pull request description via generic `web_fetch`.
- **output_file** (optional, default: `adversarial-review-report.md`): Path to write the findings report

**Constraints for parameter acquisition:**

- You MUST have `diff_input`; if it is not provided, ask for it before proceeding, even when `pr_url` is present (this SOP does not fetch a diff from `pr_url`, see the `pr_url` note above)
- You MUST NOT ask for `output_file`; use the default and proceed
- If `diff_input` is file paths, You MUST verify the files exist before proceeding
- If `pr_url` is provided, You MAY use it in Step 0 to read the pull request's own description for linked issues/docs, but You MUST NOT attempt to derive `diff_input` from it

## Roles

- **Generator**: Run one isolated pass for each of `adversarial-code-review-pass-security`, `-integrity`, and `-schema`, plus the fresh reuse pass in Step 3. Each pass produces candidate findings.
- **Validator / Checker**: Run `adversarial-code-review` in Validator Mode. The checker MUST NOT have authored any candidate finding. When generic subagents are available, run the checker in a separate subagent. Otherwise, run it as a separate pass started without the generator passes' conclusions or reasoning beyond their returned findings, and explicitly adopt the validator persona. See Step 4.
- **Historical filter**: this SOP invokes `historical-issues-registry` in load and filter phases. **Unavailable without a platform mapping:** `historical-issues-registry` is an abstract skill. Per its own Usage section, it is not run standalone and needs a concrete mapping for the code review platform in use. This package provides no such mapping, and this SOP assumes no tool that reads a pull request's prior review comment threads. This is why Steps 0.5 and 5 below are documented no-ops when no mapping is available, rather than silently returning empty results. When the caller provides a concrete mapping and a tool that reads prior review threads, they run as `historical-issues-registry` describes. The same assumption means an arbitrary `pr_url` cannot be resolved to its diff content. See the Parameters section's `pr_url` note and Step 0 for how that separate gap is handled.

Independence rests on separate execution context or separate isolated passes, no shared conclusions between generator passes, a checker that did not author the findings, and the mechanical literal-diff-verification rule inside the checker skill.

**Isolation modes.** Full independence needs a separate execution context per pass, which only generic subagents provide. When the runtime offers them, this SOP runs in **isolated mode** and every independence rule below holds as written. When it does not, the SOP runs in **single-context mode**: one agent runs every pass in the same conversation and cannot truly forget an earlier pass, so separate passes and the validator persona reduce shared bias but do not remove it. In single-context mode You MUST still follow every step, MUST record `Isolation: single-context (generator and checker independence reduced)` in the report, and MUST present the verdict as advisory: an APPROVE in this mode does not stand in for an independent review. The independence invariants in the Quality Gate apply in full to isolated mode and as best-effort rules in single-context mode.

## Steps

### 0. Context Ramp-Up

Before reviewing the diff, autonomously gather the context needed to produce codebase-aware findings rather than generic ones.

**Constraints:**

- If `pr_url` is provided without `diff_input`, You MUST NOT attempt to fetch the pull request diff from it. This SOP does not fetch a diff from `pr_url` (see Parameters). Ask for `diff_input` directly instead
- You MUST search for linked issues, design docs, or referenced documentation in the diff or commit message and read them
- You MUST search the codebase for existing patterns related to the changed files: error-mapping layers, transaction helpers, validation middleware, pagination utilities
- You MUST limit ramp-up to: the pull request description and linked issues (max 3), directly referenced design docs (max 3), and a targeted codebase search for patterns in the changed files only
- You MUST spend no more than one context-gathering pass per source; do not recursively follow links
- You MUST NOT block on missing context; if a linked doc is unavailable, note it and proceed
- You MUST NOT modify any files or run builds/tests

**Expected Output:** Context summary: linked docs read, related patterns found

### 0.5. Load Prior Review State

**Without a concrete platform mapping, this step is skipped. It is a documented no-op, not a silent one.** This package ships no such mapping (see Roles above): `historical-issues-registry` is an abstract skill that cannot fetch prior review state without one, and this SOP assumes no tool that reads a pull request's prior review comment threads. Calling the skill's load phase without a concrete mapping would have no way to fetch real thread state; an unguarded call would silently return an empty list, indistinguishable from "no prior revisions," which misrepresents the reason nothing was loaded. When a concrete mapping and a tool that reads prior review threads are available, run the load phase as `historical-issues-registry` describes instead.

**Constraints:**

- You MUST NOT call `historical-issues-registry`'s load phase without a concrete platform mapping; skip it outright
- When you skip it, you MUST note in the context summary that historical filtering is unavailable (no concrete platform mapping), not that there were no prior revisions
- You MUST NOT treat the absence of a fingerprint list in Step 5 as "no prior revisions"; it means "not checked," not "nothing found"

**Expected Output:** Note recorded: "historical filtering unavailable: no concrete platform mapping"

### 1. Ingest Diff

Resolve `diff_input` to reviewable content.

**Constraints:**

- You MUST accept git diff output, file paths, or raw diff content as `diff_input`
- For file paths: You MUST read each file directly
- For git diff strings: You MUST parse them as-is without running any git commands
- You MUST exclude binary files, lock files, build artifacts, and `.js.map` files
- You MUST report the file count and approximate lines changed
- If the resolved diff is empty, You MUST inform the user and stop
- You MUST NOT modify any files or run builds/tests

**Expected Output:** List of changed files with content, total file count, approximate lines changed

### 2. Parallel Review Passes

Run three independent passes, one per pass skill. When the runtime offers generic subagents, run each pass in a separate subagent and launch them in parallel. Otherwise, run them as separate sequential passes, starting each without the other passes' conclusions.

**Constraints:**

- You MUST run the generator role three times, each loading exactly one pass skill:
  - Security pass → `adversarial-code-review-pass-security`
  - Data integrity pass → `adversarial-code-review-pass-integrity`
  - Schema/contract pass → `adversarial-code-review-pass-schema`
- Each subagent MUST receive the ingested diff and the Step 0 context summary
- Each subagent MUST be framed neutrally; the prompt says "review through the lens of X", never "check if X is weak"
- You MUST NOT share findings between the three passes; they run independently
- You MUST wait for all three passes to return before proceeding

**Expected Output:** Three findings lists, one per pass, each with severity, file:line, problem, and fix per entry

### 3. Reuse Pass (Generator Phase)

Merge the three findings lists, then check for missed reuse opportunities not surfaced within any single pass, as a fourth generator-persona pass, not as coordinator commentary.

**Constraints:**

- You MUST concatenate the three Step 2 findings lists preserving each finding's pass origin
- You MUST run the generator role once more as a fresh, independent pass to look for cross-pass reuse, framed neutrally ("review through the lens of cross-pattern reuse: identify any existing utility, pattern, or helper that the diff reimplements or bypasses, or that would resolve two or more of the findings below")
- When generic subagents are available, You MUST run the reuse pass in a separate generic subagent. Otherwise, You MUST run it as a separate pass and MUST NOT reuse its authoring context for Step 4
- This reuse pass MUST receive: the ingested diff, the Step 0 context summary, and the three Step 2 findings lists
- Any findings this pass produces MUST be tagged with pass origin `reuse` and appended to the consolidated list. They are ordinary candidate findings like the other three passes' output; they get no exemption from Step 4's checker rules
- You MUST assign IMPORTANT to a reuse finding that flags inline reimplementation or bypass of an existing shared utility, transaction/batch helper, validation middleware, error-mapping layer, or pagination token utility. For a reuse finding outside that list, apply the severity guidance from whichever of `adversarial-code-review-pass-security`/`-integrity`/`-schema` most closely matches the concern it raises
- The reuse pass MUST be independent from the checker and MUST NOT share its authoring context with Step 4
- You MUST NOT re-run the individual Step 2 passes' own checks; this step only adds cross-pass reuse findings

**Expected Output:** Consolidated findings list (security, integrity, schema, and reuse pass origins)

### 4. Checker Phase — Validate Findings

Run `adversarial-code-review` in Validator Mode to filter the consolidated findings. The checker MUST NOT have authored any candidate finding. When the runtime offers generic subagents, run the checker in a separate subagent that receives only the diff, context summary, and consolidated findings. Otherwise, run a separate checker pass started without the generator passes' conclusions or reasoning beyond their returned findings, and explicitly adopt the validator persona.

**Constraints:**

- You MUST run `adversarial-code-review` in Validator Mode with a checker persona that did not author the candidate findings
- You MUST NOT reuse or reference the Step 2/3 passes' internal reasoning beyond the findings list and context summary they returned; evaluate each finding on its own terms
- You MUST provide the checker with: the ingested diff, the Step 0 context summary, and the consolidated findings list. The context summary lets the checker verify Step 3's reuse-pass findings against the existing utility or pattern they cite, without exempting any finding from the checker's ordinary verification rules
- The checker step MUST tag each finding `KEEP` or `REJECT` with a one-line reason for each REJECT
- You MUST drop every `REJECT` finding from the list before proceeding
- You MUST NOT propose new findings while acting as the checker; it is a filter, not a reviewer

**Expected Output:** Filtered findings list containing only `KEEP` entries; rejection log with reasons

### 5. Historical Filter

**When Step 0.5 was skipped, skip this step too: there is no fingerprint list to filter against (see Step 0.5).** Pass the checker-approved findings straight through to Step 6 unchanged.

**Constraints:**

- You MUST NOT call `historical-issues-registry`'s filter phase when Step 0.5 was skipped; skip it outright and pass the checker-approved findings through to Step 6 unchanged
- When you skip it, you MUST note in the summary that historical filtering was unavailable, not that zero matches were found

**Expected Output:** Checker-approved findings list passed through unchanged; note recorded that historical filtering was unavailable

### 6. Verdict

Consolidate the surviving findings and produce a verdict.

**Constraints:**

- You MUST deduplicate findings that reference the same file:line and root cause, retaining only the highest severity
- You MUST count findings by severity: CRITICAL, IMPORTANT, SUGGESTION
- You MUST assign the verdict as follows:
  - Any finding with severity CRITICAL → **REQUEST CHANGES**
  - No CRITICAL-severity finding, one or more findings with severity IMPORTANT → **APPROVE WITH COMMENTS**
  - No CRITICAL-severity finding, no IMPORTANT-severity finding → **APPROVE**
- You MUST write the full report to `output_file` structured as:

  ```markdown
  # Adversarial Pull Request Review Report

  Date: {date}
  Verdict: {APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES}
  Findings: {N} CRITICAL, {N} IMPORTANT, {N} SUGGESTION
  Filtered by checker: {N}
  Isolation: {isolated | single-context (generator and checker independence reduced)}
  Historical filtering: unavailable (no concrete platform mapping; see Step 0.5)

  ## Critical Findings

  ## Important Findings

  ## Suggestions

  ## Filter Log
  ```

  Every surviving finding goes in exactly one severity section (`## Critical Findings` / `## Important Findings` / `## Suggestions`). Without a concrete platform mapping, Steps 0.5 and 5 are skipped no-ops (see Step 0.5); no finding is ever tagged "regressed since ..." or "carried over from ...", so there is no separate historical-section machinery for a finding to land in instead of its own severity section.

- You MUST NOT print the full report in your response; reference the file path
- You MUST display: verdict, isolation mode, finding counts by severity, checker rejection count, and a one-line description of each CRITICAL-severity finding

**Expected Output:** Report written to `output_file`, summary presented to user

## Quality Gate

**CRITICAL findings block approval.** The verdict MUST be REQUEST CHANGES if any CRITICAL finding survives Steps 4 and 5.

**Independence invariants MUST hold** (in full in isolated mode; as best-effort rules in single-context mode, which the report states; see Isolation modes above):

- The checker persona MUST differ from the generator persona and MUST NOT have authored any candidate finding
- The checker MUST NOT have run a generator pass earlier in this same review
- The three review passes MUST run with no shared conclusions between them. They SHOULD run in parallel generic subagents when available; otherwise they MUST run as separate isolated passes
- Step 3's reuse-pass findings MUST originate from a fresh generator pass, never from the checker
- The checker MUST NOT propose new findings; Validator Mode is filter-only
