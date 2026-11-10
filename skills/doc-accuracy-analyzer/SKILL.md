---
name: doc-accuracy-analyzer
description: 'Use when asked to fact-check or verify the claims in a design doc, before review or after a reviewer questions accuracy. Extracts verifiable claims, routes AWS feature, limit, pricing and Region claims to aws-service-validator, investigates the rest against primary sources, and produces a structured accuracy report.'
version: 1.0.0
---

# Doc Accuracy Analyzer

Systematically verify technical documents by extracting and investigating every verifiable claim. This is the entry point for fact-checking: it hands AWS claims to `aws-service-validator` and checks everything else itself.

## When to Use

- Before submitting a design doc for review
- After major revisions to a design doc
- When a reviewer flags factual concerns

## Workflow

### Step 1: Extract Verifiable Claims

Scan the document and extract all verifiable claims by category:

- **Data claims**: metrics, counts, sizes, rates ("handles 10k RPS", "99.99% availability")
- **Code claims**: "already implemented", "requires only configuration", "built on top of X"
- **Infrastructure claims**: service features, regional availability, pricing, limits
- **Approach claims**: "this is the standard pattern", "AWS recommends", "best practice"

Be aggressive. "Already built" and "requires only configuration" are the highest-risk claim types.

### Step 2: Route AWS Claims to `aws-service-validator`

Send every AWS feature, limit or quota, pricing, Region availability, and GA/preview claim to `aws-service-validator` as a list of `{service, feature, region, assertion}`, with the report path your caller gave, if any. It checks them with the AWS documentation tools and returns CONFIRMED, UNVERIFIED, or INCORRECT for each. Carry its rows into Step 4.

If `aws-service-validator` or its `aws-mcp` tools are not available, check the AWS claims yourself in Step 3 against docs.aws.amazon.com, and Region claims against the [AWS Services by Region](https://aws.amazon.com/about-aws/global-infrastructure/regional-product-services/) list, and say so in the report.

### Step 3: Investigate the Remaining Claims

For each other claim, identify the primary source that would confirm or deny it:

- Source code for implementation claims
- Measurements, dashboards, or load-test results for data claims
- The AWS Pricing Calculator for a dollar cost estimate (the pricing model itself goes to Step 2)
- Published guidance (for AWS, a docs.aws.amazon.com page) for approach claims

Search the source. Do not accept the document's assertion as evidence.

### Step 4: Classify Findings

For each claim, assign a classification. Severity uses the same scale as the other checkers, so a gate can read it directly. An IMPORTANT finding counts as resolved once it is corrected or flagged with a callout. A CRITICAL finding is resolved only by correcting the text.

| Classification  | Definition                            | Severity   |
| --------------- | ------------------------------------- | ---------- |
| CONFIRMED       | Confirmed by primary source           | -          |
| INCORRECT       | Contradicted by primary source        | CRITICAL   |
| OVERSTATED      | True but exaggerated                  | IMPORTANT  |
| UNVERIFIED      | No primary source found               | SUGGESTION |
| MISSING CONTEXT | True but incomplete without qualifier | SUGGESTION |

Rows from `aws-service-validator` keep INCORRECT and UNVERIFIED. Reclassify a CONFIRMED row as OVERSTATED or MISSING CONTEXT when the document's wording goes further than the cited page (for example, "unlimited" where the page gives a quota).

### Step 5: Assess Approach Feasibility

For each architectural approach or integration:

- Trace the execution path end-to-end
- Identify any step that assumes a capability not confirmed in Steps 2 and 3
- Flag any "it will work because it should work" reasoning

### Step 6: Suggest Corrections

For each INCORRECT or OVERSTATED finding, provide:

- The original text
- The corrected text
- The primary source citation

### Step 7: Produce Report

```markdown
## Doc Accuracy Report

### Summary

- Total claims: N (N routed to aws-service-validator)
- CONFIRMED: N | INCORRECT: N | OVERSTATED: N | UNVERIFIED: N | MISSING CONTEXT: N
- Result: PASS or FAIL

### CRITICAL Findings

[claim | classification | evidence | correction]

### IMPORTANT Findings

[claim | classification | evidence | correction]

### SUGGESTION Findings

[claim | classification | evidence]
```

## Pass Condition

The document passes when:

- 0 INCORRECT (CRITICAL) findings remain, including the routed AWS claims. A `> ⚠️ INCORRECT: <correction>` callout marks a fix still owed; the document passes once the text is corrected.
- Every OVERSTATED (IMPORTANT) finding is corrected or flagged with a callout.
- Every UNVERIFIED finding carries a `> ⚠️ UNVERIFIED: <what was searched>` callout. It is rated SUGGESTION, because new services and internal facts often have no public source.

SUGGESTION findings never block once each UNVERIFIED one carries its callout.

## Guidelines

- Never accept "it is well known that" as evidence
- Service limits change: always check current documentation
- "AWS supports X" requires a docs.aws.amazon.com citation
- Implementation claims require a file path or commit reference
