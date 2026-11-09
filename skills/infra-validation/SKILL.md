---
name: infra-validation
description: Validates AWS CDK and CloudFormation infrastructure code against AWS best practices, security standards, and Well-Architected principles. Use before deploying infrastructure changes. Detects security vulnerabilities, cost issues, and compliance gaps.
version: 1.1.0
tags: [skill, infrastructure, cdk, cloudformation, validation, security, aws]
---

# Infrastructure Validation

## Overview

Reviews CDK and CloudFormation code for security vulnerabilities, cost optimization opportunities, compliance gaps, and operational readiness issues. Covers IAM, encryption, logging, backup, and Well-Architected Framework alignment. Each finding names the resource, its impact, and a fix, and a rerun against a previous report tracks what was resolved.

## Usage

Use this skill when:

- Reviewing CDK or CloudFormation before deployment
- Checking infrastructure for security and compliance issues
- Validating Well-Architected Framework alignment

## Core Concepts

### Well-Architected Alignment

Reviews against AWS Well-Architected Framework pillars: security (encryption, IAM, network), reliability (multi-AZ, backups, deletion protection), performance (right-sizing, caching), cost optimization (tagging, reserved capacity), and operational excellence (monitoring, logging, alarms).

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

## Validation Framework

Validate infrastructure code across these 10 categories:

### CATEGORY 1: SECURITY CONFIGURATION

Check for:

- **Encryption at Rest**: RDS and EBS must set encryption explicitly. S3 (SSE-S3) and DynamoDB (AWS owned key) encrypt at rest by default, so check them only for data that requires SSE-KMS or a customer managed key
- **Encryption in Transit**: TLS/SSL required for all network communication (API Gateway, ALB, CloudFront)
- **IAM Permissions**: Least privilege principle, no wildcard permissions, no overly permissive policies
- **Network Security**: VPC configuration, security groups, NACLs, no public access to sensitive resources
- **Secrets Management**: No hardcoded credentials, use Secrets Manager or Parameter Store
- **Public Access**: No public S3 buckets, no public RDS instances, no open security groups
- **Authentication**: Proper authentication mechanisms (Cognito, IAM, API keys)
- **Audit Logging**: CloudTrail enabled, access logging for S3/ALB/API Gateway

**Validation Checks**:

1. For S3 buckets holding data that requires SSE-KMS or a customer managed key, verify `BucketEncryption` sets it. A missing `BucketEncryption` alone is not a finding: S3 applies SSE-S3 to every new object
2. For DynamoDB tables with the same requirement, verify a customer managed key is set. Without one, DynamoDB still encrypts with an AWS owned key
3. Validate RDS instances use encryption at rest
4. Verify API Gateway uses TLS 1.2 or higher
5. Check IAM policies for wildcard permissions (Action: "_", Resource: "_")
6. Identify overly permissive security groups (0.0.0.0/0 ingress on sensitive ports)
7. Verify no hardcoded credentials in Lambda environment variables or configuration
8. Check S3 buckets have public access blocked
9. Validate CloudTrail is enabled for audit logging
10. Verify VPC endpoints used for AWS service access where appropriate

### CATEGORY 2: COST OPTIMIZATION

Check for:

- **Over-Provisioned Resources**: Lambda memory/timeout, RDS instance sizes, DynamoDB capacity
- **Unused Resources**: Elastic IPs not attached, unused NAT Gateways, orphaned EBS volumes
- **Billing Mode Misalignment**: DynamoDB on-demand vs provisioned, EC2 on-demand vs reserved
- **Storage Class Optimization**: S3 lifecycle policies, Intelligent-Tiering, Glacier transitions
- **Data Transfer Costs**: Cross-region transfers, NAT Gateway usage, CloudFront optimization
- **Compute Optimization**: Lambda memory tuning, right-sized EC2 instances, auto-scaling configuration
- **Database Optimization**: RDS instance right-sizing, read replicas necessity, Aurora Serverless opportunities

**Validation Checks**:

1. Identify Lambda functions with excessive memory allocation (> 1GB without justification)
2. Check Lambda timeout settings (> 5 minutes may indicate architectural issues)
3. Verify DynamoDB billing mode aligns with traffic patterns (steady = provisioned, spiky = on-demand)
4. Identify S3 buckets without lifecycle policies for infrequent access data
5. Check for NAT Gateways in multiple AZs when single AZ sufficient for non-production
6. Verify RDS instance sizes match workload requirements
7. Identify opportunities for Aurora Serverless instead of provisioned instances
8. Check for unused Elastic IPs (not attached to instances)
9. Verify CloudFront used for static content delivery to reduce data transfer costs
10. Identify opportunities for S3 Intelligent-Tiering for unpredictable access patterns

### CATEGORY 3: OPERATIONAL EXCELLENCE

Check for:

- **Monitoring Configuration**: CloudWatch metrics, alarms, dashboards for all critical resources
- **Logging**: CloudWatch Logs enabled, log retention policies, structured logging
- **Backup & Recovery**: Automated backups, point-in-time recovery, cross-region backup
- **Disaster Recovery**: RTO/RPO defined, failover procedures, multi-region deployment
- **Auto-Scaling**: Auto-scaling configured for variable workloads, scaling policies defined
- **Health Checks**: Load balancer health checks, Route 53 health checks, Lambda dead letter queues
- **Deployment Automation**: CI/CD integration, blue-green deployment, canary deployment
- **Resource Tagging**: Consistent tagging for cost allocation, resource organization, automation

**Validation Checks**:

1. Verify CloudWatch alarms configured for Lambda errors, throttling, duration
2. Check DynamoDB alarms for throttling, capacity utilization
3. Validate RDS alarms for CPU, memory, storage, connections
4. Verify log retention policies set (not indefinite retention)
5. Check Lambda functions have dead letter queues configured
6. Verify DynamoDB point-in-time recovery enabled for production tables
7. Check RDS automated backups enabled with appropriate retention
8. Validate S3 versioning enabled for critical buckets
9. Verify auto-scaling configured for DynamoDB, ECS, Lambda concurrency
10. Check resource tagging includes Environment, Application, Owner, CostCenter

### CATEGORY 4: RELIABILITY & RESILIENCE

Check for:

- **Multi-AZ Deployment**: RDS multi-AZ, ELB across multiple AZs, DynamoDB global tables
- **Fault Tolerance**: Retry logic, circuit breakers, graceful degradation
- **Resource Limits**: Lambda concurrency limits, API Gateway throttling, DynamoDB capacity
- **Dependency Management**: Service dependencies documented, failure isolation, bulkheads
- **Data Durability**: S3 versioning, DynamoDB backups, RDS snapshots
- **Stateless Design**: Lambda functions stateless, session state externalized
- **Idempotency**: Operations designed to be idempotent, duplicate request handling

**Validation Checks**:

1. Verify RDS instances deployed in multi-AZ configuration for production
2. Check load balancers span multiple availability zones
3. Validate Lambda functions have reserved concurrency or account-level limits
4. Verify API Gateway has throttling configured (rate limit, burst limit)
5. Check DynamoDB tables have on-demand backup or continuous backups
6. Verify S3 buckets have versioning enabled for critical data
7. Check Lambda functions have retry configuration and dead letter queues
8. Validate Step Functions have error handling and retry logic
9. Verify SQS queues have dead letter queues configured
10. Check for single points of failure (single NAT Gateway, single database)

### CATEGORY 5: PERFORMANCE OPTIMIZATION

Check for:

- **Caching Strategy**: CloudFront caching, API Gateway caching, DynamoDB DAX, ElastiCache
- **Database Performance**: RDS read replicas, DynamoDB GSI design, query optimization
- **Lambda Performance**: Memory allocation, cold start optimization, provisioned concurrency
- **Network Performance**: VPC endpoints, PrivateLink, Direct Connect for high throughput
- **Content Delivery**: CloudFront for static assets, edge locations, compression
- **Compute Optimization**: Right-sized instances, Graviton processors, Lambda Powertools

**Validation Checks**:

1. Verify CloudFront used for static content delivery
2. Check API Gateway caching enabled for cacheable endpoints
3. Validate DynamoDB GSI design supports query patterns efficiently
4. Verify Lambda memory allocation appropriate for workload (not default 128MB)
5. Check for Lambda provisioned concurrency for latency-sensitive functions
6. Verify VPC endpoints used for AWS service access (S3, DynamoDB)
7. Check RDS read replicas configured for read-heavy workloads
8. Validate ElastiCache or DynamoDB DAX used for frequently accessed data
9. Verify CloudFront compression enabled for text-based content
10. Check Lambda functions use ARM64 (Graviton) for cost and performance benefits

### CATEGORY 6: CDK/CLOUDFORMATION BEST PRACTICES

Check for:

- **Code Organization**: Logical construct separation, reusable constructs, proper file structure
- **Naming Conventions**: Consistent resource naming, PascalCase for constructs, kebab-case for resources
- **Parameter Usage**: CloudFormation parameters for environment-specific values, SSM Parameter Store
- **Output Exports**: Proper use of CfnOutput for cross-stack references
- **Removal Policies**: Appropriate removal policies (RETAIN for production data, DESTROY for dev)
- **CDK Nag Integration**: Security scanning with CDK Nag, suppressions with justification
- **Testing**: Unit tests for constructs, integration tests for stacks
- **Documentation**: Inline comments, construct documentation, README files

**Validation Checks**:

1. Verify constructs follow single responsibility principle
2. Check naming conventions consistent across resources
3. Validate removal policies appropriate for environment (RETAIN for production databases)
4. Verify CDK Nag integrated for security scanning
5. Check suppressions have clear justifications
6. Validate CloudFormation parameters used for environment-specific configuration
7. Verify outputs exported for cross-stack references
8. Check for hardcoded values that should be parameters
9. Validate license headers present in all source files
10. Verify unit tests exist for custom constructs

### CATEGORY 7: COMPLIANCE & GOVERNANCE

Check for:

- **Data Residency**: Resources deployed in compliant regions, data sovereignty requirements
- **Compliance Standards**: SOC 2, HIPAA, PCI-DSS, GDPR requirements met
- **Audit Requirements**: CloudTrail logging, access logging, change tracking
- **Data Classification**: Sensitive data identified and protected appropriately
- **Retention Policies**: Data retention requirements met, automated deletion
- **Access Controls**: Role-based access control, least privilege, separation of duties
- **Encryption Standards**: Encryption algorithms meet compliance requirements (AES-256)

**Validation Checks**:

1. Verify resources deployed in compliant AWS regions
2. Check CloudTrail enabled for all regions with log file validation
3. Validate S3 bucket logging enabled for audit trails
4. Verify KMS customer managed keys used for sensitive data encryption
5. Check data retention policies configured (S3 lifecycle, CloudWatch Logs retention)
6. Validate IAM policies follow least privilege principle
7. Verify MFA required for privileged operations
8. Check sensitive data marked with appropriate tags
9. Validate backup retention meets compliance requirements
10. Verify encryption algorithms meet organizational standards

### CATEGORY 8: INFRASTRUCTURE ANTI-PATTERNS

Check for:

- **Monolithic Stacks**: Single stack with too many resources (> 200 resources)
- **Tight Coupling**: Resources tightly coupled across stacks, circular dependencies
- **Hardcoded Values**: Environment-specific values hardcoded instead of parameterized
- **Missing Abstractions**: Repeated resource patterns not extracted to constructs
- **Improper Resource Sizing**: Default sizes used without analysis
- **Missing Error Handling**: No error handling in Lambda functions, Step Functions
- **Synchronous Processing**: Synchronous operations that should be asynchronous
- **Missing Caching**: Repeated expensive operations without caching

**Validation Checks**:

1. Identify stacks with > 200 resources (should be split)
2. Detect circular dependencies between stacks
3. Find hardcoded environment-specific values (region, account ID, URLs)
4. Identify repeated resource patterns that should be constructs
5. Check Lambda functions using default memory (128MB) without justification
6. Verify error handling in Lambda functions (try/catch, error responses)
7. Identify synchronous Lambda invocations that should be asynchronous
8. Check for missing caching opportunities (API Gateway, CloudFront)
9. Detect missing retry logic for external service calls
10. Identify missing dead letter queues for asynchronous processing

### CATEGORY 9: RESOURCE-SPECIFIC VALIDATION

#### Lambda Functions

- **Runtime**: Using supported runtimes (not deprecated)
- **Memory**: Appropriate memory allocation (not default 128MB for all functions)
- **Timeout**: Reasonable timeout (not 15 minutes for simple operations)
- **Environment Variables**: No secrets in environment variables
- **VPC Configuration**: VPC configuration only when necessary (adds cold start latency)
- **Layers**: Shared dependencies in layers, not duplicated across functions
- **Tracing**: X-Ray tracing enabled for debugging
- **Reserved Concurrency**: Configured to prevent account-level throttling

#### DynamoDB Tables

- **Partition Key Design**: High cardinality partition keys, no hot partitions
- **GSI Configuration**: GSI capacity >= base table capacity
- **Billing Mode**: Appropriate billing mode for traffic pattern
- **Encryption**: Customer managed key set when the data requires one (default is an AWS owned key)
- **Backup**: Point-in-time recovery enabled for production
- **Streams**: Streams enabled only when needed (event-driven architecture)
- **TTL**: Time-to-live configured for temporary data

#### S3 Buckets

- **Public Access**: Block public access enabled
- **Versioning**: Versioning enabled for critical data
- **Encryption**: SSE-KMS or a customer managed key set when the data requires one (default is SSE-S3)
- **Lifecycle Policies**: Lifecycle policies for cost optimization
- **Access Logging**: Access logging enabled for audit
- **Object Lock**: Object lock for compliance requirements
- **Replication**: Cross-region replication for disaster recovery

#### API Gateway

- **Authentication**: Authentication configured (Cognito, IAM, Lambda authorizer)
- **Throttling**: Throttling configured (rate limit, burst limit)
- **Caching**: Caching enabled for cacheable endpoints
- **Logging**: Access logging and execution logging enabled
- **CORS**: CORS configured appropriately
- **Request Validation**: Request validation enabled
- **WAF Integration**: WAF attached for security

### CATEGORY 10: DEPLOYMENT & LIFECYCLE MANAGEMENT

Check for:

- **Stack Updates**: Safe update strategies (change sets, rollback configuration)
- **Resource Dependencies**: Proper dependency ordering, no circular dependencies
- **Deletion Protection**: Deletion protection for critical resources
- **Update Policies**: Update policies for auto-scaling groups, RDS instances
- **Drift Detection**: CloudFormation drift detection enabled
- **Stack Policies**: Stack policies to prevent accidental updates/deletes
- **Nested Stacks**: Appropriate use of nested stacks for modularity
- **Cross-Stack References**: Proper use of exports/imports for cross-stack dependencies

**Validation Checks**:

1. Verify deletion protection enabled for production databases
2. Check update policies configured for auto-scaling groups
3. Validate resource dependencies explicitly defined where needed
4. Verify no circular dependencies between stacks
5. Check stack policies configured to prevent accidental resource deletion
6. Validate nested stacks used appropriately (not too deep, not too flat)
7. Verify cross-stack references use exports/imports correctly
8. Check removal policies appropriate for environment
9. Validate update replacement policies for stateful resources
10. Verify rollback configuration defined for critical stacks

## Validation Process

Start only after [Step 0](#step-0-confirm-scope).

### Step 1: Initial Analysis and Resource Discovery

#### 1.1 Identify Infrastructure Type

Determine format:

- CDK TypeScript (`.ts` files with `aws-cdk-lib` imports)
- CDK Python (`.py` files with `aws_cdk` imports)
- CloudFormation JSON (`.json` with `"Resources"` key)
- CloudFormation YAML (`.yaml`/`.yml` with `Resources:` key)

#### 1.2 Create Complete Resource Inventory

**For CloudFormation Templates**:

Use systematic discovery to find ALL resources:

```bash
# List all resource types and counts
jq '.Resources | to_entries | group_by(.value.Type) | map({type: .[0].value.Type, count: length})' template.json

# Extract specific resource types for detailed analysis
jq '.Resources | to_entries[] | select(.value.Type == "AWS::IAM::Policy") | .key' template.json
jq '.Resources | to_entries[] | select(.value.Type == "AWS::Lambda::Function") | .key' template.json
jq '.Resources | to_entries[] | select(.value.Type == "AWS::DynamoDB::Table") | .key' template.json
jq '.Resources | to_entries[] | select(.value.Type == "AWS::S3::Bucket") | .key' template.json
```

**For CDK Source Code**:

Search for construct instantiations:

- `new lambda.Function(`
- `new dynamodb.Table(`
- `new s3.Bucket(`
- `new apigateway.RestApi(`

#### 1.3 Understand Architecture

- Identify architecture pattern (serverless, containerized, traditional)
- Map resource dependencies
- Identify critical path resources
- Note environment (dev, staging, production)

### Step 2: Security Validation

**CRITICAL: Use systematic approach - check EVERY resource type**

#### 2.1 IAM Policy Validation (MANDATORY)

**For CloudFormation**: Search for ALL `AWS::IAM::Policy` and `AWS::IAM::Role` resources
**For CDK**: Search for all `.addToRolePolicy()` calls

Check EVERY IAM policy statement for:

1. **Wildcard Resources** - Flag as CRITICAL
   - Search for: `"Resource": "*"` or `resources: ["*"]`
   - Search for: `"Resource": "arn:aws:*:*:*:*"` patterns
   - Exception: Only acceptable for service-level actions (e.g., `sts:GetCallerIdentity`)

2. **Wildcard Actions** - Flag as CRITICAL
   - Search for: `"Action": "*"` or `actions: ["*"]`
   - Search for: `"Action": "service:*"` on a data or credential service, for example `"s3:*"`
   - `service:*` on any other service is CRITICAL when it can change code or permissions (`lambda:*`, which includes `lambda:UpdateFunctionCode`, `iam:*`, `sts:*`), and IMPORTANT otherwise (for example `ec2:*` or `cloudwatch:*`)

3. **Overly Permissive Actions** - Flag as IMPORTANT
   - A list of named actions broader than the code needs, with no wildcard. For example, a read-only Lambda granted `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject`
   - Should specify exact actions needed

4. **Cross-Account Access** - Flag as IMPORTANT
   - Check for `Principal` with external account IDs
   - Verify trust relationships are intentional

**Validation Command Examples**:

```bash
# CloudFormation: Find all wildcard resources
jq '.Resources | to_entries[] | select(.value.Type == "AWS::IAM::Policy") | select(.value.Properties.PolicyDocument.Statement[].Resource == "*")' template.json

# CloudFormation: Find all wildcard actions
jq '.Resources | to_entries[] | select(.value.Type == "AWS::IAM::Policy") | select(.value.Properties.PolicyDocument.Statement[].Action == "*")' template.json
```

This skill covers wildcards and cross-account trust. Policy-level depth (condition keys, permission boundaries, KMS key policies, a policy score) belongs to `policy-validation`, which `k-architect` loads. If your agent doesn't have it, list those checks as out of scope in the report.

#### 2.2 Encryption Validation (MANDATORY)

Check EVERY data store resource:

**DynamoDB Tables** (`AWS::DynamoDB::Table`):

- [ ] If the data requires a customer managed key, `SSESpecification` sets `SSEEnabled: true`, `SSEType: KMS` and `KMSMasterKeyId`
- [ ] Without `SSESpecification`, the table is encrypted with an AWS owned key; not a finding by itself

**S3 Buckets** (`AWS::S3::Bucket`):

- [ ] If the data requires SSE-KMS, `BucketEncryption` sets `SSEAlgorithm: aws:kms` (or `aws:kms:dsse`) and `KMSMasterKeyID`
- [ ] Without `BucketEncryption`, S3 applies SSE-S3 (AES-256) to new objects; not a finding by itself

**RDS Instances** (`AWS::RDS::DBInstance`):

- [ ] `StorageEncrypted: true` present

**EBS Volumes** (`AWS::EC2::Volume`):

- [ ] `Encrypted: true` present

#### 2.3 Network Security Validation (MANDATORY)

**S3 Buckets**:

- [ ] `PublicAccessBlockConfiguration` with all four settings true
- [ ] No bucket policies allowing public access

**Security Groups** (`AWS::EC2::SecurityGroup`):

- [ ] No ingress rules with `CidrIp: 0.0.0.0/0` on sensitive ports (22, 3389, 3306, 5432)
- [ ] Egress rules follow least privilege

**API Gateway**:

- [ ] Authentication configured (Cognito, IAM, Lambda authorizer)
- [ ] Not using `AWS_IAM` with overly permissive policies

#### 2.4 TLS/SSL Validation (MANDATORY)

**CloudFront** (`AWS::CloudFront::Distribution`):

- [ ] `ViewerCertificate.MinimumProtocolVersion` set to `TLSv1.2_2021` or higher
- [ ] `ViewerProtocolPolicy: redirect-to-https` or `https-only`

**API Gateway**:

- [ ] `EndpointConfiguration.Types` not set to `EDGE` without TLS
- [ ] Custom domain uses ACM certificate

**Load Balancers** (`AWS::ElasticLoadBalancingV2::Listener`):

- [ ] HTTPS listeners use `SslPolicy` with TLS 1.2 minimum

#### 2.5 Secrets Management (MANDATORY)

**Lambda Functions** (`AWS::Lambda::Function`):

- [ ] No hardcoded credentials in `Environment.Variables`
- [ ] Sensitive values use Secrets Manager or Parameter Store references

**RDS/Database Resources**:

- [ ] Passwords use `!Ref` to Secrets Manager, not hardcoded

#### 2.6 Audit Logging (MANDATORY)

Check for access logging on:

- [ ] S3 buckets (`ServerAccessLogsConfiguration`)
- [ ] CloudFront distributions (`Logging`)
- [ ] API Gateway stages (`AccessLogSetting`)
- [ ] Load balancers (`AccessLogs`)
- [ ] CloudTrail enabled (separate stack check)

### Step 3: Cost Analysis

**CRITICAL: Analyze resource configurations systematically**

#### 3.1 Over-Provisioned Resources (Check EVERY instance)

**Lambda Functions** (`AWS::Lambda::Function`):

- [ ] Check `MemorySize` - flag if > 1024 MB without justification
- [ ] Check `Timeout` - flag if > 300 seconds (5 min) without justification
- [ ] Check `ReservedConcurrentExecutions` - verify allocation matches expected load

**RDS Instances** (`AWS::RDS::DBInstance`):

- [ ] Check `DBInstanceClass` - compare to workload requirements
- [ ] Check if Multi-AZ needed for non-production

**DynamoDB Tables** (`AWS::DynamoDB::Table`):

- [ ] Check `BillingMode` - PAY_PER_REQUEST vs PROVISIONED
- [ ] If PROVISIONED, check `ReadCapacityUnits` and `WriteCapacityUnits`
- [ ] Count Global Secondary Indexes - flag if > 5

#### 3.2 Unused Resources (Search for orphaned resources)

- [ ] Elastic IPs not attached to instances
- [ ] NAT Gateways in multiple AZs for non-production
- [ ] Unused EBS volumes
- [ ] Load balancers with no targets

#### 3.3 Storage Optimization

**S3 Buckets**:

- [ ] Check for `LifecycleConfiguration` - flag if missing for versioned buckets
- [ ] Check for Intelligent-Tiering or Glacier transitions

**DynamoDB**:

- [ ] Check GSI projection types - ALL vs KEYS_ONLY vs INCLUDE
- [ ] Flag redundant GSIs with same partition/sort keys

#### 3.4 Data Transfer Costs

- [ ] Check for cross-region data transfers
- [ ] Verify CloudFront used for static content
- [ ] Check for VPC endpoints for AWS services (S3, DynamoDB)

### Step 4: Operational Readiness

**CRITICAL: Check monitoring and error handling for ALL resources**

#### 4.1 CloudWatch Alarms (MANDATORY for production)

Check for alarms on:

**Lambda Functions** - MUST have alarms for:

- [ ] Errors (threshold: > 5 in 5 minutes)
- [ ] Throttles (threshold: > 1)
- [ ] Duration (threshold: approaching timeout)
- [ ] Concurrent executions (threshold: approaching reserved limit)

**DynamoDB Tables** - MUST have alarms for:

- [ ] User errors / throttling (threshold: > 1)
- [ ] System errors (threshold: > 1)
- [ ] Consumed capacity (if provisioned)
- [ ] **GSI throttling** (often missed - check EACH GSI)

**API Gateway** - MUST have alarms for:

- [ ] 5XX errors (threshold: > 10 in 5 minutes)
- [ ] 4XX errors (threshold: > 100 in 5 minutes)
- [ ] Latency p99 (threshold: > 1000ms)

**RDS/Aurora** - MUST have alarms for:

- [ ] CPU utilization (threshold: > 80%)
- [ ] Free storage space (threshold: < 10 GB)
- [ ] Database connections (threshold: > 80% of max)

#### 4.2 Dead Letter Queues (MANDATORY)

**Lambda Functions**:

- [ ] Check EVERY Lambda for `DeadLetterConfig`
- [ ] Verify DLQ is SQS queue with 14-day retention
- [ ] Exception: Synchronous invocations may not need DLQ

**SNS Topics**:

- [ ] Check for DLQ on subscriptions

**SQS Queues**:

- [ ] Check for `RedrivePolicy` with DLQ

#### 4.3 Logging Configuration (MANDATORY)

**CloudWatch Log Groups**:

- [ ] Check `RetentionInDays` set (not indefinite)
- [ ] Verify appropriate retention: 7 days (dev), 30 days (staging), 90+ days (prod)

**Lambda Functions**:

- [ ] Verify log group created with retention policy

**API Gateway**:

- [ ] Check `AccessLogSetting` configured
- [ ] Check `MethodSettings.LoggingLevel` set to INFO or ERROR

#### 4.4 Backup and Recovery (MANDATORY for stateful resources)

**DynamoDB Tables**:

- [ ] `PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled: true`
- [ ] Or backup plan configured

**RDS Instances**:

- [ ] `BackupRetentionPeriod` > 0 (typically 7-30 days)
- [ ] `PreferredBackupWindow` configured

**S3 Buckets** (for critical data):

- [ ] `VersioningConfiguration.Status: Enabled`
- [ ] Cross-region replication for DR

#### 4.5 Auto-Scaling (Check for variable workloads)

- [ ] DynamoDB auto-scaling configured if using PROVISIONED mode
- [ ] Lambda reserved concurrency set to prevent account throttling
- [ ] ECS/Fargate auto-scaling policies defined

#### 4.6 Health Checks

- [ ] Load balancer health checks configured
- [ ] Route 53 health checks for critical endpoints
- [ ] Lambda function health check endpoints

#### 4.7 X-Ray Tracing (Recommended for production)

**Lambda Functions**:

- [ ] Check `TracingConfig.Mode: Active`

**API Gateway**:

- [ ] Check `TracingEnabled: true`

### Step 5: Best Practices Check

**CRITICAL: Systematic resource-by-resource validation**

#### 5.1 Resource-Specific Validation Checklist

**For EACH Lambda Function** (`AWS::Lambda::Function`):

- [ ] Runtime is supported (not deprecated)
- [ ] `MemorySize` not default 128 MB for all functions
- [ ] `Timeout` reasonable for operation (not 15 min for simple tasks)
- [ ] `ReservedConcurrentExecutions` configured to prevent throttling
- [ ] `DeadLetterConfig` present
- [ ] `TracingConfig.Mode: Active` for production
- [ ] No VPC configuration unless necessary (adds cold start latency)
- [ ] Environment variables don't contain secrets

**For EACH DynamoDB Table** (`AWS::DynamoDB::Table`):

- [ ] Partition key has high cardinality (not status, type, etc.)
- [ ] `SSESpecification.SSEEnabled: true`
- [ ] `PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled: true` for production
- [ ] `BillingMode` appropriate (PAY_PER_REQUEST for variable, PROVISIONED for steady)
- [ ] GSI count reasonable (< 5 typically)
- [ ] GSI projections optimized (not all ALL projection)
- [ ] `TimeToLiveSpecification` configured if temporary data
- [ ] `StreamSpecification` only if needed (event-driven architecture)

**For EACH S3 Bucket** (`AWS::S3::Bucket`):

- [ ] `PublicAccessBlockConfiguration` with all four settings true
- [ ] `BucketEncryption` sets SSE-KMS if the data requires it
- [ ] `VersioningConfiguration.Status: Enabled` for critical data
- [ ] `LifecycleConfiguration` for cost optimization
- [ ] `ServerAccessLogsConfiguration` for audit trail
- [ ] `ObjectLockConfiguration` if compliance required
- [ ] `ReplicationConfiguration` for DR if critical
- [ ] `CorsConfiguration` only if needed and properly scoped

**For EACH API Gateway** (`AWS::ApiGateway::RestApi`):

- [ ] Authentication configured (not open to public)
- [ ] `Policy` doesn't allow `Principal: "*"` without conditions
- [ ] Throttling configured (`ThrottleSettings`)
- [ ] `AccessLogSetting` configured
- [ ] `TracingEnabled: true` for production
- [ ] CORS properly configured (not `AllowOrigin: "*"` in production)
- [ ] Request validation enabled
- [ ] Caching enabled for cacheable endpoints

**For EACH CloudFront Distribution** (`AWS::CloudFront::Distribution`):

- [ ] `ViewerCertificate.MinimumProtocolVersion` >= TLSv1.2_2021
- [ ] `DefaultCacheBehavior.ViewerProtocolPolicy` is `redirect-to-https` or `https-only`
- [ ] `Logging` configured
- [ ] `WebACLId` attached (WAF protection)
- [ ] `DefaultCacheBehavior.Compress: true` for text content
- [ ] Origin access identity used for S3 origins (not public bucket)

**For EACH RDS Instance** (`AWS::RDS::DBInstance`):

- [ ] `StorageEncrypted: true`
- [ ] `MultiAZ: true` for production
- [ ] `BackupRetentionPeriod` > 0
- [ ] `PubliclyAccessible: false`
- [ ] `VPCSecurityGroups` properly configured
- [ ] `EnableCloudwatchLogsExports` for audit logs
- [ ] `DeletionProtection: true` for production

**For EACH Cognito User Pool** (`AWS::Cognito::UserPool`):

- [ ] `MfaConfiguration` set (OPTIONAL or ON)
- [ ] `PasswordPolicy` enforces strong passwords
- [ ] `AccountRecoverySetting` configured
- [ ] `UserPoolAddOns.AdvancedSecurityMode` set to ENFORCED for production
- [ ] `EmailConfiguration` uses SES (not default) for production

#### 5.2 CloudFormation/CDK Patterns

- [ ] `DeletionPolicy: Retain` for production databases
- [ ] `UpdateReplacePolicy: Retain` for stateful resources
- [ ] Outputs defined for cross-stack references
- [ ] Parameters used for environment-specific values
- [ ] Conditions used for environment-specific resources
- [ ] Stack policies prevent accidental deletion of critical resources

#### 5.3 Tagging Standards

Check ALL resources have required tags:

- [ ] `Environment` (dev/staging/prod)
- [ ] `Application` or `Service`
- [ ] `Owner` or `Team`
- [ ] `CostCenter` (if required)

#### 5.4 Naming Conventions

- [ ] Resource names include environment identifier
- [ ] Consistent naming pattern across resources
- [ ] No hardcoded account IDs or regions (use pseudo-parameters)

### Step 6: Systematic Resource Inventory

**BEFORE generating report, create complete resource inventory**

#### 6.1 Count and List All Resources by Type

Create inventory showing:

```
Resource Type                    | Count | Critical Checks Completed
--------------------------------|-------|-------------------------
AWS::Lambda::Function           |   10  | ✓ IAM, DLQ, Tracing
AWS::DynamoDB::Table            |    1  | ✓ Encryption, PITR, GSIs
AWS::S3::Bucket                 |    2  | ✓ Encryption, Public Access
AWS::IAM::Policy                |   15  | ✓ Wildcard Check
AWS::CloudFront::Distribution   |    1  | ✓ TLS Version
AWS::ApiGateway::RestApi        |    1  | ✓ Auth, Logging
AWS::Cognito::UserPool          |    1  | ✓ MFA, Password Policy
AWS::CloudWatch::Alarm          |   10  | ✓ Coverage Check
```

#### 6.2 Verification Checklist

Before finalizing report, verify you checked:

**Security**:

- [ ] ALL IAM policies for wildcard resources (`"Resource": "*"`)
- [ ] ALL IAM policies for wildcard actions (`"Action": "*"` or `"service:*"`)
- [ ] ALL RDS and EBS resources for encryption at rest, and S3 and DynamoDB for SSE-KMS where the data requires it
- [ ] ALL S3 buckets for public access block
- [ ] ALL network resources for TLS/SSL configuration
- [ ] ALL resources for hardcoded secrets

**Operational**:

- [ ] ALL Lambda functions for DLQ configuration
- [ ] ALL Lambda functions for CloudWatch alarms
- [ ] ALL DynamoDB tables for PITR
- [ ] ALL DynamoDB GSIs for throttling alarms
- [ ] ALL API Gateways for access logging
- [ ] ALL S3 buckets for access logging
- [ ] ALL CloudFront distributions for logging

**Cost**:

- [ ] ALL Lambda functions for memory/timeout optimization
- [ ] ALL DynamoDB tables for GSI optimization
- [ ] ALL S3 buckets for lifecycle policies
- [ ] ALL resources for appropriate billing modes

**Reliability**:

- [ ] ALL stateful resources for backup configuration
- [ ] ALL Lambda functions for retry configuration
- [ ] ALL critical resources for multi-AZ deployment

### Step 7: Generate Report

Provide structured feedback with:

- **Resource Inventory Summary** (from Step 6.1)
- **Verification Checklist Status** (from Step 6.2)
- CRITICAL findings requiring immediate attention
- IMPORTANT findings for near-term resolution
- SUGGESTION findings: optimizations and minor improvements
- Iteration progress tracking
- Limits of the review: name the inputs you did not inspect (Lambda handler code, the synthesized template in `cdk.out/`, the app entrypoint, CI) and mark findings that depend on them as unverified

Report each root cause once, under its highest tier, and put every related setting in that finding's fix. A public bucket finding, for example, carries the block-public-access, TLS enforcement and policy changes together instead of repeating them lower down.

If you did not systematically check ALL resources of a type, explicitly state this limitation in the report.

## Output Format

Use the same CRITICAL, IMPORTANT and SUGGESTION scale as the Quality Gate:

- **CRITICAL** blocks deployment. Use it only for exposure, data loss or credential risk: the Quality Gate CRITICAL list, which covers public access, missing encryption the data requires, open ingress, missing deletion protection, hardcoded secrets and wildcard IAM.
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

## Example Review Output

````markdown
## Infrastructure Code Review: TaskFlow Serverless Stack

### Overall Assessment

**Status**: NEEDS REVISION
**Confidence Level**: HIGH
**CRITICAL**: 2
**IMPORTANT**: 3
**SUGGESTION**: 5

### CRITICAL

**Security** - S3 Bucket (DocumentsBucket)
Issue: The bucket holds customer documents that the data classification says need a customer managed KMS key, but it relies on default SSE-S3
Impact: SSE-S3 encrypts the objects, but with keys you can't control, audit per use, or revoke, so the bucket fails the classification requirement
Fix: Set SSE-KMS with a customer managed key
Example:

```typescript
// Before
const bucket = new s3.Bucket(this, 'DocumentsBucket', {
  bucketName: 'taskflow-documents',
  versioned: true,
});

// After
const bucket = new s3.Bucket(this, 'DocumentsBucket', {
  bucketName: 'taskflow-documents',
  versioned: true,
  encryption: s3.BucketEncryption.KMS,
  encryptionKey: new kms.Key(this, 'BucketKey', { enableKeyRotation: true }),
});
```

**Security** - Lambda Function (TaskProcessorFunction)
Issue: Lambda function has wildcard IAM permissions (Action: "_", Resource: "_")
Impact: Violates least privilege principle, excessive permissions increase security risk
Fix: Grant specific permissions only for required operations
Example:

```typescript
// Before
taskFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['*'],
    resources: ['*'],
  }),
);

// After
taskFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
    resources: [taskTable.tableArn, `${taskTable.tableArn}/index/*`],
  }),
);
```

### IMPORTANT

**Operational Excellence** - Lambda Function (TaskProcessorFunction)
Issue: No CloudWatch alarms configured for Lambda errors or throttling
Impact: Production issues may go undetected, delayed incident response
Recommendation: Configure alarms for errors, throttling, and duration
Example:

```typescript
// Add error alarm
const errorAlarm = new cloudwatch.Alarm(this, 'TaskProcessorErrors', {
  metric: taskFunction.metricErrors(),
  threshold: 5,
  evaluationPeriods: 2,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  alarmDescription: 'Alert when Lambda function has errors',
});

// Add throttling alarm
const throttleAlarm = new cloudwatch.Alarm(this, 'TaskProcessorThrottles', {
  metric: taskFunction.metricThrottles(),
  threshold: 1,
  evaluationPeriods: 1,
  alarmDescription: 'Alert when Lambda function is throttled',
});

// Add duration alarm
const durationAlarm = new cloudwatch.Alarm(this, 'TaskProcessorDuration', {
  metric: taskFunction.metricDuration(),
  threshold: 5000, // 5 seconds
  evaluationPeriods: 3,
  alarmDescription: 'Alert when Lambda duration exceeds threshold',
});
```

**Operational Excellence** - DynamoDB Table (TasksTable)
Issue: Point-in-time recovery not enabled for production table
Impact: Cannot recover from accidental data deletion or corruption
Recommendation: Enable PITR for production tables
Example:

```typescript
const table = new dynamodb.Table(this, 'TasksTable', {
  partitionKey: { name: 'taskId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  pointInTimeRecovery: true, // Enable PITR
});
```

**Operational Excellence** - Lambda Function (TaskProcessorFunction)
Issue: No dead letter queue configured for failed invocations
Impact: Failed invocations lost, no visibility into failures
Recommendation: Configure DLQ for error handling and debugging
Example:

```typescript
const dlq = new sqs.Queue(this, 'TaskProcessorDLQ', {
  queueName: 'task-processor-dlq',
  retentionPeriod: cdk.Duration.days(14),
});

const taskFunction = new lambda.Function(this, 'TaskProcessorFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda'),
  deadLetterQueue: dlq,
  deadLetterQueueEnabled: true,
});
```

### SUGGESTION

**Cost Optimization** - Lambda Function (TaskProcessorFunction)
Observation: Lambda function using default memory (128MB) without analysis
Benefit: Right-sizing memory can improve performance and reduce cost
Alternative: Analyze actual memory usage and adjust accordingly
Example:

```typescript
// Analyze CloudWatch metrics for actual memory usage
// Then adjust memory allocation
const taskFunction = new lambda.Function(this, 'TaskProcessorFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda'),
  memorySize: 512, // Adjust based on actual usage
  timeout: cdk.Duration.seconds(30), // Also review timeout
});
```

**Performance** - Lambda Function (TaskProcessorFunction)
Observation: Lambda function not using ARM64 architecture (Graviton)
Benefit: AWS cites up to 34% better price performance on arm64 (Graviton2) than on x86, with 20% lower duration charges
Alternative: Switch to ARM64 architecture for cost and performance benefits
Example:

```typescript
const taskFunction = new lambda.Function(this, 'TaskProcessorFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda'),
  architecture: lambda.Architecture.ARM_64, // Use Graviton
});
```

**Cost Optimization** - S3 Bucket (DocumentsBucket)
Observation: No lifecycle policy configured for infrequent access data
Benefit: Potential 50-80% storage cost savings for infrequently accessed data
Alternative: Configure lifecycle policy to transition to Intelligent-Tiering or Glacier
Example:

```typescript
const bucket = new s3.Bucket(this, 'DocumentsBucket', {
  bucketName: 'taskflow-documents',
  versioned: true,
  lifecycleRules: [
    {
      id: 'TransitionToIntelligentTiering',
      enabled: true,
      transitions: [
        {
          storageClass: s3.StorageClass.INTELLIGENT_TIERING,
          transitionAfter: cdk.Duration.days(30),
        },
      ],
    },
    {
      id: 'TransitionToGlacier',
      enabled: true,
      transitions: [
        {
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: cdk.Duration.days(90),
        },
      ],
    },
  ],
});
```

**Code Quality** - Stack Organization
Observation: Repeated resource patterns are not extracted into reusable constructs
Benefit: Improved code maintainability and reusability

**Documentation** - Missing inline comments
Observation: Complex resource configurations have no inline comments
Benefit: Improved code readability for team members

### Positive Findings

**Security**
Good practice: API Gateway has authentication configured with Cognito User Pool

**Reliability**
Good practice: DynamoDB table using on-demand billing mode for unpredictable traffic

**Code Organization**
Good practice: Consistent naming conventions across resources

**Operational Excellence**
Good practice: CloudWatch Logs retention configured (not indefinite)

## Validation Summary

**Overall Recommendation**: Address 2 CRITICAL security issues before deployment. IMPORTANT operational issues should be resolved for production readiness.

**Key Strengths**:

- Good authentication configuration
- Appropriate billing mode for DynamoDB
- Consistent naming conventions

**Critical Gaps**:

- Document bucket lacks the customer managed key its data classification requires
- Overly permissive IAM policies
- Missing operational monitoring

**Estimated Cost Savings**: $150-200/month from lifecycle policies and Lambda optimization

**Timeline Impact**: 2-3 days to address CRITICAL and IMPORTANT issues
````

## Validation Checklist

Before approving infrastructure code:

- [ ] RDS and EBS have encryption at rest enabled; S3 and DynamoDB use SSE-KMS where the data requires it
- [ ] All network communication uses TLS/SSL
- [ ] IAM policies follow least privilege principle
- [ ] No hardcoded credentials or secrets
- [ ] S3 buckets have public access blocked
- [ ] CloudWatch alarms configured for critical resources
- [ ] Logging enabled for audit trails
- [ ] Backup and recovery configured for stateful resources
- [ ] Auto-scaling configured for variable workloads
- [ ] Resource tagging includes required tags
- [ ] Removal policies appropriate for environment
- [ ] CDK Nag integrated for security scanning
- [ ] Unit tests exist for custom constructs
- [ ] Documentation includes deployment instructions
- [ ] Cost optimization opportunities identified

## Interaction Guidelines

1. **Be Specific**: Point to exact resources and provide concrete examples
2. **Explain Impact**: Help understand why issues matter (security, cost, reliability)
3. **Provide Solutions**: Don't just identify problems, suggest fixes with code examples
4. **Prioritize Issues**: Distinguish critical from nice-to-have
5. **Acknowledge Good Practices**: Recognize what's done well
6. **Consider Context**: Understand project constraints and requirements (dev vs production)

## Success Criteria

Infrastructure code passes review when:

- No CRITICAL security issues remain
- IMPORTANT operational issues addressed or documented as accepted
- Compliance requirements met
- Cost optimization opportunities identified
- Follows AWS best practices consistently
- Ready for production deployment

Provide thorough, actionable feedback that improves infrastructure quality and ensures production readiness.

---

## Quality Gate

**CRITICAL (must fix):**

- S3 buckets with public access enabled
- RDS or EBS without encryption at rest, or S3 and DynamoDB data that requires SSE-KMS left on the default keys
- Security groups with `0.0.0.0/0` ingress on non-HTTP ports
- No deletion protection, or a destroy-on-delete removal policy, on stateful resources (RDS, DynamoDB) in production
- Hardcoded passwords, keys or tokens in code or environment variables
- IAM statements with wildcard actions (`*`, or `service:*` on a data or credential service such as `s3:*`, or on a service that can change code or permissions such as `lambda:*`, `iam:*` or `sts:*`) or wildcard resources

**IMPORTANT (should fix):**

- CloudWatch alarms not defined for key metrics
- No backup configuration for stateful resources
- IAM `service:*` on a service that holds no data and can't change code or permissions, such as `ec2:*`
- Lambda functions without reserved concurrency limits, DLQ or tracing
- Low-cardinality partition keys that create hot partitions

**SUGGESTION:**

- Over-provisioned memory, timeout or capacity with no stated reason
- Could enable VPC Flow Logs for network visibility
- Could add cost allocation tags to all resources

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" unless `scope_confirmed` is true. In that case, report all the findings and leave fixing to the caller without asking.
