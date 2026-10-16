# Adversarial Pull Request Review

## Overview

Runs an adversarial review of code changes. Not a replacement for standard code review — runs after standard review to catch what style and quality reviewers miss: information disclosure, data integrity failures, and schema/validation gaps.

Structure: one coordinator (this SOP), three parallel pass subagents (security, integrity, schema), a validator (checker) phase the coordinator runs itself, and a historical-issues filter. Persona independence between generator and checker is what keeps false positives out of the CR.

## Parameters

- **diff_input** (required on ASDLC — see the `pr_url` note below): The changes to review. Accepts:
  - Git diff output (`git diff` or `git diff HEAD~N`)
  - File paths to read directly
  - Raw pull request diff content
- **pr_url** (optional, context only on ASDLC): Pull request URL. **Diff auto-fetch from `pr_url` is unsupported on ASDLC** — `k-architect` has no tool that resolves an arbitrary pull-request URL to its diff content (see Roles); `diff_input` MUST always be supplied directly, even when `pr_url` is also given. When `pr_url` is present, Step 0 still uses it to look up linked issues or design docs referenced in the pull request description via generic `web_fetch`.
- **output_file** (optional, default: `adversarial-review-report.md`): Path to write the findings report

**Constraints for parameter acquisition:**

- You MUST have `diff_input` — if it is not provided, ask for it before proceeding, even when `pr_url` is present (diff auto-fetch from `pr_url` is unsupported on ASDLC — see the `pr_url` note above)
- You MUST NOT ask for `output_file` — use the default and proceed
- If `diff_input` is file paths, You MUST verify the files exist before proceeding
- If `pr_url` is provided, You MAY use it in Step 0 to read the pull request's own description for linked issues/docs, but You MUST NOT attempt to derive `diff_input` from it

## Roles

- **Generator** (per-pass subagent) — `k-developer` invoked with one of `adversarial-code-review-pass-security`, `-integrity`, or `-schema`, or (in Step 3) as a fresh reuse-pass subagent. Native code-diff lens, produces candidate findings.
- **Validator / Checker** — `k-architect`, running `adversarial-code-review` in Validator Mode. `k-architect` is also this SOP's coordinator, and only `k-architect` registers this SOP (`k-developer`/`konductor`/`konductor-mux-orchestrator`/`konductor-cmux-orchestrator` do not invoke it directly), so there is no separate agent that could spawn a checker named `k-architect` as a subagent without a self-reference — an agent has no mechanism to launch a fresh instance of its own name via the `subagent` tool. Independence instead comes from persona: the coordinator never ran as a generator pass (that role is `k-developer`, spawned separately in Step 2/3), so the coordinator's own context is already untainted by having generated any of the findings it is about to filter. See Step 4.
- **Historical filter** — this SOP invokes `historical-issues-registry` in load and filter phases. **Currently unavailable on ASDLC:** `historical-issues-registry` is an abstract skill — per its own Usage section, it is "Not run standalone... provide the concrete mapping for your platform in a delta layer that extends this skill." No such delta exists for ASDLC today. `k-architect`'s own toolset is `@builtin`, `subagent`, and `@aws-mcp` only (see `k-architect.agent-spec.json`) — none of these expose an API for reading a pull request's prior review comment threads, and no other tooling capable of providing one is available to this agent in this package. This is why Steps 0.5 and 5 below are documented as no-ops rather than silently returning empty results. The same absence of a pull-request-reading tool also means `k-architect` cannot resolve an arbitrary `pr_url` to its diff content either — see the Parameters section's `pr_url` note and Step 0 for how that separate gap is handled.

Independence rests on three properties held together: different persona per role (generator is `k-developer`, checker is `k-architect` — never the same agent grading its own findings), no context inherited from a generator pass, and the mechanical literal-diff-verification rule inside the checker skill.

## Steps

### 0. Context Ramp-Up

Before reviewing the diff, autonomously gather the context needed to produce codebase-aware findings rather than generic ones.

**Constraints:**

- If `pr_url` is provided without `diff_input`, You MUST NOT attempt to fetch the pull request diff from it — diff auto-fetch from `pr_url` is unsupported on ASDLC (see Parameters). Ask for `diff_input` directly instead
- You MUST search for linked issues, design docs, or referenced documentation in the diff or commit message and read them
- You MUST search the codebase for existing patterns related to the changed files: error-mapping layers, transaction helpers, validation middleware, pagination utilities
- You MUST limit ramp-up to: the pull request description and linked issues (max 3), directly referenced design docs (max 3), and a targeted codebase search for patterns in the changed files only
- You MUST spend no more than one context-gathering pass per source — do not recursively follow links
- You MUST NOT block on missing context — if a linked doc is unavailable, note it and proceed
- You MUST NOT modify any files or run builds/tests

**Expected Output:** Context summary — linked docs read, related patterns found

### 0.5. Load Prior Review State

**On ASDLC, this step is always skipped — it is a documented no-op, not a silent one.** No concrete platform delta exists for ASDLC (see Roles above): `historical-issues-registry` is an abstract skill that cannot fetch prior review state without one, and `k-architect`'s own toolset (`@builtin`, `subagent`, `@aws-mcp`) exposes no API for reading a pull request's prior review comment threads. Calling the skill's load phase without a concrete mapping would have no way to fetch real thread state — an unguarded call would silently return an empty list, indistinguishable from "no prior revisions," which misrepresents the reason nothing was loaded.

**Constraints:**

- You MUST NOT call `historical-issues-registry`'s load phase on ASDLC — skip it outright
- You MUST note in the context summary that historical filtering is unavailable for ASDLC (no concrete platform delta), not that there were no prior revisions
- You MUST NOT treat the absence of a fingerprint list in Step 5 as "no prior revisions" — it means "not checked," not "nothing found"

**Expected Output:** Note recorded: "historical filtering unavailable for ASDLC — no concrete platform delta"

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

Spawn three subagents in parallel, one per pass. Send them in a single message with three tool uses so they run concurrently.

**Constraints:**

- You MUST spawn `k-developer` (generator role) three times, each loading exactly one pass skill:
  - Security pass → `adversarial-code-review-pass-security`
  - Data integrity pass → `adversarial-code-review-pass-integrity`
  - Schema/contract pass → `adversarial-code-review-pass-schema`
- Each subagent MUST receive the ingested diff and the Step 0 context summary
- Each subagent MUST be framed neutrally — the prompt says "review through the lens of X", never "check if X is weak"
- You MUST NOT share findings between the three passes — they run independently
- You MUST wait for all three passes to return before proceeding

**Expected Output:** Three findings lists — one per pass, each with severity, file:line, problem, and fix per entry

### 3. Reuse Pass (Generator Phase)

Merge the three findings lists, then check for missed reuse opportunities not surfaced within any single pass — as a fourth generator-persona pass, not as coordinator commentary.

**Constraints:**

- You MUST concatenate the three Step 2 findings lists preserving each finding's pass origin
- You MUST spawn `k-developer` (generator role) once more, as a fresh subagent, to look for cross-pass reuse — framed neutrally ("review through the lens of cross-pattern reuse: identify any existing utility, pattern, or helper that the diff reimplements or bypasses, or that would resolve two or more of the findings below")
- This reuse-pass subagent MUST receive: the ingested diff, the Step 0 context summary, and the three Step 2 findings lists
- Any findings this pass produces MUST be tagged with pass origin `reuse` and appended to the consolidated list. They are ordinary candidate findings like the other three passes' output — they get no exemption from Step 4's checker rules
- You MUST assign IMPORTANT to a reuse finding that flags inline reimplementation or bypass of an existing shared utility, transaction/batch helper, validation middleware, error-mapping layer, or pagination token utility. For a reuse finding outside that list, apply the severity guidance from whichever of `adversarial-code-review-pass-security`/`-integrity`/`-schema` most closely matches the concern it raises
- You MUST NOT have the coordinator itself originate reuse findings — sourcing findings from the coordinator, rather than from a generator-persona subagent, breaks the generator/checker independence invariant this SOP relies on
- You MUST NOT re-run the individual Step 2 passes' own checks — this step only adds cross-pass reuse findings

**Expected Output:** Consolidated findings list (security, integrity, schema, and reuse pass origins)

### 4. Checker Phase — Validate Findings

You (the coordinator, `k-architect`) now switch roles and run `adversarial-code-review` in Validator Mode yourself, filtering the consolidated findings. No subagent spawn is needed or possible here — the checker persona is `k-architect`, which is your own name, and an agent has no mechanism to spawn a fresh instance of itself via the `subagent` tool. Independence holds because you never ran a generator pass (Step 2/3 spawned `k-developer`, not you) — your context is already free of having generated any of these findings.

**Constraints:**

- You MUST run `adversarial-code-review` in Validator Mode directly (no subagent spawn) — this is a different persona from the `k-developer` generators, not a self-check of your own output
- You MUST NOT reuse or reference the Step 2/3 subagents' internal reasoning beyond the findings list and context summary they returned — evaluate each finding on its own terms
- You MUST provide yourself, as the checker, with: the ingested diff, the Step 0 context summary, and the consolidated findings list. The context summary lets the checker verify Step 3's reuse-pass findings against the existing utility or pattern they cite, without exempting any finding from the checker's ordinary verification rules
- The checker step MUST tag each finding `KEEP` or `REJECT` with a one-line reason for each REJECT
- You MUST drop every `REJECT` finding from the list before proceeding
- You MUST NOT propose new findings while acting as the checker — it is a filter, not a reviewer

**Expected Output:** Filtered findings list containing only `KEEP` entries; rejection log with reasons

### 5. Historical Filter

**On ASDLC, this step is always skipped — Step 0.5 never produces a fingerprint list to filter against (see Step 0.5).** Pass the checker-approved findings straight through to Step 6 unchanged.

**Constraints:**

- You MUST NOT call `historical-issues-registry`'s filter phase on ASDLC — skip it outright and pass the checker-approved findings through to Step 6 unchanged
- You MUST note in the summary that historical filtering was unavailable, not that zero matches were found

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
  Historical filtering: unavailable for ASDLC (no concrete platform delta — see Step 0.5)

  ## Critical Findings

  ## Important Findings

  ## Suggestions

  ## Filter Log
  ```

  Every surviving finding goes in exactly one severity section (`## Critical Findings` / `## Important Findings` / `## Suggestions`). Steps 0.5 and 5 are always-skipped no-ops on ASDLC today (see Step 0.5) — no finding is ever tagged "regressed since ..." or "carried over from ...", so there is no separate historical-section machinery for a finding to land in instead of its own severity section.

- You MUST NOT print the full report in your response — reference the file path
- You MUST display: verdict, finding counts by severity, checker rejection count, and a one-line description of each CRITICAL-severity finding

**Expected Output:** Report written to `output_file`, summary presented to user

## Quality Gate

**CRITICAL findings block approval** — the verdict MUST be REQUEST CHANGES if any CRITICAL finding survives Steps 4 and 5.

**Independence invariants MUST hold:**

- Generator persona (`k-developer`) MUST differ from checker persona (`k-architect`) — the checker is the coordinator itself switching roles in Step 4, never a `k-developer` self-check
- The checker MUST NOT have run a generator pass earlier in this same review — Step 2/3's generator role is always `k-developer`, spawned fresh, never the coordinator
- The three review passes MUST run in parallel with no shared context between them
- Step 3's reuse-pass findings MUST originate from a generator-persona subagent (`k-developer`), never from the coordinator itself
- The checker MUST NOT propose new findings — Validator Mode is filter-only
