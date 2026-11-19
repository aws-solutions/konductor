---
name: aws-service-validator
description: 'Fact-checks AWS feature, limit, pricing and Region claims. Use when a design doc makes AWS claims or doc-accuracy-analyzer passes them. Triggers: "validate my AWS claims", "verify regional availability".'
version: 1.1.1
tags: [skill, aws, validation, fact-checking, design, accuracy]
---

# AWS Service Validator

Checks AWS claims against AWS documentation and classifies each as CONFIRMED, UNVERIFIED, or INCORRECT, with evidence URLs and corrections.

This is the AWS-claims subroutine of `doc-accuracy-analyzer`, which extracts the claims from a document and routes the AWS ones here. To fact-check a whole document, start with `doc-accuracy-analyzer`. Run this skill directly when you already have a list of AWS claims.

If you were pointed at a document and `doc-accuracy-analyzer` is not available, extract the claims yourself: one row per atomic assertion, so a sentence that mixes a correct and a wrong fact becomes two claims.

## Input

A list of AWS claims, each as `{service, feature, region (if applicable), assertion}`. This skill checks these claim types:

- **Feature**: "Lambda supports response streaming"
- **Service limit or quota**: "max synchronous payload 6 MB"
- **Pricing model**: "charged per request", "no cost for idle capacity"
- **Regional availability**: "available in us-east-1"
- **GA or preview status**: "generally available", "in preview"

## Steps

### Step 1: Check Each Claim Against AWS Documentation

For each claim, use the `aws-mcp` tools in this order:

1. **`aws___search_documentation`**: search for the service + feature to locate the relevant doc page
2. **`aws___read_documentation`**: read the located page to confirm or deny the assertion
3. **`aws___get_regional_availability`**: for any regional availability claim, call this tool with `resource_type` (required: `"product"`, `"api"`, or `"cfn"`), `regions` (up to 10), and `filters` set to the exact catalog name: a product or sub-feature (e.g. `"Amazon Bedrock"`), an API (`"SdkServiceId+Operation"`, e.g. `"CloudFormation+CreateStack"`), or a CloudFormation resource type (e.g. `"AWS::Lambda::Function"`). `filters` is required when checking more than one region. If you are unsure of the exact name, call once for one region with no filters to list the valid names. That list is paginated, so keep passing the returned `next_token` until the name you need appears or no `next_token` comes back

Do not accept the document's own assertion as evidence. Always consult the primary source.

### Step 2: Classify Each Claim

| Status     | Definition                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| CONFIRMED  | A primary source you checked confirms the assertion                                                    |
| UNVERIFIED | No primary source checked or found: the tools were unavailable, the service is new, or the claim vague |
| INCORRECT  | A primary source you checked contradicts the assertion                                                 |

CONFIRMED and INCORRECT always mean source-checked: memory alone never gives either.

For INCORRECT claims, provide the correction and the evidence URL.
For UNVERIFIED claims, note what was searched and why it could not be confirmed.

A correction says what the design should do instead, not just the right limit. "Max item size is 400 KB; store the payload in S3 and keep a pointer in the item" helps the author. "Max is 400 KB" alone does not.

#### When the aws-mcp tools are unavailable

If you have a web fetch or web search tool, use it first: open the docs.aws.amazon.com page for the claim and classify from what it says, with that page's URL as evidence. That is a source check.

With no way to read the docs, every claim stays UNVERIFIED, because a limit you remember may have changed. So:

- Label the evidence "prior knowledge, not source-checked", and say the tools were unavailable rather than claiming a search.
- When you believe a claim contradicts a documented AWS limit or behavior, add the note "contradicts prior knowledge, check <doc page>", naming the doc page the author should check. Do not list a URL you did not open as evidence. The Quality Gate treats this note as blocking, so a known-wrong claim cannot pass as plain UNVERIFIED.
- Do not judge pricing and Region claims from memory at all, since both change often and must come from the pricing page or the regional availability tool. They get the label only.
- State at the top of the report that no AWS docs were consulted.

### Step 3: Produce Validation Report

Output a markdown report in this format:

```markdown
## AWS Validation Report

| Claim                                      | Service   | Status     | Evidence                                  | Correction                                   |
| ------------------------------------------ | --------- | ---------- | ----------------------------------------- | -------------------------------------------- |
| "An event source mapping takes one filter" | Lambda    | INCORRECT  | https://docs.aws.amazon.com/...           | Up to five filters by default, ORed together |
| "Max synchronous invocation payload: 6 MB" | Lambda    | CONFIRMED  | https://docs.aws.amazon.com/...           | -                                            |
| "<service> is GA in <Region>"              | <service> | UNVERIFIED | Regional availability call found no match | Flag for human review                        |

**Summary:** N claims checked: N CONFIRMED, N UNVERIFIED (N contradicting prior knowledge), N INCORRECT.
```

When run directly, write the report to the path the caller gives, or to `docs/design/<name>-aws-validation.md`. When `doc-accuracy-analyzer` calls this skill, return the rows so it can merge them into its own report, and write the file only if it passed a path.

## Pitfalls

- **Do not block on UNVERIFIED**: mark and proceed. New services may not yet appear in documentation. The exception is a claim noted "contradicts prior knowledge", which blocks the gate
- **Do not validate pricing claims from memory**: always call `aws___search_documentation` for pricing pages.
- **Regional availability changes frequently**: always call `aws___get_regional_availability` rather than relying on prior knowledge. It requires `resource_type`, plus `filters` for a multi-region call, and filter values must exactly match AWS's catalog names. When listing names with an unfiltered single-region call, follow `next_token` before concluding a name doesn't exist.
- **Feature names drift**: search by both the marketing name and the API/console name if the first search returns no results.

## Verification

After producing the report, confirm:

- Every claim you were given has a row in the report
- Every INCORRECT finding has a correction and an evidence URL that resolves
- No CONFIRMED finding is based solely on the document's own assertion
- No CONFIRMED or INCORRECT finding rests on prior knowledge alone

## Quality Gate

The fact-check gate passes when:

- **0 INCORRECT findings** remain: each one is corrected inline. A `> ⚠️ INCORRECT: <correction>` callout marks a fix still owed, not a pass
- **0 UNVERIFIED findings noted "contradicts prior knowledge"** remain: check each against the named page and reclassify it, or correct the text. Until then it is flagged `> ⚠️ UNVERIFIED: contradicts prior knowledge, check <doc page>` and the gate does not pass
- Other UNVERIFIED findings are flagged with `> ⚠️ UNVERIFIED: <what was searched>` callouts
- Each callout sits under the claim it flags and carries the design fix, so reviewers see the remedy next to the text
- When run directly, the report is written to the path the caller gives, or to `docs/design/<name>-aws-validation.md`. When `doc-accuracy-analyzer` calls it without a path, write no file and return the rows
