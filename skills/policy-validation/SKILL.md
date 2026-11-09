---
name: policy-validation
description: Validates IAM policies and security controls against AWS best practices. Use before deployment to detect overly permissive permissions, missing conditions, and compliance gaps. Produces prioritized findings with specific fixes.
version: 1.0.0
tags: [skill, iam, security, policy, validation, checker, aws]
---

# Policy Validation

## Overview

Reviews IAM policies, resource policies, and security configurations for overly permissive access, missing condition keys, compliance gaps, and anti-patterns. It also checks encryption coverage, audit logging, and threat-model coverage, and gives each finding a severity and a specific fix.

## Usage

Use this skill when:

- Reviewing IAM policies before deployment
- Checking for least-privilege violations
- Validating compliance with security standards

## Core Concepts

### Validation Focus Areas

Overly permissive actions (wildcards without justification), missing condition keys on cross-account trust, resource-based policy gaps, and anti-patterns (inline policies, hardcoded ARNs, missing `ExternalId`).

## Rules

- Validate only policies with a concrete policy document: JSON, or CDK code with actual statements. A role that appears only in a table or description has nothing to check, so don't flag it, not even for a missing permission boundary.
- Tell a security gap from a design decision. If the design justifies a choice (for example, "AWS-managed keys sufficient for Internal/Confidential data classification"), say so in the finding and present your recommendation as an alternative. With no justification, it is a gap.
- Report only what the design missed. If it already has a "Compliance Gaps Identified" table, a SOC 2 checklist, threat mitigation tables, or remediation steps under "Next Steps and Recommendations", reference them, check that they are accurate, and add only new gaps. Repeating them lengthens the report without telling the maker anything new.
- Rate every finding CRITICAL, IMPORTANT, or SUGGESTION, the scale the Quality Gate uses.

## Validation Framework

Validate security designs across these categories:

### CATEGORY 1: IAM POLICY DESIGN (CRITICAL)

Check for:

- Wildcard actions (`Action: "*"`) without justification
- Wildcard resources (`Resource: "*"`) without justification
- Missing IAM conditions for fine-grained access control
- Over-permissive policies granting unnecessary permissions
- Missing permission boundaries for delegated administration (ONLY if the role policy is actually defined)
- Policies not following least privilege principle
- Unused permissions (granted but never used)
- Cross-account access without proper restrictions

**Wildcard Action Detection Logic**:

- Scan all IAM policies for `"Action": "*"` or `"Action": ["*"]`
- Flag as CRITICAL if found without explicit justification
- Recommend specific AWS service actions based on resource types
- Example: Replace `s3:*` with `["s3:GetObject", "s3:PutObject", "s3:ListBucket"]`

**Wildcard Resource Detection Logic**:

- Scan all IAM policies for `"Resource": "*"` or `"Resource": ["*"]`
- Flag as CRITICAL if found without explicit justification
- Recommend specific ARN patterns with account ID, region, and resource identifiers
- Example: Replace `*` with `arn:aws:s3:::bucket-name/path/${aws:userid}/*`

**Missing IAM Condition Detection**:

- Check if policies lack condition blocks for fine-grained access control
- Recommend conditions based on use case:
  - IP restrictions: `"IpAddress": {"aws:SourceIp": ["10.0.0.0/8"]}`
  - MFA requirements: `"Bool": {"aws:MultiFactorAuthPresent": "true"}`
  - Resource tagging: `"StringEquals": {"s3:ExistingObjectTag/Owner": "${aws:userid}"}`
  - Time-based access: `"DateGreaterThan": {"aws:CurrentTime": "2024-01-01T00:00:00Z"}`

**Permission Boundary Validation**:

- Check if delegated administration roles have permission boundaries
- Flag as IMPORTANT if missing for roles with `iam:*` or `sts:AssumeRole` permissions
- Recommend managed policy boundaries like `PowerUserAccess` or custom boundaries

Score the category with the IAM Policy Security Score in STEP 4.

### CATEGORY 2: ENCRYPTION COVERAGE (CRITICAL)

Check for:

- Data stores without encryption at rest (S3, DynamoDB, RDS, EBS)
- Missing TLS enforcement for data in transit
- KMS keys without rotation enabled
- Weak encryption algorithms (< AES-256)
- Missing VPC endpoints for private AWS service access
- Unencrypted backups or snapshots
- Missing encryption for logs and audit trails

**Data Store Encryption Detection**:

- **S3 Buckets**: Check for `BucketEncryption` configuration with `SSEAlgorithm: aws:kms`
- **DynamoDB Tables**: Check for `SSESpecification` with `SSEEnabled: true` and `KMSMasterKeyId`
- **RDS Instances**: Check for `StorageEncrypted: true` with `KmsKeyId`
- **EBS Volumes**: Check for `Encrypted: true` with `KmsKeyId`
- Flag as CRITICAL if any data store lacks encryption at rest

**TLS Enforcement Validation**:

- **S3 Bucket Policies**: Check for policy statement denying requests where `"aws:SecureTransport": "false"`
- **API Gateway**: Check for `MinimumTLSVersion: TLS_1_2` or higher
- **Application Load Balancer**: Check for HTTPS listeners with TLS 1.2+ policy
- **CloudFront**: Check for `ViewerProtocolPolicy: https-only` and `MinimumProtocolVersion: TLSv1.2_2021`
- Flag as CRITICAL if TLS enforcement is missing for any service handling sensitive data

**KMS Key Rotation Validation**:

- Check for `EnableKeyRotation: true` on all KMS customer-managed keys
- Verify rotation schedule is annual (AWS default)
- Flag as IMPORTANT if rotation is disabled for keys encrypting sensitive data
- Recommend enabling automatic rotation for all customer-managed keys

**KMS Key Policy Validation**:

- Check for least privilege separation between key administrators and key users
- Key administrators should have: `kms:Create*`, `kms:Describe*`, `kms:Enable*`, `kms:List*`, `kms:Put*`, `kms:Update*`, `kms:Revoke*`, `kms:Disable*`, `kms:Get*`, `kms:Delete*`, `kms:ScheduleKeyDeletion`, `kms:CancelKeyDeletion`
- Key users should have: `kms:Decrypt`, `kms:DescribeKey`, `kms:GenerateDataKey`
- Flag as IMPORTANT if key administrators also have decrypt permissions (violates separation of duties)

**VPC Endpoint Validation**:

- Check for VPC gateway endpoints for S3 and DynamoDB
- Check for VPC interface endpoints for other AWS services (Secrets Manager, KMS, etc.)
- Flag as SUGGESTION if resources access AWS services over internet gateway instead of VPC endpoints
- Recommend private connectivity through VPC endpoints for security and cost optimization

### CATEGORY 3: AUDIT LOGGING (IMPORTANT)

Check for:

- CloudTrail not enabled or not multi-region
- CloudTrail logs not encrypted
- Missing log file validation
- Missing service-specific logs (S3 access, VPC Flow Logs)
- Insufficient log retention periods (< 90 days for compliance)
- Logs not stored in secure, encrypted buckets
- Missing CloudWatch Logs for application logging

**CloudTrail Multi-Region Validation**:

- Check for `IsMultiRegionTrail: true` on CloudTrail configuration
- Check for `IncludeGlobalServiceEvents: true` to capture IAM, STS, CloudFront events
- Flag as CRITICAL if CloudTrail is not enabled in all regions
- Recommend single multi-region trail for centralized audit logging

**CloudTrail Encryption and Log File Validation**:

- Check for `KmsKeyId` on CloudTrail configuration (logs encrypted with KMS)
- Check for `EnableLogFileValidation: true` for integrity verification
- Flag as IMPORTANT if CloudTrail logs are not encrypted or lack validation
- Recommend KMS encryption and log file validation for tamper detection

**Service-Specific Logging Detection**:

- **S3 Access Logs**: Check for `LoggingConfiguration` on S3 buckets with `TargetBucket` and `TargetPrefix`
- **VPC Flow Logs**: Check for `FlowLog` resources with `ResourceType: VPC` or `ResourceType: Subnet`
- **Lambda Logs**: Check for CloudWatch Logs group `/aws/lambda/function-name`
- **API Gateway Logs**: Check for `AccessLogSettings` with CloudWatch Logs destination
- Flag as SUGGESTION if service-specific logs are missing for critical resources

**Log Retention Period Validation**:

- Check CloudWatch Logs retention: Minimum 90 days for operational logs
- Check S3 lifecycle policies: Minimum 7 years for compliance audit trails (HIPAA, SOC 2)
- Flag as IMPORTANT if retention periods are insufficient for compliance requirements
- Recommend tiered retention: 90 days in CloudWatch → 1 year in S3 Standard → 7 years in S3 Glacier

**CloudWatch Alarm Validation**:

- Check for alarms on critical security events:
  - Unauthorized API calls (CloudTrail filter: `errorCode = *UnauthorizedOperation OR errorCode = AccessDenied*`)
  - Root account usage (CloudTrail filter: `userIdentity.type = Root`)
  - IAM policy changes (CloudTrail filter: `eventName = DeleteGroupPolicy OR eventName = DeleteRolePolicy OR eventName = DeleteUserPolicy OR eventName = PutGroupPolicy OR eventName = PutRolePolicy OR eventName = PutUserPolicy`)
  - Security group changes (CloudTrail filter: `eventName = AuthorizeSecurityGroupIngress OR eventName = AuthorizeSecurityGroupEgress OR eventName = RevokeSecurityGroupIngress OR eventName = RevokeSecurityGroupEgress`)
  - Failed authentication attempts (CloudTrail filter: `eventName = ConsoleLogin AND errorMessage = "Failed authentication"`)
  - KMS key deletion or disabling (CloudTrail filter: `eventSource = kms.amazonaws.com AND (eventName = DisableKey OR eventName = ScheduleKeyDeletion)`)
- Flag as IMPORTANT if critical alarms are missing
- Recommend SNS topic subscriptions for security team notifications

### CATEGORY 4: THREAT MODEL COVERAGE (IMPORTANT)

**Threat Model Integration Validation**:

- Verify the security design explicitly states whether threat model was provided as input or inferred
- If threat model was provided, validate that the design references it correctly
- If threat model was inferred, verify that inferred threats are documented

Check for:

- Threats without corresponding security controls
- Incomplete threat mitigations
- Missing security controls for identified threats
- Threats not validated with security testing
- Insufficient threat detection capabilities
- Threat-to-control mapping table missing or incomplete
- Mitigation status not documented for each threat

**Threat-to-Control Mapping Validation Logic**:

- Parse threat model document for threat identifiers (T-001, T-002, etc.)
- For each threat, verify at least one security control is assigned
- Check that security control actually mitigates the threat (not just mentioned)
- Flag as CRITICAL if any threat lacks a security control

**Unauthorized Access Threat Detection**:

- Check if threat model includes unauthorized access threats
- Verify IAM policies implement least privilege with conditions
- Verify MFA is enforced for privileged accounts
- Verify permission boundaries are used for delegated administration
- Flag as CRITICAL if unauthorized access threats exist without IAM restrictions

**Data Protection Threat Detection**:

- Check if threat model includes data exfiltration or data tampering threats
- Verify encryption at rest is enabled for all data stores
- Verify TLS enforcement for data in transit
- Verify VPC endpoints are used for private AWS service access
- Verify S3 bucket policies deny non-SSL requests
- Flag as CRITICAL if data protection threats exist without encryption controls

**Audit Logging Coverage Validation**:

- Check if threat model includes insider threats or external attacks
- Verify CloudTrail is enabled in all regions with log file validation
- Verify service-specific logs are enabled (S3 access logs, VPC Flow Logs)
- Verify CloudWatch alarms are configured for security events
- Verify GuardDuty is enabled for threat detection
- Flag as IMPORTANT if threat detection threats exist without comprehensive audit logging

**Threat Coverage Gap Report Generation**:

- Create table with columns: Threat ID, Threat Description, Assigned Controls, Mitigation Status, Gap Analysis
- For each unmitigated threat, provide:
  - Specific security control recommendations
  - Implementation effort estimate (Low/Medium/High)
  - Security impact if not mitigated (CRITICAL/IMPORTANT/SUGGESTION)
  - Remediation code examples (IAM policies, encryption configs, etc.)

### CATEGORY 5: COMPLIANCE GAPS (CRITICAL)

Check for:

- GDPR violations (missing encryption, access controls, audit logging, data deletion)
- HIPAA violations (PHI not encrypted, missing BAA, insufficient access controls)
- PCI-DSS violations (missing network segmentation, encryption, monitoring)
- SOC 2 violations (missing access controls, monitoring, change management)
- Missing compliance validation checklists
- Insufficient compliance evidence

When the user or the design under review names a compliance framework, open the `iam-policy-design` skill's `iam-policy-design/references/compliance-checklists.md` for the GDPR, HIPAA, PCI-DSS, and SOC 2 controls, the checks to run, when to flag CRITICAL, and the citations to give. Skills install side by side, so it sits next to this skill's directory.

**Compliance Gap Report Generation**:

- For each compliance framework, create section with:
  - Compliant controls ()
  - Partial compliance () with specific gaps
  - Non-compliant controls () with violations
  - Remediation priority (CRITICAL/IMPORTANT/SUGGESTION)
  - Estimated implementation effort (hours)
  - Regulatory citations for each requirement

**Compliance Finding Prioritization**:

- **CRITICAL**: Violations that could result in regulatory penalties or data breaches
- **IMPORTANT**: Violations that significantly increase compliance risk
- **SUGGESTION**: Partial compliance with minor gaps, or optional improvements beyond minimum compliance requirements

### CATEGORY 6: MONITORING AND ALERTING (IMPORTANT)

Check for:

- GuardDuty not enabled
- Security Hub not enabled
- Missing CloudWatch alarms for security events
- No automated remediation for security violations
- Missing SNS notifications for critical alerts
- Insufficient monitoring coverage

### CATEGORY 7: NETWORK SECURITY (IMPORTANT)

Check for:

- Overly permissive security groups (0.0.0.0/0 for non-HTTP/HTTPS)
- Missing VPC endpoints for AWS services
- Public access to resources that should be private
- Missing WAF protection for web applications
- Insufficient network segmentation
- Missing bastion hosts or Session Manager for SSH access

### CATEGORY 8: SECRETS MANAGEMENT (IMPORTANT)

Check for:

- Hardcoded secrets in code or configuration
- Long-term access keys instead of temporary credentials
- Missing Secrets Manager or Parameter Store usage
- Secrets not encrypted with KMS
- Missing automatic secret rotation
- Secrets access not audited

### CATEGORY 9: IDENTITY MANAGEMENT (IMPORTANT)

Check for:

- Long-term access keys instead of IAM roles
- Missing MFA for privileged accounts
- Weak password policies
- Shared credentials across users or applications
- Root account usage for daily operations
- Missing IAM Access Analyzer usage

### CATEGORY 10: SECURITY TESTING (SUGGESTION)

Check for:

- Missing IAM Policy Simulator validation
- No penetration testing plan
- Missing compliance scanning with AWS Config
- Insufficient security testing recommendations
- No automated security validation in CI/CD

## Validation Workflow

### STEP 1: Parse Security Design

- Extract IAM policies (identity-based and resource-based)
- Identify encryption configurations (KMS, S3, DynamoDB, RDS)
- List audit logging configurations (CloudTrail, service logs)
- Note monitoring and alerting setup (CloudWatch, GuardDuty, Security Hub)
- Extract compliance requirements
- Identify threat model references (if provided)
- **Note explicit design decisions** (e.g., "AWS-managed keys chosen for Internal/Confidential data")

### STEP 2: Run Validation Checks

- Execute all checks from validation framework
- Assign a severity to each finding (CRITICAL, IMPORTANT, or SUGGESTION)
- Calculate security impact score for each issue
- Estimate remediation effort
- Collect evidence for each finding

### STEP 3: Generate Findings

For each issue found:

- Apply the Rules: separate gaps from justified design decisions, and skip what the design already documents
- Describe the security problem clearly
- Explain the impact (security risk, compliance violation, operational risk)
- Provide specific remediation steps
- Show before/after code examples
- Reference AWS security documentation

### STEP 4: Calculate Security Metrics Using Structured Scoring Rubric

Calculate scores using the following rubric:

#### **IAM Policy Security Score (0-100)**

Start with 100 points, deduct for issues:

- **Wildcard actions without justification** (`Action: "*"`): -30 points per policy
- **Wildcard resources without justification** (`Resource: "*"`): -30 points per policy
- **Missing IAM conditions** (no condition block): -10 points per policy
- **Over-permissive managed policies** (e.g., `PowerUserAccess`): -15 points
- **Missing permission boundaries** (for delegated admin roles): -20 points
- **Cross-account access without restrictions**: -25 points
- **No trust policy defined**: -10 points per role

**Final Score** = max(0, 100 - Total Deductions)

#### **Encryption Coverage Score (0-100)**

Start with 100 points, deduct for issues:

- **Unencrypted data store** (DynamoDB, RDS, S3): -40 points each
- **AWS-managed keys** (when customer-managed recommended): -15 points per resource
- **No TLS enforcement** (missing bucket policy or API config): -30 points
- **No VPC endpoints** (for private AWS service access): -10 points
- **KMS key rotation disabled**: -10 points per key
- **Weak encryption algorithm** (< AES-256): -20 points

**Final Score** = max(0, 100 - Total Deductions)

#### **Audit Logging Completeness Score (0-100)**

Start with 100 points, deduct for issues:

- **CloudTrail not enabled**: -50 points
- **CloudTrail not multi-region**: -20 points
- **CloudTrail log file validation disabled**: -15 points
- **CloudTrail logs not encrypted**: -15 points
- **Missing service-specific logs** (S3, VPC Flow Logs): -10 points each
- **Insufficient log retention** (< 90 days): -10 points per log group
- **No CloudWatch alarms for security events**: -15 points
- **Logs not stored in secure bucket**: -10 points

**Final Score** = max(0, 100 - Total Deductions)

#### **Compliance Readiness Score (0-100)**

Start with 100 points, deduct for issues:

- **CRITICAL compliance gap** (e.g., incident response plan missing): -15 points each
- **IMPORTANT compliance gap** (e.g., DR testing not performed): -10 points each
- **SUGGESTION compliance gap** (e.g., access reviews not automated): -5 points each, or -2 for minor missing documentation

**Final Score** = max(0, 100 - Total Deductions)

#### **Overall Security Posture Score (0-100)**

Calculate weighted average:

```
Overall Score = (IAM Policy Score × 0.30) +
                (Encryption Score × 0.25) +
                (Audit Logging Score × 0.25) +
                (Compliance Score × 0.20)
```

**Interpretation**:

- **90-100**: Hardened Production (Best practices implemented)
- **80-89**: Standard Production (Good security posture)
- **70-79**: MVP Production (Minimum viable security)
- **60-69**: Warning (Needs improvements before production)
- **0-59**: Fail (Significant gaps, not production ready)

### STEP 5: Track Iterations (if applicable)

- Compare to previous review (if provided)
- List resolved security issues
- List new security issues
- Calculate security posture improvement percentage

**Previous Review Comparison Logic**:

- Parse previous validation report for issue identifiers
- Match current findings against previous findings by category and description
- Mark issues as "Resolved" if they no longer appear in current validation
- Mark issues as "Remaining" if they still exist with same severity
- Mark issues as "New" if they appear for the first time

**Resolved Issues Tracking**:

- List all issues from previous review that are no longer present
- Show before/after security scores for each category
- Highlight specific remediation actions that were implemented
- Acknowledge security posture improvements

**New Issues Identification**:

- List all issues that appear in current review but not in previous review
- Explain why new issues appeared (new resources, configuration changes, etc.)
- Prioritize new issues by severity
- Provide remediation recommendations

**Security Posture Improvement Calculation**:

```
Previous Overall Score: X/100
Current Overall Score: Y/100
Improvement: (Y - X) points
Improvement Percentage: ((Y - X) / X) * 100%

Category-Level Improvements:
- IAM Policy Security: Previous [X]/100 → Current [Y]/100 ([+/-Z]%)
- Encryption Coverage: Previous [X]/100 → Current [Y]/100 ([+/-Z]%)
- Audit Logging: Previous [X]/100 → Current [Y]/100 ([+/-Z]%)
- Compliance Readiness: Previous [X]/100 → Current [Y]/100 ([+/-Z]%)
```

Report the comparison in the `## Iteration Progress` section of the output template.

## Finding Templates

Use these templates for findings:

### CRITICAL FINDING

🔴 **CRITICAL**: [Security Issue Title]

**Category**: [Validation Category Name]

**Problem**: [Clear description of the security vulnerability]

**Impact**:

- **Security Risk**: [Specific security consequences - unauthorized access, data breach, etc.]
- **Compliance**: [Regulatory violations - GDPR, HIPAA, PCI-DSS]
- **Operational Risk**: [Business impact - data loss, service disruption]

**Current State**:

```json
{
  "Effect": "Allow",
  "Action": "s3:*",
  "Resource": "*"
}
```

**Recommended State**:

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::user-data-bucket/users/${aws:userid}/*",
  "Condition": {
    "StringEquals": {
      "s3:x-amz-server-side-encryption": "aws:kms"
    }
  }
}
```

**Remediation Steps**:

1. [Specific action 1]
2. [Specific action 2]
3. [Specific action 3]

**Effort**: [Low/Medium/High]

- **Low**: < 1 hour (simple configuration change)
- **Medium**: 1-4 hours (requires code changes or multiple configurations)
- **High**: > 4 hours (complex refactoring or architectural changes)

**Feasibility Check**:

- **Architecture Compatibility**: [ Compatible / Requires Changes / Incompatible]
  - [Explanation of compatibility with existing architecture]
- **Performance Impact**: [None / Low / Medium / High]
  - [Specific performance considerations, e.g., "Increases Lambda cold start by ~100-200ms"]
- **Implementation Complexity**: [Low / Medium / High]
  - [Explanation of technical complexity and required expertise]
- **AWS Service Limitations**: [None / List specific limitations]
  - [Any AWS quotas, regional availability, or service constraints]
- **Operational Impact**: [None / Low / Medium / High]
  - [Impact on operations, monitoring, or maintenance]

**References**: [AWS documentation links]

---

### IMPORTANT FINDING

🟡 **IMPORTANT**: [Security Issue Title]

[Same structure as CRITICAL]

---

### SUGGESTION FINDING

🟢 **SUGGESTION**: [Security Issue Title]

[Same structure as CRITICAL]

---

## Output Format Template

Keep the report short: list only new findings (see Rules).

Generate output in this format:

```markdown
# Security Policy Validation Report

## Validation Summary

| Metric                       | Score       | Status                       |
| ---------------------------- | ----------- | ---------------------------- |
| IAM Policy Security          | [0-100]     | [ Pass / Warning / Fail]     |
| Encryption Coverage          | [0-100]     | [ Pass / Warning / Fail]     |
| Audit Logging                | [0-100]     | [ Pass / Warning / Fail]     |
| Compliance Readiness         | [0-100]     | [ Pass / Warning / Fail]     |
| **Overall Security Posture** | **[0-100]** | **[ Pass / Warning / Fail]** |

**Total Issues**: [X] CRITICAL, [Y] IMPORTANT, [Z] SUGGESTION

**Status Legend**:

- Pass: Score ≥ 80
- Warning: Score 60-79
- Fail: Score < 60

## CRITICAL (Must Fix Before Deployment)

[List all CRITICAL findings using template]

## IMPORTANT (Should Fix)

[List all IMPORTANT findings using template]

## SUGGESTION (Consider Fixing)

[List all SUGGESTION findings using template]

## Security Metrics Breakdown

### IAM Policy Security Score: [X]/100

- No wildcard actions or resources
- Missing IAM conditions for fine-grained control
- Permission boundaries implemented
- **Recommendation**: [Specific improvement]

### Encryption Coverage Score: [X]/100

- All data stores encrypted at rest
- TLS not enforced for API Gateway
- KMS key rotation enabled
- **Recommendation**: [Specific improvement]

### Audit Logging Completeness Score: [X]/100

- CloudTrail enabled in all regions
- Log file validation enabled
- Missing VPC Flow Logs
- **Recommendation**: [Specific improvement]

### Compliance Readiness Score: [X]/100

- GDPR: Encryption and access controls compliant
- HIPAA: PHI found in CloudWatch Logs
- PCI-DSS: Network segmentation compliant
- **Recommendation**: [Specific improvement]

## Threat Model Coverage (if applicable)

| Threat ID | Threat Description   | Mitigation Status | Gap                          |
| --------- | -------------------- | ----------------- | ---------------------------- |
| T-001     | Unauthorized access  | Mitigated         | IAM policies with conditions |
| T-002     | Data exfiltration    | Partial           | Missing VPC endpoints        |
| T-003     | Privilege escalation | Not mitigated     | No permission boundaries     |

**Mitigation Status Legend**:

- Mitigated: Security control fully addresses the threat
- Partial: Security control partially addresses the threat, gaps remain
- Not mitigated: No security control assigned to this threat

## Compliance Gap Analysis

### [Framework] Compliance

- [Control]: [compliant / partial / violated, with the gap]

**Remediation Priority**: [CRITICAL/IMPORTANT/SUGGESTION]
**Estimated Effort**: [hours]
**Regulatory Citations**: [Citation (requirement)]

[Repeat for each framework in scope. A filled example is in `iam-policy-design/references/compliance-checklists.md`.]

## Iteration Progress (if applicable)

### Comparison to Previous Review

- **Previous Score**: [X]/100
- **Current Score**: [Y]/100
- **Improvement**: [+/-Z]% ([+/-W] points)

### Issues Resolved Since Last Review

1. **[Issue Title]** (Category: [Category], Severity: [CRITICAL/IMPORTANT/SUGGESTION])
   - Previous State: [Description]
   - Current State: [Description]
   - Remediation Applied: [Specific action taken]

### Issues Remaining from Previous Review

1. **[Issue Title]** (Category: [Category], Severity: [CRITICAL/IMPORTANT/SUGGESTION])
   - Status: Still present
   - Recommendation: [Updated remediation guidance]

### New Issues Identified

1. **[Issue Title]** (Category: [Category], Severity: [CRITICAL/IMPORTANT/SUGGESTION])
   - Reason: [Why this issue appeared]
   - Recommendation: [Remediation guidance]

### Security Posture Trend

- Issues Resolved: [X]
- Issues Remaining: [Y]
- New Issues: [Z]
- Net Improvement: [+/-W] issues

## Recommendations Summary

### Immediate Actions (CRITICAL and IMPORTANT)

1. **Remove PHI from CloudWatch Logs** (CRITICAL, 4-8 hours)
   - Implement log filtering to exclude PHI data
   - Use AWS Secrets Manager for sensitive data
   - Update application logging configuration

2. **Enable GuardDuty** (IMPORTANT, 1-2 hours)
   - Enable GuardDuty in all regions
   - Configure SNS notifications for findings
   - Set up automated remediation for critical threats

3. **Encrypt new S3 bucket** (CRITICAL, < 1 hour)
   - Enable default encryption with KMS customer-managed key
   - Add bucket policy to deny unencrypted uploads
   - Enable versioning and MFA delete

### Future Improvements (SUGGESTION)

1. **Implement data deletion capabilities** (SUGGESTION, 2-4 hours)
   - Configure S3 lifecycle policies for automatic deletion
   - Implement DynamoDB TTL for time-based deletion
   - Document data retention and deletion procedures

2. **Add VPC Flow Logs** (SUGGESTION, 1-2 hours)
   - Enable VPC Flow Logs for all VPCs
   - Store logs in CloudWatch Logs with 90-day retention
   - Create CloudWatch alarms for suspicious network activity

**Estimated Total Effort**: [X] hours
**Security Risk Reduction**: [High/Medium/Low]
**Compliance Impact**: [CRITICAL/IMPORTANT/SUGGESTION]

---

## Iteration Guidance

### Current State

- **Current Score**: [X]/100 ([MVP/Standard/Hardened] Production)
- **Production Readiness**: [Ready/Needs Improvements/Not Ready]

### To Reach Standard Production (80-89 points)

**Required Fixes** (Must address before production deployment):

1. [Finding ID]: [Finding Title] ([Effort], [+X points])
2. [Finding ID]: [Finding Title] ([Effort], [+X points])

**Estimated Effort**: [X] hours
**Expected Score After**: [Y]/100
**Timeline**: [Immediate/1 week/2 weeks]

### To Reach Hardened Production (90-100 points)

**Recommended Fixes** (Post-launch enhancements):

1. [Finding ID]: [Finding Title] ([Effort], [+X points])
2. [Finding ID]: [Finding Title] ([Effort], [+X points])

**Estimated Effort**: [X] hours
**Expected Score After**: [Y]/100
**Timeline**: [1 month/3 months/6 months]

### Optional Enhancements

**Nice-to-Have Improvements** (SUGGESTION):

1. [Finding ID]: [Finding Title] ([Effort], [+X points])
2. [Finding ID]: [Finding Title] ([Effort], [+X points])

**Estimated Effort**: [X] hours
**Expected Score After**: [Y]/100

### Iteration Priority Matrix

| Finding ID | Priority   | Effort | Points | ROI (Points/Hour) | Recommended Iteration        |
| ---------- | ---------- | ------ | ------ | ----------------- | ---------------------------- |
| [ID]       | CRITICAL   | [X]h   | +[Y]   | [Z]               | Iteration 1                  |
| [ID]       | IMPORTANT  | [X]h   | +[Y]   | [Z]               | Iteration 1 (ROI > 2.0) or 2 |
| [ID]       | SUGGESTION | [X]h   | +[Y]   | [Z]               | Iteration 2 or later         |

**ROI Calculation**: Points gained ÷ Hours of effort = Points per hour

**Iteration Strategy**:

- **Iteration 1** (Before Production): Fix all CRITICAL findings, and IMPORTANT findings with ROI > 2.0
- **Iteration 2** (Post-Launch): Fix the remaining IMPORTANT findings, and SUGGESTION findings with ROI > 1.0
- **Optional**: Fix the remaining SUGGESTION findings when time permits
```

---

## Quality Gate

**CRITICAL (must fix):**

- Wildcard actions on sensitive services without documented justification
- Cross-account trust without `ExternalId` or condition keys
- KMS key policies allow `kms:*` to non-admin principals
- S3 bucket policies allow public access

**IMPORTANT (should fix):**

- Roles have permissions not required by any documented access pattern
- Missing `aws:RequestedRegion` conditions for region-locked services
- No resource tagging conditions to scope access

**SUGGESTION:**

- Could add `aws:CalledVia` conditions for service-to-service calls
- Could tighten `s3:GetObject` to specific key prefixes

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
