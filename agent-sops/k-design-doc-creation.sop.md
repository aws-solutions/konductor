# Design Doc Creation

## Overview

This SOP guides the architect through a five-phase workflow to produce a design document ready for principal engineer review from user stories or a problem statement. It applies Socratic requirements elicitation, outside-in structure enforcement, automated quality gates, and an adversarial review loop before presenting the final artifact.

Invoked when the engineer asks to create or write a design document (e.g., "Design a system for X", "I need a design doc for Y"). For reviewing an _existing_ document, use `k-existing-design-review.sop.md` instead.

## Parameters

- **topic** (required): The system, feature, or problem to design. Accepts a free-form description, user stories, or a problem statement.
- **output_path** (optional, default: `docs/design/<slugified-topic>.md`): Path to write the design doc.
- **validation_output_dir** (optional, default: `docs/design/`): Directory for Phase 3's AWS-validation and trade-off reports. Its default reproduces today's hardcoded location exactly, so a caller that omits this parameter sees no change in where those two reports land.
- **elicitation_depth** (optional, default: `standard`): Depth of requirements elicitation — `quick` (5 questions), `standard` (10 questions, default), or `deep` (15 questions). Engineer can also say "skip elicitation" to bypass Phase 1 entirely.

**Constraints for parameter acquisition:**

- You MUST have `topic` before proceeding — if not provided, ask once and wait.
- You MUST NOT ask for `output_path`, `validation_output_dir`, or `elicitation_depth` — use defaults and proceed.
- If the engineer says "skip elicitation" or "I have clear requirements", You MUST skip Phase 1 and proceed directly to Phase 2.

## Steps

### Phase 1: Requirements Elicitation

Use the `socratic-elicitation` skill (Mode A: Intake) to conduct Socratic requirements elicitation before drafting anything.

**Constraints:**

- You MUST conduct this phase by running the `socratic-elicitation` skill (Mode A: Intake) directly — the skill's execution constitutes this phase's work, it is not a prerequisite that runs before it.
- You MUST ask questions sequentially, one at a time, waiting for the engineer's answer before asking the next, drawing from the skill's question dimensions — business value (`[PM]`), technical feasibility and dependencies (`[SDE]`), timeline and cross-team coordination (`[TPM]`), auth and data protection (`[Security]`), and observability and failure modes (`[Ops]`). Let each answer determine whether to follow up or move to the next dimension, rather than working through a fixed script.
- You MUST ask at most `elicitation_depth` questions total (5 / 10 / 15 per setting).
- You MUST NOT ask about dimensions already clearly addressed in the topic description.
- You MUST NOT proceed to Phase 2 until the skill has produced its Requirements Summary (per its Output section) and the engineer has confirmed it, or an early-exit signal ("enough" / "proceed" / etc.) was given.
- You MUST skip this phase entirely if the engineer said "skip elicitation" or "I have clear requirements".

**Expected Output:** The `socratic-elicitation` skill's Requirements Summary (Functional Requirements, Constraints, Non-Functional Requirements, Open Items) from the elicitation session. Present it before proceeding to Phase 2.

### Phase 2: Draft Generation

Generate the design document using the outside-in structure mandated by `design-doc-guidelines`.

**Constraints:**

- You MUST apply the `design-doc-guidelines` skill before drafting.
- You MUST follow the outside-in structure: Problem → Requirements → Solution Overview → How It Works → Implementation Details → Implementation Plan.
- You MUST generate a Mermaid diagram before writing prose for each major section that describes a multi-component interaction, data flow, or sequence of steps (e.g. Solution Overview, How It Works). Every "How It Works" subsection MUST open with a diagram, with no exception, since `design-doc-guidelines`' checklist gates on it unconditionally. Elsewhere, You MAY skip a diagram for a section with no such structure to depict (e.g. a section in Implementation Details listing configuration values or a single API contract); state explicitly when a section has no diagram and why.
- You MUST run the `adr-generator` skill and generate an inline ADR for every significant design decision. The `adr-generator` skill applies the `decision-writing` ADR format: Context, Decision, Alternatives Considered (table), Consequences. Trade-off scores are added in Phase 3 — do NOT wait for them here.
- You MUST run the `design-doc-guidelines` checklist as a maker-checker pass after completing the draft.
- You MUST NOT advance to Phase 3 until the maker-checker pass produces zero CRITICAL findings.
- If the maker-checker pass finds CRITICAL issues, You MUST fix them and re-run before proceeding.

**Expected Output:** Complete draft design document at `output_path` with Mermaid diagrams for each multi-component/flow section, inline ADRs, and a passing `design-doc-guidelines` maker-checker result.

### Phase 3: Quality Gates

Run automated quality gates against the draft. This phase requires no user interaction.

**Constraints:**

- You MUST run the `doc-accuracy-analyzer` skill to verify all technical claims against the codebase. Flag any INCORRECT or UNVERIFIED findings in the draft with inline `> ⚠️` callouts.
- You MUST NOT block doc creation on UNVERIFIED claims — mark them and proceed.
- You MUST run the `aws-service-validator` skill against all AWS service and feature claims in the draft. For each claim, call `aws___search_documentation` and `aws___read_documentation` (aws-mcp) to confirm or deny the assertion; call `aws___get_regional_availability` for any regional availability claim. Classify each claim as CONFIRMED, UNVERIFIED, or INCORRECT. Flag INCORRECT claims with `> ⚠️ INCORRECT: <correction>` callouts and UNVERIFIED claims with `> ⚠️ UNVERIFIED: <what was searched>` callouts. Write the full validation report to `validation_output_dir/<name>-aws-validation.md`.
- You MUST NOT block doc creation on UNVERIFIED AWS claims — mark them and proceed.
- You MUST run the `trade-off-evaluator` skill for every significant design decision that has multiple options. Score each option 1–5 across cost, latency, complexity, scalability, and operability. Embed the scored table in the relevant ADR's Alternatives section and write the full trade-off report to `validation_output_dir/<name>-tradeoffs.md`.
- You MUST run the `adr-generator` skill to verify every Phase 2 ADR is embedded under the `## Architecture Decision Records` section. Do NOT regenerate ADRs already created in Phase 2 — enrich them only (the `trade-off-evaluator` bullet above owns score embedding).
- You MUST NOT ask the engineer for input during this phase.

**Expected Output:** Draft updated with `doc-accuracy-analyzer` and `aws-service-validator` findings inline. Trade-off matrices embedded in ADRs. Validation and trade-off reports written to `validation_output_dir`. Report: N AWS claims checked (N confirmed, N unverified, N incorrect), N trade-off matrices produced, N ADRs generated.

### Phase 4: Adversarial Review Loop

Challenge every major design decision before presenting the doc to the engineer.

**Constraints:**

- You MUST apply the `adversarial-design-review` skill to challenge every major architectural decision, trade-off, and AWS service choice, classifying each finding as CRITICAL, IMPORTANT, or MINOR.
- You MUST run up to 5 adversarial rounds.
- After round 2: if any finding is classified CRITICAL (architectural), You MUST stop the loop immediately, present the finding to the engineer, and ask whether to redesign or override.
- You MUST apply corrections from each round and re-run the `design-doc-guidelines` maker-checker before the next round.
- You MUST exit the loop early when: 0 CRITICAL findings, 0 IMPORTANT findings, and fewer than 3 MINOR findings.
- If the exit condition is not met after 5 rounds, You MUST present the remaining issues to the engineer for manual resolution before proceeding to Phase 5.
- You MUST NOT silently discard findings — every finding must either be fixed or explicitly noted as "engineer override".

**Expected Output:** Adversarial review summary: rounds run, findings by severity, corrections applied, remaining open issues (if any).

### Phase 5: Final Output

Produce the final artifact and present it to the engineer.

**Constraints:**

- You MUST apply all corrections from Phases 3 and 4 before writing the final file.
- You MUST run the `design-evaluation` skill to compute a confidence score: average of the 10 design-evaluation dimension scores (1–5 each). A section scoring below 3 MUST be flagged for revision.
- You MUST write the final document to `output_path`.
- You MUST present to the engineer: the output path, the confidence score (overall average + any sections below 3), and a one-line summary of any remaining open issues from Phase 4.
- You MUST NOT present the full document inline — reference the file path.

**Expected Output:** Final `design-doc.md` at `output_path`. Confidence score reported. Engineer informed of any remaining issues requiring manual attention before principal engineer review submission.

## Quality Gate

The document is ready for principal engineer review when all of the following are true:

- `design-doc-guidelines` maker-checker: **0 CRITICAL findings**
- `doc-accuracy-analyzer`: **0 INCORRECT findings** (UNVERIFIED is acceptable with callouts)
- Adversarial review: **0 CRITICAL, 0 IMPORTANT, fewer than 3 MINOR findings**
- `design-evaluation` confidence score: **≥ 3.0 average** across all sections

If any condition is not met, the SOP MUST NOT present the doc as ready for principal engineer review. Present remaining issues to the engineer and ask: "Fix these before submission? [y/n]"
