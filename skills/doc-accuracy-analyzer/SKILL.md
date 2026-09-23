---
name: doc-accuracy-analyzer
description: Use before submitting a design doc for review, after major revisions to a design doc, or when a reviewer flags factual concerns. Extracts verifiable claims, investigates each against primary sources, classifies findings, and produces a structured accuracy report.
version: 1.0.0
source: MyAgentToolkit (copied locally — not yet in live version set)
---

# Doc Accuracy Analyzer

Systematically verify technical documents by extracting and investigating every verifiable claim.

## When to Use

- Before submitting a design doc for review
- After major revisions to a design doc
- When a reviewer flags factual concerns

## 6-Step Workflow

### Step 1: Extract Verifiable Claims

Scan the document and extract all verifiable claims by category:

- **Data claims** — metrics, counts, sizes, rates ("handles 10k RPS", "99.99% availability")
- **Code claims** — "already implemented", "requires only configuration", "built on top of X"
- **Infrastructure claims** — service features, regional availability, pricing, limits
- **Approach claims** — "this is the standard pattern", "AWS recommends", "best practice"

Be aggressive. "Already built" and "requires only configuration" are the highest-risk claim types.

### Step 2: Investigate Each Claim

For each claim, identify the primary source that would confirm or deny it:

- AWS documentation for service features and limits
- Source code for implementation claims
- AWS pricing calculator for cost claims
- AWS regional service table for availability claims

Search the source. Do not accept the document's assertion as evidence.

### Step 3: Classify Findings

For each claim, assign a classification and severity:

| Classification  | Definition                            | Severity |
| --------------- | ------------------------------------- | -------- |
| Verified        | Confirmed by primary source           | —        |
| Inaccurate      | Contradicted by primary source        | High     |
| Overstated      | True but exaggerated                  | Medium   |
| Unverifiable    | No primary source found               | Medium   |
| Missing Context | True but incomplete without qualifier | Low      |

### Step 4: Assess Approach Feasibility

For each architectural approach or integration:

- Trace the execution path end-to-end
- Identify any step that assumes a capability not confirmed in Step 2
- Flag any "it will work because it should work" reasoning

### Step 5: Suggest Corrections

For each Inaccurate or Overstated finding, provide:

- The original text
- The corrected text
- The primary source citation

### Step 6: Produce Report

```markdown
## Doc Accuracy Report

### Summary

- Total claims: N
- Verified: N | Inaccurate: N | Overstated: N | Unverifiable: N | Missing Context: N

### High Severity Findings

[claim | classification | evidence | correction]

### Medium Severity Findings

[claim | classification | evidence | correction]

### Low Severity Findings

[claim | classification | evidence]
```

## Guidelines

- Never accept "it is well known that" as evidence
- Service limits change — always check current documentation
- "AWS supports X" requires a docs.aws.amazon.com citation
- Implementation claims require a file path or commit reference
