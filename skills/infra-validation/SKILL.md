---
name: infra-validation
description: Validates AWS CDK and CloudFormation code against AWS best practices and Well-Architected principles. Use before deploying infrastructure changes. Flags security vulnerabilities, cost issues, and compliance gaps.
version: 1.1.0
tags: [skill, infrastructure, cdk, cloudformation, validation, security, aws]
---

# Infrastructure Validation

## Overview

The infrastructure gate for CDK and CloudFormation code. AWS publishes the checks as skills on the AWS MCP server (`aws-mcp`): `aws-cloudformation` covers local validation and cfn-guard security and compliance rules, `aws-cdk` covers cdk-nag rule packs, and `aws-well-architected-review` assesses the code against the framework's pillars. This skill runs those checks, then rates every finding on one CRITICAL, IMPORTANT and SUGGESTION scale so `k-code-review-workflow` and the maker-checker step can merge them with the other reviews.

## Usage

Use this skill when:

- Reviewing CDK or CloudFormation before deployment
- Checking infrastructure for security and compliance issues
- Validating Well-Architected Framework alignment

## Step 0: Confirm Scope

Before reading any files, get three things: the infrastructure type, where the code is (a path such as `lib/`, `cdk.out/`, or `cloudformation/`, or pasted code), and the environment. The environment decides only whether missing deletion protection or a destroy-on-delete removal policy is CRITICAL; PITR and backups stay IMPORTANT everywhere. A guessed type or path validates the wrong code. If the caller passes the type, path, and environment (or `scope_confirmed`), skip the questions. When `scope_confirmed` gives no environment, assume Production and record that assumption in the report.

Until you have them, don't read or analyze any infrastructure file, and don't assume CDK or CloudFormation. You may list the top-level directories so the questions can name what is there (for example "I see a CDK stack in `lib/` and a template in `cfn/`; which should I validate?"). Ask only what the listing can't answer, using this template:

```
To validate your infrastructure code, I need the following information:

**Required:**
1. Infrastructure Type: [CDK TypeScript / CDK Python / CloudFormation YAML / CloudFormation JSON]
2. Folder Path: [path to your infrastructure code, or type "I'll paste it"]
3. Environment: [Development / Staging / Production]

**Optional (helps me provide better feedback):**
4. Compliance Requirements: [any specific standards, or "None"]
5. Validation Focus: [Security / Cost / Compliance / Operational / General]
6. Known Issues: [any concerns you have, or "None"]

Please provide at least items 1-3 so I can start the validation.
```

Optional answers sharpen the review: compliance requirements (SOC 2, HIPAA, PCI-DSS, GDPR, or organizational security policies), a focus area, and known issues or a previous report to track progress against.

## Step 1: Run the AWS checks

Load each skill with `aws___retrieve_skill` and follow it for the code in scope. Fetch the files a skill references with the same tool and its `file` parameter; they are not on disk.

| Code in scope | AWS MCP skill | What to run |
| --- | --- | --- |
| CloudFormation template, or the template CDK synthesizes into `cdk.out/` | `aws-cloudformation` | Its validation workflow (`references/validation-tool-selection.md`): one local validator (cfn-lint or cloudformation-validate), then cfn-guard security and compliance rules |
| CDK app | `aws-cdk` | cdk-nag rule packs and `cdk synth --strict` (`references/compliance-and-drift.md`), plus `cdk diff` against the deployed stack when one exists |
| Cost, reliability, performance and operations | `aws-well-architected-review` | A quick or pillar-scoped review against the IaC, matching the validation focus from Step 0 |
| DynamoDB tables, S3 buckets, IAM statements | `amazon-dynamodb`, `securing-s3-buckets`, `aws-iam` | Their review or audit checklists for those resources |

For a service none of these covers, find its skill with `find-aws-skills`.

Keep the run read-only. Do not deploy, create a stack or change set, or install a tool without the user's approval; skip the account-aware pre-deployment layer of `aws-cloudformation` unless the user asks for it. Report each layer's outcome separately, as `aws-cloudformation` asks: one passing layer does not show another passed.

### Without the AWS MCP server

If `aws___retrieve_skill` is not available, say so at the top of the report. Run whichever of `cfn-lint`, `cfn-guard` and cdk-nag the project has installed. Then read the code for every item in the Quality Gate below, since those are the findings callers block on, and list the AWS checks you could not run under the review's limits.

## Step 2: Rate the findings

Policy-level IAM depth (condition keys, permission boundaries, KMS key policies, a policy score) belongs to `policy-validation`, which `k-architect` loads. If your agent doesn't have it, list those checks as out of scope in the report. Rate IAM statements with the same tiers as the Severity Mapping in `policy-validation`:

1. **Wildcard Resources** - Flag as CRITICAL
   - Search for: `"Resource": "*"` or `resources: ["*"]`
   - Search for: `"Resource": "arn:aws:*:*:*:*"` patterns
   - Exception: Only acceptable for service-level actions (e.g., `sts:GetCallerIdentity`)

2. **Wildcard Actions** - CRITICAL, except `service:*` on a low-risk service
   - Search for: `"Action": "*"` or `actions: ["*"]`
   - Search for: `"Action": "service:*"` on a data, credential, code or permission service (`s3:*`, `kms:*`, `lambda:*`, which includes `lambda:UpdateFunctionCode`, `iam:*`, `sts:*`), or `ec2:*`, which covers EBS snapshots, security-group ingress and instance userData
   - `service:*` on a low-risk service (`cloudwatch:*`, `xray:*`) is IMPORTANT

3. **Overly Permissive Actions** - Flag as IMPORTANT
   - A list of named actions broader than the code needs, with no wildcard. For example, a read-only Lambda granted `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject`
   - Should specify exact actions needed

4. **Cross-Account Access**
   - Check for `Principal` with external account IDs
   - CRITICAL when the trust has no `sts:ExternalId` or other condition key
   - IMPORTANT when it is conditioned but its intent is unverified

Use the same CRITICAL, IMPORTANT and SUGGESTION scale as the Quality Gate:

- **CRITICAL** blocks deployment. Use it only for exposure, data loss or credential risk: the Quality Gate CRITICAL list, which covers public access, missing encryption the data requires, open ingress, missing deletion protection, hardcoded secrets and the wildcard IAM cases rated CRITICAL above.
- **IMPORTANT** is for operational and reliability gaps such as missing alarms, backups, DLQs, tracing, reserved concurrency or a hot partition key. They stay IMPORTANT even in production.
- **SUGGESTION** is for cost, performance and code-quality improvements.

If you would hedge a rating with "arguably", use the lower tier.

### CRITICAL (Must Fix)

```
[Category] [Resource/Location]
Issue: [Description]
Impact: [Why this matters - security risk, compliance violation, production outage risk]
Fix: [Specific recommendation]
Example:
[Code showing fix - before and after]
```

### IMPORTANT (Should Fix)

```
 [Category] [Resource/Location]
Issue: [Description]
Impact: [Operational risk, cost impact, reliability concern]
Recommendation: [Suggested improvement]
Example:
[Code showing improvement]
```

### SUGGESTION (Consider Fixing)

```
[Category] [Resource/Location]
Observation: [What could be better]
Benefit: [Cost savings estimate, performance improvement, code quality, maintainability]
Alternative: [Optional approach]
Example (optional):
[Code showing optimization]
```

### Positive Findings

```
[Category]
Good practice: [What's done well]
```

Report each root cause once, under its highest tier, and put every related setting in that finding's fix. A public bucket finding, for example, carries the block-public-access, TLS enforcement and policy changes together instead of repeating them lower down. Name the tool or AWS skill that raised each finding.

End the report with its limits: the inputs you did not inspect (Lambda handler code, the synthesized template in `cdk.out/`, the app entrypoint, CI), the checks that could not run, and the findings that depend on either, marked unverified. If you did not check every resource of a type, say so.

## Quality Gate

**CRITICAL (must fix):**

- S3 buckets with public access enabled
- RDS or EBS without encryption at rest, or S3 and DynamoDB data that requires SSE-KMS left on the default keys
- Security groups with `0.0.0.0/0` ingress on non-HTTP ports
- No deletion protection, or a destroy-on-delete removal policy, on stateful resources (RDS, DynamoDB) in production
- Hardcoded passwords, keys or tokens in code or environment variables
- IAM statements with wildcard actions (`*`, `ec2:*`, or `service:*` on a data, credential, code or permission service: `s3:*`, `kms:*`, `lambda:*`, `iam:*`, `sts:*`) or wildcard resources
- Cross-account trust with no `sts:ExternalId` or other condition key

**IMPORTANT (should fix):**

- CloudWatch alarms not defined for key metrics
- No backup configuration for stateful resources
- IAM `service:*` on a low-risk service, such as `cloudwatch:*` or `xray:*`
- Cross-account trust that has a condition key but whose intent is unverified
- Lambda functions without reserved concurrency limits, DLQ or tracing
- Low-cardinality partition keys that create hot partitions

**SUGGESTION:**

- Over-provisioned memory, timeout or capacity with no stated reason
- Could enable VPC Flow Logs for network visibility
- Could add cost allocation tags to all resources

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" unless `scope_confirmed` is true. In that case, report all the findings and leave fixing to the caller without asking.
