# Existing Design Artifact Review (Pre-Implementation)

> **Not for authoring new design documents.** This SOP reviews a completed set of design artifacts (system design, threat model, API specs, data models, security policies, diagrams) for readiness before implementation begins. To author a new design document from scratch, use [`k-design-doc-creation.sop.md`](k-design-doc-creation.sop.md) instead.

## Overview

This SOP guides a structured review of all design artifacts before handoff to implementation. It collects system design, threat model, API specs, data models, security policies, and architecture diagrams, then runs a principal-engineer-level evaluation across 10 dimensions using the design-evaluation skill.

Use this SOP after completing all design artifacts and before starting implementation.

## Parameters

- **design_dir** (required): Path to the design artifacts directory (e.g., `design-architecture/outputs/`)
- **output_file** (optional, default: `design-review-report.md`): File to write the consolidated review report
- **dry_run** (optional, default: false): If true, show what would be reviewed without generating the report

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding
- When asking for parameters, You MUST request all parameters in a single prompt
- When asking for parameters, You MUST use the exact parameter names as defined

## Steps

### 1. Discover Design Artifacts

Scan the design directory and identify which artifacts are present.

**Constraints:**

- You MUST check for these artifacts in `design_dir`:
  - `system-design.md` — system architecture
  - `threat-model.md` — STRIDE analysis and mitigations
  - `smithy-model/` or `api-specs/` — API specifications
  - `dynamodb-*.md` or `data-model.md` — data models
  - `security-policy*.md` or `iam-policies.md` — security policies
  - `*.drawio.xml` or `architecture-diagram*` — architecture diagrams
- You MUST report which artifacts were found and which are missing
- You SHOULD warn if critical artifacts (system design, threat model) are missing
- You MUST NOT proceed to evaluation if system-design.md is missing

**Expected Output:**

- List of found artifacts with file paths
- List of missing artifacts with severity (critical/optional)

### 2. Confirm Scope with User

Present the discovered artifacts and confirm the review scope.

**Constraints:**

- You MUST display the list of artifacts found
- You MUST ask: "Proceed with review of these artifacts? [y/n]"
- You MUST NOT proceed without explicit user confirmation
- If dry_run is true, you MUST stop here and report what would be reviewed

### 3. Read All Artifacts

Load the content of each discovered artifact for evaluation.

**Constraints:**

- You MUST read each artifact file using fs_read
- You MUST handle missing optional artifacts gracefully (note as "not provided")
- You SHOULD read artifacts in this order: system design → threat model → API specs → data models → security policies → diagrams

**Expected Output:**

- All artifact content loaded into context for evaluation

### 4. Run Design Evaluation

Apply the design-evaluation skill to evaluate all artifacts across 10 dimensions.

**Constraints:**

- You MUST use the `design-evaluation` skill for this step
- You MUST evaluate across all 10 dimensions:
  1. Template adherence and completeness
  2. Scalability and performance
  3. Security and threat coverage
  4. Maintainability and code quality
  5. Resilience and fault tolerance
  6. Testability
  7. Operational readiness
  8. Cost optimization
  9. API design quality
  10. Data model quality
- You MUST assign a numeric score of 1–5 for each dimension; a dimension scoring below 3 MUST be flagged for revision
- You MUST identify CRITICAL issues (block implementation) vs IMPORTANT issues (should fix) vs SUGGESTIONS

**Expected Output:**

- Scores for all 10 dimensions
- List of CRITICAL, IMPORTANT, and SUGGESTION findings

### 5. Generate Review Report

Write the consolidated review report to the output file.

**Constraints:**

- You MUST write the report to `output_file` using fs_write
- You MUST structure the report as:

  ```
  # Design Review Report
  Date: [current date]
  Artifacts reviewed: [list]

  ## Executive Summary
  [2-3 sentences: overall readiness, critical blockers]

  ## Dimension Scores
  [Table: dimension | score | key finding]

  ## Critical Issues (Must Fix Before Implementation)
  [Numbered list with specific file/section references]

  ## Important Issues (Should Fix)
  [Numbered list]

  ## Suggestions
  [Numbered list]

  ## Recommendation
  [READY FOR IMPLEMENTATION / NOT READY — reason]
  ```

- You MUST NOT print the full report content in your response — the file itself is sufficient
- You MUST inform the user of the file location and the overall recommendation

**Expected Output:**

- Report file written to `output_file`
- Summary message with recommendation

### 6. Present Recommendation

Summarize findings and recommend next steps.

**Constraints:**

- You MUST state clearly: READY FOR IMPLEMENTATION or NOT READY
- If NOT READY, you MUST list the critical issues that must be resolved
- You SHOULD offer to help fix critical issues using the appropriate architect skills
- You MAY offer to re-run the review after fixes are applied

## Examples

### Example 1: Complete Design Package

**Input:**

- design_dir: `design-architecture/outputs/`
- output_file: `design-review-report.md`

**Expected Output:**

```
Design review complete. Report saved to design-review-report.md

Artifacts reviewed: system-design.md, threat-model.md, smithy-model/, dynamodb-table-design.md, security-policies.md, architecture.drawio.xml

Recommendation: READY FOR IMPLEMENTATION

2 important issues identified (see report for details). No critical blockers.
```

### Example 2: Missing Threat Model

**Input:**

- design_dir: `design-architecture/outputs/`

**Expected Output:**

```
Artifacts found:
✅ system-design.md
⚠️ threat-model.md (MISSING — critical, recommended before review)
✅ smithy-model/
✅ dynamodb-table-design.md

Proceeding with review. Note: the Security and threat coverage dimension will be limited.
Consider generating a threat model first using the k-architect agent with the threat-modeling skill.
```

### Example 3: Dry Run

**Input:**

- design_dir: `design-architecture/outputs/`
- dry_run: true

**Expected Output:**

```
DRY RUN — would review these artifacts:
- system-design.md (found)
- threat-model.md (found)
- smithy-model/ (found)
- dynamodb-table-design.md (found)
- security-policies.md (not found — optional)

No report generated (dry_run=true).
```

## Troubleshooting

### Issue: design_dir not found

**Solution:** Verify the path is correct relative to the current working directory. Use `ls` to confirm the directory exists. Common paths: `design-architecture/outputs/`, `outputs/`, `./`.

### Issue: System design file not found

**Solution:** The system design document is required. Generate it first using `k-architect` with the `system-design-patterns` skill before running this SOP.

### Issue: Evaluation produces too many findings

**Solution:** Focus on CRITICAL issues first. IMPORTANT and SUGGESTION items can be addressed iteratively. A design with only IMPORTANT issues is still ready for implementation.

### Issue: Report file write fails

**Solution:** Check that the output directory exists and is writable. Try writing to `/tmp/design-review-report.md` as a fallback.
