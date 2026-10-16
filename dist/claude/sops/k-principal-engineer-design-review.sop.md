# Principal Engineer Design Review

## Overview

This SOP runs a pre-submission quality gate on a design document before it goes to a Principal Engineer for review. It combines slop detection, architecture principles evaluation, and an adversarial review loop to eliminate the most common review comments before the human reviewer sees the document.

Adversarial review uses the `adversarial-design-review` skill.

This SOP uses `design-quality-check` for the slop and quality gate and `argumentation-reference` for fallacy checking. The adversarial loop runs a maximum of 5 rounds and exits when 0 CRITICAL + 0 IMPORTANT + fewer than 3 MINOR findings remain.

## Parameters

- **doc_input** (required): The design document to review. Accepts:
  - File path (e.g., `docs/design/order-processing.md`)
  - Inline markdown content
  - Current context (say "review this design doc" with the doc in context)
- **output_file** (optional, default: `<doc-name>-principal-engineer-review.md` in the same directory as the input doc, or `docs/design/principal-engineer-review.md` if invoked without a path): Path to write the findings report.

**Constraints for parameter acquisition:**

- You MUST have `doc_input` — if not provided, ask for it before proceeding
- You MUST NOT ask for `output_file` — use the default and proceed
- If `doc_input` is a file path, You MUST verify the file exists before proceeding

## Steps

### 0. Load Document

Resolve `doc_input` to reviewable content.

**Constraints:**

- You MUST report the document title, section count, and approximate word count
- You MUST extract all verifiable claims (AWS service assertions, performance numbers, cost estimates) and all design decisions for use in subsequent steps
- You MUST NOT modify any files or run builds/tests
- You MUST complete this step before proceeding to Step 1

**Expected Output:** Document loaded, claim list, decision list, section inventory

### 1. Quality Gate (design-quality-check)

Run the `design-quality-check` skill on the full document.

**Constraints:**

- You MUST apply the `design-quality-check` skill
- You MUST check structural completeness (required outside-in sections present)
- You MUST run slop detection across all issue types: `filler_phrases`, `hedge_words`, `unsupported_claims`, `passive_voice_overuse`, `circular_reasoning`, `yagni_violation`, `missing_section`
- You MUST compute the quality score (1–5)
- If score < 3, You MUST stop the SOP, present the issues to the engineer, and request revision before continuing — do not proceed to Step 2 with a score < 3
- You MUST NOT proceed to Step 2 until quality score ≥ 3

**Expected Output:** Quality score, IMPORTANT issues list, MINOR issues list

### 2. Architecture Principles Gate (design-evaluation)

Run the `design-evaluation` skill across 10 production readiness dimensions.

**Constraints:**

- You MUST apply the `design-evaluation` skill
- You MUST evaluate all 10 dimensions: template adherence, scalability, security, maintainability, resilience, testability, operational readiness, cost optimization, API design quality, data model quality
- You MUST classify each finding as CRITICAL, IMPORTANT, or MINOR using the same severity definitions as the adversarial review
- You MUST compute a confidence score per section: average of the dimension scores (1–5 each)
- Sections with average score < 3 are flagged for adversarial focus in Step 3

**Expected Output:** Dimension scores, per-section confidence scores, classified findings list

### 3. Adversarial Review Loop (max 5 rounds)

Run adversarial review of all design decisions, trade-offs, and architectural choices.

**Constraints:**

- You MUST apply the `adversarial-design-review` skill
- Before the first round, You MUST resolve `deliberation-panel`'s `consent_confirmed` parameter once — either by obtaining the engineer's explicit opt-in per `adversarial-design-review`'s Deliberation Panel Confirmation Gate, or by proceeding single-voice without the panel. You MUST carry the resulting `consent_confirmed` value through every round of this loop — do not re-prompt or re-resolve it per round.
- You MUST apply the `argumentation-reference` skill and run fallacy checking to every decision justification
- You MUST classify all findings using the following taxonomy:
  - **CRITICAL (architectural):** Wrong architecture choice, missing security boundary, fundamental scalability flaw.
  - **CRITICAL (factual):** Incorrect technical claim, wrong service behavior.
  - **IMPORTANT:** Weak justification, missing alternative, incomplete trade-off.
  - **MINOR:** Style, clarity, minor omission.
- **Escalation rule:** If any CRITICAL (architectural) finding is present after round 2, You MUST stop the loop immediately, present the finding to the engineer, and state that a fundamental redesign is needed — do not continue the loop
- Evaluate the escalation rule before applying corrections. After each round, You MUST apply corrections to the document and re-run the `design-quality-check` skill to confirm quality score remains ≥ 3
- **Exit condition:** 0 CRITICAL + 0 IMPORTANT + fewer than 3 MINOR findings
- **Loop cap:** Maximum 5 rounds. If exit condition is not met after 5 rounds, You MUST present the remaining findings to the engineer for manual resolution and proceed to Step 4 with the current state
- You MUST track round history: round number, findings count by severity, corrections applied

**Expected Output per round:** Findings list (CRITICAL → IMPORTANT → MINOR), corrections applied, updated finding counts

### 4. Output

Produce the review report and present the verdict.

**Constraints:**

- You MUST write the report to `output_file` structured as:

  ```markdown
  # PE Review Report

  Date: {date}
  Document: {doc title and path}
  Verdict: {PE-READY | REVISIONS NEEDED | FUNDAMENTAL REDESIGN REQUIRED}
  Rounds: {N} adversarial rounds completed

  ## Quality Score

  {N}/5 — {summary}

  ## Confidence Scores by Section

  | Section | Score | Notes |
  | ------- | ----- | ----- |

  ## Adversarial Review History

  | Round | CRITICAL | IMPORTANT | MINOR | Corrections Applied |
  | ----- | -------- | --------- | ----- | ------------------- |

  ## Remaining Findings

  ### Critical

  ### Important

  ### Minor

  ## Verdict

  {PE-READY: doc is ready for PE submission}
  {REVISIONS NEEDED: list what must be fixed}
  {FUNDAMENTAL REDESIGN REQUIRED: describe the architectural issue}
  ```

- You MUST assign the verdict as follows:
  - 0 CRITICAL + 0 IMPORTANT + <3 MINOR → **PE-READY**
  - 0 CRITICAL + 0 IMPORTANT + ≥3 MINOR (after 5 rounds) → **REVISIONS NEEDED**
  - 0 CRITICAL + ≥1 IMPORTANT remaining (after 5 rounds) → **REVISIONS NEEDED**
  - Any CRITICAL (factual) remaining after 5 rounds → **REVISIONS NEEDED** (a wrong technical claim is correctable by revision)
  - Any CRITICAL (architectural) after round 2 escalation → **FUNDAMENTAL REDESIGN REQUIRED**
- You MUST NOT print the full report in your response — reference the file path
- You MUST display: verdict, finding counts by severity, and a one-line description of each remaining CRITICAL finding

**Expected Output:** Report written to `output_file`, verdict and critical finding summary presented to engineer

## Quality Gate

**PE-READY** requires: quality score ≥ 3, 0 CRITICAL findings, 0 IMPORTANT findings, fewer than 3 MINOR findings.

**CRITICAL findings block PE-READY** — the verdict MUST be REVISIONS NEEDED or FUNDAMENTAL REDESIGN REQUIRED if any CRITICAL finding remains after the loop.
