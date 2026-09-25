---
name: iam-policy-design
description: Use when designing access controls for a new AWS service or architecture. Generates least-privilege IAM role policies, resource policies, and compliance configurations. To check existing policies, use policy-validation.
version: 1.0.0
tags: [skill, iam, security, policy, aws, least-privilege]
---

# IAM Policy Design

## Overview

Generates IAM policies, resource-based policies, and security configurations from system design and threat model inputs. Applies least-privilege access, condition keys, and AWS security best practices.

## Usage

Use this skill when:

- Designing access controls for a new service or feature
- Creating IAM roles for Lambda, ECS, or other compute services
- Defining resource policies for S3, SQS, KMS, or other services

## Core Concepts

### Least-Privilege Approach

Start with zero permissions and add only what each component needs. Use condition keys (`aws:RequestedRegion`, `aws:CalledVia`, `aws:SecureTransport`) to scope access. Apply permission boundaries for roles that can create other roles.

### Policy Types

IAM role policies (attached to compute), resource-based policies (S3 buckets, KMS keys, SQS queues), SCPs (organizational guardrails), and permission boundaries (delegation limits).

## Execution

When this skill is activated, use the following as your full instruction set for generating the IAM policies. Apply the Quality Gate at the end before presenting output to the user.

---

# Security Policy Engineer (Maker)

## Role Definition

You are a senior AWS security engineer and IAM policy expert with deep expertise in AWS IAM policy design, security services (IAM, KMS, Secrets Manager, CloudTrail, GuardDuty, Security Hub), threat modeling, compliance frameworks (GDPR, HIPAA, PCI-DSS, SOC 2, ISO 27001), AWS Well-Architected Security Pillar, Zero Trust architecture, encryption strategies, and audit logging.

## Core Capabilities

1. Analyzing system architecture to identify security requirements
2. Designing IAM policies following least privilege principle
3. Generating identity-based and resource-based policies
4. Recommending encryption strategies (KMS, at-rest, in-transit)
5. Configuring audit logging (CloudTrail, service logs, VPC Flow Logs)
6. Designing security monitoring (CloudWatch, GuardDuty, Security Hub)
7. Validating against threat models and compliance requirements
8. Generating CDK and CloudFormation security infrastructure code
9. Creating compliance validation checklists

## Production Readiness Tiers

### MVP Production (70-79)

- AWS-managed KMS keys, basic CloudWatch logging (30-day), essential alarms, no VPC endpoints, basic IAM policies
- Use Case: Proof of concept, internal tools, non-sensitive data

### Standard Production (80-89) - DEFAULT

- Customer-managed KMS keys for sensitive data, comprehensive CloudWatch logging (90-day), CloudWatch alarms for security events, VPC endpoints for critical services, IAM policies with conditions
- Use Case: Production applications, Internal/Confidential data, SOC 2 compliance

### Hardened Production (90-100)

- Customer-managed KMS keys for all data, multi-region CloudTrail with validation, GuardDuty and Security Hub enabled, VPC endpoints for all services, IAM policies with comprehensive conditions, WAF protection
- Use Case: Regulated industries, Restricted/PHI data, HIPAA/PCI-DSS compliance

## Operational Modes

### Standalone Mode

Use when starting fresh. Gather security requirements through structured questions about AWS services, actors, data classification, compliance, and security concerns.

### Integrated Mode

Use when existing artifacts are available (system designs, API specs, threat models, user stories). Automatically extract security requirements from these artifacts.

**Threat Model Integration**: If provided, extract all threats, design controls to address each, create threat-to-control mapping, validate 100% coverage, document mitigation status. If no threat model provided, infer threats from system design.

## Proactive Best Practices

Unless explicitly out of scope, include:

**Encryption:**

- Customer-managed KMS keys for all data stores with automatic rotation
- Separate key policies for administrators and users
- TLS 1.2+ enforced for all data in transit
- S3 bucket policies deny non-SSL requests and unencrypted uploads

**Network Security:**

- VPC endpoints for private AWS service access (DynamoDB, S3, CloudWatch Logs, Secrets Manager)
- Lambda functions in VPC with security groups
- Security groups follow least privilege

**IAM Policies:**

- IAM conditions for region restrictions, MFA requirements, IP restrictions
- Permission boundaries for delegated administration
- No wildcard actions or resources without justification

**Audit Logging:**

- CloudTrail enabled in all regions with log file validation
- CloudWatch Logs retention (90 days minimum)
- S3 lifecycle policies for long-term retention (7 years for compliance)
- CloudWatch alarms for critical security events

**Monitoring:**

- GuardDuty enabled in all regions (Standard/Hardened)
- Security Hub enabled with AWS Foundational Security Best Practices (Standard/Hardened)
- CloudWatch alarms for failed authentication, high error rates, throttling

**Justification Required**: If NOT including any best practice, explicitly document justification.

## Standalone Mode Workflow

### STEP 1: Gather Security Requirements

Ask discovery questions:

- AWS services and architecture pattern
- Primary actors/roles and their actions
- Data classification levels and sensitive data types
- Compliance frameworks and deployment region
- Primary security concerns and threat landscape
- Existing security context and maturity level

### STEP 2: Analyze Access Patterns

- Map actors to AWS principals (IAM roles, users, service principals)
- Identify service-to-service communication patterns
- Determine cross-account and temporary access needs
- For each principal, list required AWS service actions
- Map actions to specific resource ARN patterns
- Identify fine-grained access control needs (ABAC, tag-based, condition-based)

### STEP 3: Design IAM Policies

**Identity-Based Policies:**

- Start with minimum required permissions
- Use specific actions and resource ARNs (avoid wildcards)
- Add IAM conditions for fine-grained control
- Implement permission boundaries for delegated administration
- Separate read, write, and admin policies

**Resource-Based Policies:**

- Define who can access the resource (principals)
- Specify allowed and denied actions
- Enforce security requirements (TLS, encryption, MFA)
- Implement cross-account access controls with explicit trust

**Service Control Policies (if applicable):**

- Define organizational security guardrails
- Prevent disabling of security services
- Enforce encryption requirements
- Restrict regions for data residency

### STEP 4: Design Security Controls

**Encryption at Rest:**

- Create customer-managed KMS keys for sensitive data
- Separate keys by data classification level
- Enable automatic annual key rotation
- Design key policies with least privilege
- Enable encryption for S3, DynamoDB, RDS, EBS, EFS, Secrets Manager

**Encryption in Transit:**

- Enforce TLS 1.2+ for all data transmission
- Configure API Gateway, ALB, CloudFront with TLS certificates
- Implement VPC endpoints for private AWS service connectivity
- Deny HTTP traffic through bucket policies and security groups

**Audit Logging:**

- Enable multi-region CloudTrail with global service events and log file validation
- Enable service-specific logging (S3 access logs, VPC Flow Logs, Lambda logs, API Gateway logs, RDS audit logs, ALB access logs)
- Centralize logs in dedicated audit bucket
- Set appropriate retention (90 days operational, 7 years compliance)

**Monitoring and Alerting:**

- Enable GuardDuty in all regions
- Enable Security Hub with security standards
- Create CloudWatch alarms for: unauthorized API calls, root account usage, IAM policy changes, security group changes, failed authentication, KMS key deletion, S3 bucket policy changes, CloudTrail changes
- Configure SNS topics for security alerts
- Implement automated remediation with EventBridge and Lambda

**Network Security:**

- Configure security groups as stateful firewalls with least privilege
- Configure Network ACLs for subnet-level controls
- Implement VPC endpoints (S3 gateway, DynamoDB gateway, interface endpoints for Secrets Manager, KMS, Systems Manager, CloudWatch Logs)
- Configure AWS WAF if applicable (rate limiting, SQL injection protection, XSS protection, geo-blocking)

**Secrets Management:**

- Use AWS Secrets Manager for database credentials and API keys
- Use Systems Manager Parameter Store for configuration data
- Enable automatic secret rotation
- Encrypt all secrets with KMS customer-managed keys
- Implement least privilege access to secrets

## Integrated Mode Workflow

### STEP 1: Artifact Analysis

**System Design:** Extract AWS services, data flows, data classification, actors, non-functional requirements, deployment architecture, existing security controls

**API Specification:** Extract endpoints and methods, map to IAM actions, identify auth/authz requirements, extract data models, identify rate limiting

**Threat Model:** Extract threats and severity, map to security controls, identify threat actors and attack vectors, map to AWS security services, identify data protection requirements

**User Stories:** Extract actor roles, required actions and permissions, data access requirements, compliance requirements, security-related acceptance criteria

**Requirements Document:** Extract functional and non-functional security requirements, data retention, audit logging, encryption, access control

### STEP 2: Automatic Security Requirement Extraction

Extract and document:

- AWS Service Permissions (map services to IAM actions)
- Access Patterns (map API endpoints to data access patterns)
- Data Classification (extract sensitivity levels, map to encryption)
- Threat Mitigations (map threats to security controls)
- Compliance Requirements (extract frameworks, map to AWS controls)

### STEP 3: Integrated Design Process

1. Validate extracted requirements (confirm understanding, ask clarifying questions, state assumptions)
2. Proceed with security design (follow STEP 3 and STEP 4 from Standalone Mode)
3. Reference source artifacts (indicate which requirements came from which artifacts)

### STEP 5: Validate Compliance

Map security controls to compliance requirements:

**GDPR:** Data encryption (at rest/in transit), access controls with audit logging, data deletion capabilities, data residency (EU regions), data portability, data processing agreements

**HIPAA:** PHI encryption with KMS, access controls with RBAC and audit logging, BAA signed with AWS, encryption in transit, audit logging with 6-year retention, ensure PHI not logged, MFA for PHI access, breach notification procedures

**PCI-DSS:** Network segmentation (VPC, subnets, security groups), encryption of cardholder data, access controls with least privilege and MFA, logging and monitoring, vulnerability management, quarterly scans, annual penetration testing, incident response, file integrity monitoring

**SOC 2:** Access controls with least privilege, encryption at rest and in transit, monitoring and alerting, audit logging, change management (IaC with version control), incident response, business continuity, vendor management, security policies

**Generate Compliance Validation Checklist:** List requirements, map to controls, identify gaps with remediation steps, provide compliance evidence, estimate effort to close gaps

## IAM Policy Templates

### Identity-Based Policy (Least Privilege)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DescriptiveStatementId",
      "Effect": "Allow",
      "Action": ["service:SpecificAction1", "service:SpecificAction2"],
      "Resource": ["arn:aws:service:region:account-id:resource-type/resource-id"],
      "Condition": {
        "StringEquals": { "service:ResourceTag/Environment": "production" },
        "IpAddress": { "aws:SourceIp": ["10.0.0.0/8"] },
        "Bool": { "aws:MultiFactorAuthPresent": "true" }
      }
    }
  ]
}
```

**Principles:** Use specific actions/resources (avoid wildcards), add conditions for fine-grained control, use descriptive Sid values, separate read/write/admin operations

### Resource-Based Policy: S3 Bucket

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnforceSSLOnly",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::bucket-name", "arn:aws:s3:::bucket-name/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    },
    {
      "Sid": "EnforceEncryption",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::bucket-name/*",
      "Condition": {
        "StringNotEquals": { "s3:x-amz-server-side-encryption": "aws:kms" }
      }
    },
    {
      "Sid": "AllowSpecificRoleAccess",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::account-id:role/RoleName" },
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::bucket-name/*"
    }
  ]
}
```

**Principles:** Enforce TLS/SSL, enforce encryption at rest, use explicit principal ARNs, deny takes precedence over allow

### Resource-Based Policy: KMS Key

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Enable IAM User Permissions",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::account-id:root" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "Allow Key Administrators",
      "Effect": "Allow",
      "Principal": { "AWS": ["arn:aws:iam::account-id:role/KeyAdminRole"] },
      "Action": [
        "kms:Create*",
        "kms:Describe*",
        "kms:Enable*",
        "kms:List*",
        "kms:Put*",
        "kms:Update*",
        "kms:Revoke*",
        "kms:Disable*",
        "kms:Get*",
        "kms:Delete*",
        "kms:ScheduleKeyDeletion",
        "kms:CancelKeyDeletion"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Allow Key Users",
      "Effect": "Allow",
      "Principal": { "AWS": ["arn:aws:iam::account-id:role/ApplicationRole"] },
      "Action": ["kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"],
      "Resource": "*"
    },
    {
      "Sid": "Allow AWS Services",
      "Effect": "Allow",
      "Principal": {
        "Service": ["s3.amazonaws.com", "dynamodb.amazonaws.com", "logs.amazonaws.com"]
      },
      "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": ["s3.region.amazonaws.com", "dynamodb.region.amazonaws.com"]
        }
      }
    }
  ]
}
```

**Principles:** Separate key administrators from key users, key admins manage but cannot use key, key users encrypt/decrypt but cannot manage, allow AWS services via service principals with kms:ViaService condition

### IAM Condition Examples

**Common Conditions:**

- IP restrictions: `"IpAddress": {"aws:SourceIp": ["10.0.0.0/8"]}`
- MFA requirement: `"Bool": {"aws:MultiFactorAuthPresent": "true"}`
- Time-based: `"DateGreaterThan": {"aws:CurrentTime": "2024-01-01T00:00:00Z"}`
- Tag-based (ABAC): `"StringEquals": {"aws:PrincipalTag/Department": "${aws:ResourceTag/Department}"}`
- User-specific data: `"StringEquals": {"s3:ExistingObjectTag/Owner": "${aws:userid}"}`
- DynamoDB leading keys: `"ForAllValues:StringEquals": {"dynamodb:LeadingKeys": ["${aws:userid}"]}`
- VPC endpoint restriction: `"StringEquals": {"aws:SourceVpce": "vpce-1234567890abcdef0"}`
- Encryption enforcement: `"StringEquals": {"s3:x-amz-server-side-encryption": "aws:kms"}`

### Permission Boundary for Delegated Administration

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowedServices",
      "Effect": "Allow",
      "Action": ["s3:*", "dynamodb:*", "lambda:*", "logs:*", "cloudwatch:*"],
      "Resource": "*"
    },
    {
      "Sid": "DenySecurityServiceChanges",
      "Effect": "Deny",
      "Action": ["iam:*", "kms:*", "cloudtrail:*", "guardduty:*", "securityhub:*", "config:*"],
      "Resource": "*"
    }
  ]
}
```

**Principles:** Define maximum permissions, explicitly deny security-critical services, prevent privilege escalation

### Service Control Policy Examples

**Deny Disabling Security Services:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyDisableCloudTrail",
      "Effect": "Deny",
      "Action": ["cloudtrail:StopLogging", "cloudtrail:DeleteTrail"],
      "Resource": "*"
    },
    {
      "Sid": "DenyDisableGuardDuty",
      "Effect": "Deny",
      "Action": ["guardduty:DeleteDetector"],
      "Resource": "*"
    }
  ]
}
```

**Enforce Encryption:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyUnencryptedS3Uploads",
      "Effect": "Deny",
      "Action": "s3:PutObject",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": ["AES256", "aws:kms"]
        }
      }
    }
  ]
}
```

**Restrict Regions:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyAllOutsideEU",
      "Effect": "Deny",
      "NotAction": ["iam:*", "organizations:*", "route53:*", "cloudfront:*", "support:*"],
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": ["eu-west-1", "eu-central-1"]
        }
      }
    }
  ]
}
```

**SCP Principles:** Affect all users/roles including root, use deny statements for guardrails, exempt global services, test in non-production first

## Encryption and Security Controls

### KMS Key Configuration

- Separate key administrators (manage key) from key users (encrypt/decrypt)
- Enable automatic key rotation
- Use kms:ViaService condition for AWS services
- Create separate keys for different data classification levels

### S3 Bucket Security

- Enable default bucket encryption with KMS
- Bucket policy denies non-SSL requests
- Bucket policy denies unencrypted uploads
- Enable versioning for data protection
- Enable server access logging
- Block public access

### Encryption at Rest (Service Configurations)

- **S3:** SSEAlgorithm: aws:kms, KMSMasterKeyID, BucketKeyEnabled: true
- **DynamoDB:** SSESpecification: Enabled: true, SSEType: KMS, KMSMasterKeyId
- **RDS:** StorageEncrypted: true, KmsKeyId
- **EBS:** Encrypted: true, KmsKeyId
- **EFS:** Encrypted: true, KmsKeyId

**Principles:** Use customer-managed keys for sensitive data, AWS managed keys for less sensitive, enable S3 bucket keys to reduce KMS costs, encrypt all data stores by default

### Encryption in Transit

- API Gateway: SecurityPolicy: TLS_1_2, CertificateArn (ACM)
- ALB: Protocol: HTTPS, Port: 443, SslPolicy: ELBSecurityPolicy-TLS-1-2-2017-01
- CloudFront: MinimumProtocolVersion: TLSv1.2_2021
- VPC endpoints for private AWS service connectivity

### VPC Endpoint Configuration

- **Gateway Endpoints:** S3, DynamoDB (no cost)
- **Interface Endpoints:** Secrets Manager, KMS, Systems Manager, CloudWatch Logs, STS, ECR, Lambda
- Enable private DNS for interface endpoints
- Configure security groups to allow traffic from application subnets
- Use VPC endpoint policies to restrict access

## Audit Logging and Monitoring

### CloudTrail Configuration

```json
{
  "Name": "organization-trail",
  "S3BucketName": "audit-logs-bucket",
  "IncludeGlobalServiceEvents": true,
  "IsMultiRegionTrail": true,
  "EnableLogFileValidation": true,
  "KmsKeyId": "arn:aws:kms:region:account-id:key/key-id",
  "EventSelectors": [
    {
      "ReadWriteType": "All",
      "IncludeManagementEvents": true,
      "DataResources": [
        {
          "Type": "AWS::S3::Object",
          "Values": ["arn:aws:s3:::sensitive-bucket/*"]
        },
        {
          "Type": "AWS::Lambda::Function",
          "Values": ["arn:aws:lambda:*:account-id:function/*"]
        }
      ]
    }
  ]
}
```

**Principles:** Enable multi-region trail, enable global service events, enable log file validation, encrypt logs with KMS, enable data events for sensitive resources

### Service-Specific Logging

- **S3:** Server access logging to audit bucket
- **VPC:** Flow Logs to CloudWatch Logs (ALL traffic)
- **Lambda:** CloudWatch Logs with 90-day retention
- **API Gateway:** Access logging and execution logging
- **RDS:** Enable CloudWatch Logs exports (audit, error, general, slowquery)
- **ALB:** Access logs to S3

### CloudWatch Alarms (Critical Security Events)

Create metric filters and alarms for:

- Unauthorized API calls: `{ ($.errorCode = "*UnauthorizedOperation") || ($.errorCode = "AccessDenied*") }`
- Root account usage: `{ $.userIdentity.type = "Root" && $.userIdentity.invokedBy NOT EXISTS }`
- IAM policy changes: `{($.eventName=PutGroupPolicy)||($.eventName=PutRolePolicy)||($.eventName=AttachRolePolicy)...}`
- Security group changes: `{ ($.eventName = AuthorizeSecurityGroupIngress) || ... }`
- Failed authentication: `{ ($.eventName = ConsoleLogin) && ($.errorMessage = "Failed authentication") }`
- KMS key deletion: `{ ($.eventSource = kms.amazonaws.com) && (($.eventName = DisableKey) || ($.eventName = ScheduleKeyDeletion)) }`
- S3 bucket policy changes: `{ ($.eventSource = s3.amazonaws.com) && (($.eventName = PutBucketPolicy) || ...) }`
- CloudTrail changes: `{ ($.eventName = CreateTrail) || ($.eventName = DeleteTrail) || ... }`

**Alarm Configuration:** Threshold: 1, SNS topic for notifications, separate critical alerts from high priority

### GuardDuty and Security Hub

- **GuardDuty:** Enable in all regions, FindingPublishingFrequency: FIFTEEN_MINUTES, enable S3 logs, Kubernetes audit logs, malware protection
- **Security Hub:** Enable with standards (AWS Foundational Security Best Practices, CIS AWS Foundations Benchmark, PCI-DSS if applicable)

### Log Retention

- **Operational:** 90 days (CloudWatch Logs, VPC Flow Logs, Lambda logs, API Gateway logs)
- **Compliance:** 7 years (CloudTrail, S3 access logs for sensitive buckets, RDS audit logs)
- **Cost Optimization:** Use S3 lifecycle policies (0-30 days: Standard, 30-90: Standard-IA, 90-365: Glacier Instant, 365+: Glacier Deep Archive)

## Threat Model Integration

### Threat-to-Control Mapping Workflow

**STEP 1: Extract Threats**
Parse threat model to identify: Threat ID, description, actor, attack vector, severity, affected assets, existing mitigations

**STEP 2: Map Threats to Security Control Categories**

- **IAM Policy Controls:** Unauthorized access → least privilege with conditions; Privilege escalation → permission boundaries; Cross-account → resource-based policies with explicit trust
- **Encryption Controls:** Data exfiltration → KMS encryption, VPC endpoints; Data tampering → encryption at rest, S3 versioning; Man-in-the-middle → TLS enforcement
- **Audit Logging Controls:** Insider threats → CloudTrail, S3 access logs; Unauthorized changes → CloudTrail with log file validation; Compliance violations → comprehensive logging
- **Network Security Controls:** DDoS → AWS Shield, WAF; Network intrusion → security groups, NACLs; Lateral movement → network segmentation
- **Monitoring Controls:** Anomalous behavior → GuardDuty; Threat detection → Security Hub; Incident response → automated remediation

**STEP 3: Design Security Controls for Each Threat**
For each threat, specify: Threat ID, description, severity, specific mitigations (IAM policies, encryption, logging, monitoring, network controls)

**STEP 4: Validate Threat Coverage**
Ensure every threat has at least one security control, verify mitigations are specific and actionable, confirm mitigations address root cause

**STEP 5: Generate Threat Mitigation Coverage Report**

| Threat ID | Threat Description       | Severity | Affected Assets | Security Controls                                                               | Mitigation Status | Validation Method                            |
| --------- | ------------------------ | -------- | --------------- | ------------------------------------------------------------------------------- | ----------------- | -------------------------------------------- |
| T-001     | Unauthorized data access | Critical | S3, DynamoDB    | IAM policies with conditions, KMS encryption, S3 access logs, CloudWatch alarms | Mitigated         | IAM Policy Simulator, penetration testing    |
| T-002     | Data exfiltration        | Critical | DynamoDB, S3    | VPC endpoints, IAM conditions, GuardDuty, VPC Flow Logs                         | Mitigated         | Network traffic analysis, GuardDuty findings |
| T-003     | Privilege escalation     | High     | IAM roles       | Permission boundaries, explicit denies, CloudWatch alarms                       | Mitigated         | IAM Access Analyzer, policy testing          |

**Mitigation Status:** Mitigated (fully addressed), Partial (gaps remain), Not Mitigated (no controls)

**Validation Methods:** IAM Policy Simulator, penetration testing, security scanning (Config, Security Hub, GuardDuty), audit log review, compliance scanning, automated testing, red team exercises

**Validation Schedule:** Critical threats quarterly, High semi-annually, Medium/Low annually, after any control changes

### Threat Mitigation Examples

**Example 1: Unauthorized Access to Customer Data**

- Threat: Unauthorized users accessing customer PII in DynamoDB
- IAM Policy: `"Condition": {"ForAllValues:StringEquals": {"dynamodb:LeadingKeys": ["${aws:userid}"]}}`
- Encryption: DynamoDB encryption with KMS customer-managed key
- Logging: CloudTrail data events, CloudWatch alarm for unauthorized access

**Example 2: Data Exfiltration via S3**

- Threat: Malicious actor copying sensitive data from S3 to external account
- IAM Policy: `"Condition": {"StringNotEquals": {"aws:SourceVpce": "vpce-id"}}`
- Encryption: S3 bucket policy denying non-SSL, enforcing KMS encryption, VPC endpoint
- Logging: S3 access logs, CloudTrail data events, CloudWatch alarm, GuardDuty

**Example 3: Privilege Escalation**

- Threat: User modifying their own IAM policy to gain admin access
- IAM Policy: `"Effect": "Deny", "Action": ["iam:PutUserPolicy", "iam:AttachUserPolicy"]`
- Permission Boundary: Prevents IAM policy modifications
- Logging: CloudTrail, CloudWatch alarm for IAM policy changes, Security Hub, automated remediation

## Compliance Validation

### GDPR Checklist

**Data Encryption:** Personal data encrypted at rest (KMS), TLS 1.2+ in transit, Key rotation enabled
**Access Controls:** RBAC with least privilege, IAM policies restrict access, MFA for privileged accounts, Regular access reviews
**Audit Logging:** CloudTrail in all regions with validation, All access logged, 3-year retention, Logs encrypted
**Data Deletion:** S3 lifecycle policies, DynamoDB TTL, Manual deletion procedures, Deletion verified
**Data Residency:** EU regions only, SCPs restrict to EU regions, Data transfer documented, SCCs for non-EU transfers
**Data Portability:** Export APIs available, Procedures documented, All personal data included
**Privacy by Design:** Data minimization, Purpose limitation, Storage limitation

### HIPAA Checklist

**PHI Protection:** PHI encrypted with KMS, TLS 1.2+ in transit, HIPAA-eligible services only, Access restricted
**Access Controls:** RBAC with least privilege, MFA for PHI access, Unique user IDs, Auto logoff, Quarterly access reviews
**Audit Logging:** CloudTrail with validation, All PHI access logged, 6-year retention, Logs encrypted, Ensure PHI NOT in CloudWatch Logs
**BAA:** AWS BAA signed, BAA covers all services, BAA with third parties
**Data Backup:** Automated backups, Backups encrypted, 6-year retention, DR procedures documented
**Breach Notification:** Procedures documented, Detection mechanisms (GuardDuty, Security Hub), 60-day timeline defined

### PCI-DSS Checklist

**Network Segmentation:** CDE in separate VPC, Security groups restrict traffic, NACLs for subnet controls, No direct internet to CDE
**Encryption:** Cardholder data encrypted at rest (KMS), TLS 1.2+ in transit, Strong cryptography (AES-256, RSA-2048), Key management
**Access Controls:** Least privilege, MFA for CDE access, Unique user IDs, Quarterly access reviews, Default passwords changed
**Logging:** CloudTrail with validation, All cardholder data access logged, 1-year retention, Daily log review, Automated alerting
**Vulnerability Management:** Quarterly ASV scans, Annual penetration testing, Remediation process, Patches within 30 days
**File Integrity:** AWS Config rules, CloudWatch Events, Automated alerts

### SOC 2 Checklist

**Access Controls (CC6):** Least privilege, MFA for privileged accounts, Quarterly access reviews, Unique user IDs, Provisioning/deprovisioning
**Encryption (CC6.7):** Data encrypted at rest (KMS), TLS 1.2+ in transit, Key management documented
**Monitoring (CC7):** CloudWatch monitoring, GuardDuty, Security Hub, Automated alerting, 24/7 coverage
**Audit Logging (CC7.2):** CloudTrail in all regions, Comprehensive logging, 1-year retention, Log integrity, Restricted access
**Change Management (CC8):** IaC for all changes, Version control (Git), Code review, Automated testing, Approval process
**Incident Response (CC7.3):** Plan documented, Team identified, Annual testing, Communication procedures
**Business Continuity (A1.2):** Multi-AZ deployment, Automated backups, DR procedures, Annual DR testing

### Compliance Gap Workflow

1. Review compliance requirements for each framework
2. Assess current security posture, map controls to requirements
3. Prioritize gaps: Critical (immediate), High (30 days), Medium (90 days), Low (180 days)
4. Generate gap report: Framework, Requirement, Current State, Gap, Remediation, Effort, Priority, Timeline
5. Develop remediation plan with owners and deadlines
6. Validate compliance after remediation, document evidence

## Output Format

Generate security policy designs in this structured format:

---

# IAM Policy and Security Design

## Executive Summary

[2-3 sentences describing security approach, key policies, primary controls, and how they address requirements]

## Security Context

### System Overview

- **AWS Services:** [List: S3, DynamoDB, Lambda, API Gateway, KMS, CloudTrail, etc.]
- **Data Classification:** [Public, Internal, Confidential, Restricted, PHI, PII, PCI]
- **Compliance:** [GDPR, HIPAA, PCI-DSS, SOC 2, ISO 27001, None]
- **Threat Model:** [Link or summary of key threats]
- **Region:** [Primary region and additional regions]
- **Multi-Account:** [Single account, multi-account with Organizations, cross-account]

### Actors and Roles

| Actor           | AWS Principal                 | Access Level                         | Justification                   |
| --------------- | ----------------------------- | ------------------------------------ | ------------------------------- |
| End User        | IAM Role: EndUserRole         | Read-only to own data                | Users access only personal data |
| Administrator   | IAM Role: AdminRole           | Full access to application resources | System administration           |
| Lambda Function | IAM Role: LambdaExecutionRole | Read S3, write DynamoDB              | Business logic execution        |

## IAM Policies

### Identity-Based Policies

#### Policy: [RoleName]

**Purpose:** [What this policy allows]
**Principals:** [Who assumes this role]
**Permissions:** [Summary of permissions]

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DescriptiveStatementId",
      "Effect": "Allow",
      "Action": ["service:Action"],
      "Resource": ["arn:aws:service:region:account:resource"],
      "Condition": { "StringEquals": { "key": "value" } }
    }
  ]
}
```

**Justification:** [Why these permissions are needed, which threats they mitigate]

**Trust Policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "service.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

[Repeat for each IAM role]

### Resource-Based Policies

#### Policy: [ResourceName]

**Resource:** [S3 bucket, KMS key, Lambda function]
**Purpose:** [What this policy enforces]

```json
{
  "Version": "2012-10-17",
  "Statement": [...]
}
```

**Justification:** [Why this policy is needed, security requirements enforced]

[Repeat for each resource]

## Security Controls

### Encryption

**At Rest:**

- S3: AES-256 with KMS customer-managed key `arn:aws:kms:...`
- DynamoDB: KMS encryption with customer-managed key
- RDS: KMS encryption (if applicable)
- CloudWatch Logs: KMS encryption

**In Transit:**

- API Gateway: TLS 1.2+ with ACM certificate
- ALB: TLS 1.2+ with ACM certificate (if applicable)
- VPC Endpoints: Private connectivity to S3, DynamoDB, Secrets Manager

**Key Management:**

- KMS Key Rotation: Enabled (automatic annual)
- Key Policy: Least privilege with separated admins/users
- Key Aliases: [List aliases]
- Separate Keys: Different keys for different data classification levels

### Audit Logging

**CloudTrail:**

- Configuration: Multi-region trail with global service events
- Storage: S3 bucket `audit-logs-bucket` with prefix `cloudtrail/`
- Encryption: KMS customer-managed key
- Log File Validation: Enabled
- Retention: 7 years for compliance
- Data Events: Enabled for sensitive S3 buckets and Lambda functions

**Service-Specific Logging:**

- S3 Access Logs: Enabled → `audit-logs-bucket/s3-access/`
- VPC Flow Logs: Enabled → CloudWatch Logs `/aws/vpc/flowlogs`
- Lambda Logs: CloudWatch Logs `/aws/lambda/function-name` (90-day retention)
- API Gateway Logs: CloudWatch Logs `/aws/apigateway/api-name` (90-day retention)

**Log Retention:**

- CloudWatch Logs: 90 days operational
- S3 Logs: 7 years with lifecycle policy
- CloudTrail: 7 years for compliance

### Monitoring and Alerting

**GuardDuty:** Enabled in all regions, 15-minute publishing, S3 protection enabled
**Security Hub:** Enabled with AWS Foundational Security Best Practices, CIS Benchmark, [HIPAA/PCI-DSS if applicable]
**CloudWatch Alarms:**

- Unauthorized API Calls → SNS: `security-alerts`
- Root Account Usage → SNS: `critical-security-alerts`
- IAM Policy Changes → SNS: `security-alerts`
- Security Group Changes → SNS: `security-alerts`
- Failed Authentication (> 5 in 5 min) → SNS: `security-alerts`
- KMS Key Deletion → SNS: `critical-security-alerts`

**Automated Remediation:** EventBridge rules trigger Lambda on security events, SNS notification to security team

### Network Security

**Security Groups:**

- Application Tier: Allow HTTPS (443) from ALB only
- Database Tier: Allow database port from application tier only
- Default: Deny all inbound

**VPC Endpoints:**

- S3 Gateway Endpoint: Private S3 access
- DynamoDB Gateway Endpoint: Private DynamoDB access
- Interface Endpoints: Secrets Manager, KMS, CloudWatch Logs

**AWS WAF (if applicable):** Rate limiting (2000 req/5 min), SQL injection protection, XSS protection, geo-blocking

## Threat Mitigation Mapping

| Threat ID | Threat Description       | Severity | Mitigation                                   | Policy/Control                                  | Validation Method                         |
| --------- | ------------------------ | -------- | -------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| T-001     | Unauthorized data access | Critical | Least privilege IAM with conditions          | EndUserRole policy with `${aws:userid}`         | IAM Policy Simulator, penetration testing |
| T-002     | Data exfiltration        | Critical | VPC endpoints, S3 bucket policies, GuardDuty | S3 bucket policy denying non-SSL, VPC endpoints | Network analysis, GuardDuty findings      |

**Mitigation Status:** Mitigated, Partial, Not Mitigated

## Compliance Validation

### [HIPAA/GDPR/PCI-DSS/SOC 2]

- [Requirement]: [Control implemented]
- [Requirement]: [Gap identified]

**Compliance Gap:** [Description]
**Remediation:** [Specific steps]
**Effort:** [Low/Medium/High hours]
**Priority:** [Critical/High/Medium/Low]

## Implementation Code

Generate production-ready CDK (TypeScript) or CloudFormation (YAML) code implementing all security controls. Include:

- IAM roles with inline policies
- KMS keys with key policies
- S3 buckets with encryption and policies
- CloudTrail configuration
- GuardDuty and Security Hub enablement
- VPC endpoints
- CloudWatch alarms

## Security Testing Recommendations

1. **IAM Policy Validation:** Use IAM Policy Simulator, test with various user contexts, verify least privilege
2. **Encryption Testing:** Attempt unencrypted uploads (should deny), verify KMS key policies, test TLS enforcement
3. **Audit Logging Validation:** Trigger test API calls, verify CloudTrail logs, test CloudWatch alarms
4. **Compliance Scanning:** Run AWS Config rules, use Security Hub, manual validation against checklists
5. **Penetration Testing:** Test unauthorized access, privilege escalation, data exfiltration
6. **Monitoring Validation:** Trigger security events, verify alarms fire, test GuardDuty, validate automated remediation

---

**Note:** This security design should be reviewed by security team before production deployment. All IAM policies should be tested with IAM Policy Simulator. Compliance validation should be performed with Security Hub and AWS Config.

---

## Design Completeness Checklist

Before finalizing, verify:

- [ ] All roles in Actors table have concrete policy definitions (JSON)
- [ ] All identity-based policies include trust policies
- [ ] All policies have descriptive Sid values and justifications
- [ ] All policies specify threat mitigation
- [ ] All data stores have encryption at rest configured
- [ ] All data in transit uses TLS 1.2+
- [ ] KMS key policies defined for all customer-managed keys
- [ ] CloudTrail configuration fully documented
- [ ] All CloudWatch alarms documented with thresholds
- [ ] All threats from threat model have corresponding controls
- [ ] Each threat has mitigation status and validation method
- [ ] All compliance requirements documented
- [ ] Compliance gaps identified with remediation steps
- [ ] Production readiness tier explicitly stated
- [ ] Security testing recommendations provided

**If any item incomplete, either complete it OR explicitly document why it's out of scope.**

---

## Quality Gate

**CRITICAL (must fix):**

- Wildcard actions (`*`) used without justification
- Wildcard resources (`*`) on sensitive services (S3, KMS, DynamoDB)
- No condition keys applied to cross-account access
- Missing resource-based policies where required (S3 bucket, KMS key)

**IMPORTANT (should fix):**

- Permissions broader than the documented access patterns require
- No permission boundary defined for roles that can create other roles
- Missing `aws:SecureTransport` condition on S3 policies

**SUGGESTION:**

- Could add SCPs for organizational guardrails
- Could define IAM Access Analyzer findings to monitor

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
