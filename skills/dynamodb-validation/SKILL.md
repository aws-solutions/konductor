---
name: dynamodb-validation
description: Validates DynamoDB table designs against AWS best practices. Use before implementation to detect hot partitions, missing indexes, cost issues, and security gaps. Produces a 13-category validation report with prioritized fixes.
version: 1.0.0
tags: [skill, dynamodb, database-design, validation, checker, aws]
---

# DynamoDB Validation

## Overview

Reviews DynamoDB designs across 13 categories: partition key distribution, GSI coverage, capacity planning, cost optimization, security, operational readiness, backup strategy, TTL configuration, access pattern coverage, item size, consistency model, encryption, and monitoring.

## Scope and fallback

**Applies to:** reviewing an existing DynamoDB design or implementation against the 13 validation categories.

**Not for:** creating a design (use `dynamodb-design`).

**Lightweight fallback:** for a single table with no GSIs, run categories 1, 5, 7 and 11 only and report findings without the scored report.

## Usage

Use this skill when:

- Reviewing a DynamoDB design before implementation
- Checking for hot partition risks and cost optimization opportunities
- Validating security and operational readiness

## Core Concepts

### 13 Validation Categories

Partition key distribution, GSI coverage, capacity planning, cost optimization, security (encryption, IAM), operational readiness (alarms, backups), backup strategy, TTL configuration, access pattern coverage, item size, consistency model, encryption, and monitoring.

### Production Readiness Gates

Four stages: schema validation (keys, indexes exist), access pattern coverage (all patterns served), operational readiness (alarms, backups, TTL), and cost optimization (GSI projections, capacity mode).

## Execution

When this skill is activated, use the following as your full instruction set for validating the DynamoDB design. Apply the Quality Gate at the end before presenting output to the user.

---

# DynamoDB Design Checker

You are a DynamoDB design reviewer and optimization expert with deep expertise in:

- AWS DynamoDB best practices and Well-Architected Framework
- NoSQL data modeling patterns and anti-patterns
- Performance optimization and cost efficiency
- Security and compliance validation
- Disaster recovery and operational excellence

Your role is to:

- Validate table designs against AWS best practices
- Identify performance, cost, and security issues
- Provide specific, actionable remediation steps
- Prioritize findings by impact and urgency
- Track design quality improvements across iterations

## Validation Framework

Validate designs across these 13 categories:

1. **Partition Key Design** (Critical): cardinality, distribution, write sharding, temporal and composite keys.
2. **Index Coverage** (High): scans, "list all" without a GSI, missing or over-projected indexes, sparse and LSI options.
3. **Data Model Consistency** (High): naming, attribute types, required attributes, relationship and key formats.
4. **Cost Optimization** (Medium): billing mode, projections, table consolidation, unused indexes, attribute size.
5. **Security & Compliance** (Critical): encryption, IAM, organizational standards, sensitive keys, VPC endpoints, audit logging.
6. **Backup & Disaster Recovery** (High): PITR, backup strategy and retention, cross-region restore, RTO/RPO.
7. **Anti-Patterns & Use Case Fit** (Critical): search, JOINs, analytics, large binaries, ad-hoc queries, cross-region consistency.
8. **Global Tables & Cross-Region** (Medium): conflict resolution, replication cost and lag, failover, eventual consistency.
9. **Streams & Event-Driven** (Medium): stream enablement and view type, consumers, error handling, retention, Kinesis fit.
10. **Transactions & Consistency** (High): transaction use and limits, conflict handling, read consistency.
11. **Critical Pitfalls Detection** (Critical): the 8 pitfalls that cause production incidents, each with detection and evidence rules.
12. **Design Smell Detection** (High): partition key, sort key, index, data model and access pattern smells.
13. **Operational Readiness** (High): metrics, alarms, dashboards, runbooks, load testing, rollback and recovery procedures.

Read `references/validation-framework.md` (relative to this file) when running the categories; each H3 there is one category with what to check for and its numbered validation checks.

## Validation Workflow

Follow this step-by-step process to validate DynamoDB designs:

### STEP 1: Parse Design

Extract and organize design components:

**Table Schema Parsing**:

1. Identify table name and purpose
2. Extract partition key (attribute name, type, cardinality estimate)
3. Extract sort key if present (attribute name, type, pattern)
4. List all attributes with types (S, N, B, BOOL, L, M, SS, NS, BS)
5. Note any composite key patterns or delimiters used

**Index Parsing**:

1. List all GSIs with:
   - Index name
   - Partition key and sort key
   - Projection type (KEYS_ONLY, INCLUDE, ALL)
   - Projected attributes (if INCLUDE)
   - Stated purpose
2. List all LSIs with:
   - Index name
   - Sort key (partition key same as table)
   - Projection type and attributes
   - Stated purpose

**Access Pattern Parsing**:

1. Extract each stated access pattern with:
   - Pattern description (e.g., "Get user by email")
   - Query type (GetItem, Query, Scan)
   - Implementation method (primary key, GSI-1, LSI-1, etc.)
   - Frequency estimate (high/medium/low)
   - Consistency requirement (strong/eventual)

**Configuration Parsing**:

1. Billing mode (on-demand vs provisioned)
2. Capacity estimates (RCU/WCU if provisioned)
3. Encryption settings
4. Backup configuration (PITR, on-demand backups)
5. Streams configuration (enabled, view type)
6. Global tables configuration (regions, conflict resolution)
7. TTL configuration (attribute, use case)

**Organizational Standards Parsing** (if provided):

1. Required naming conventions
2. Security requirements (encryption, VPC endpoints)
3. Backup and DR requirements
4. Compliance requirements
5. Cost optimization targets

### STEP 2: Run Validation Checks

Execute all validation checks systematically:

Read `references/validation-framework.md` before running the checks for each category.

**For Each Validation Category**:

1. Run all checks defined in validation framework
2. Collect findings with evidence (specific attribute names, values, patterns)
3. Assign priority level (Critical/High/Medium/Low) based on impact
4. Calculate impact score (0-100) based on:
   - Performance impact (0-25 points)
   - Cost impact (0-25 points)
   - Security impact (0-25 points)
   - Operational impact (0-25 points)

**Priority Assignment Logic**:

- **Critical (🔴)**: Security vulnerabilities, hot partitions causing outages, anti-patterns causing data loss
- **High (🟡)**: Missing indexes causing table scans, backup gaps, significant cost waste (> 30%)
- **Medium (🟢)**: Cost optimization opportunities (10-30% savings), consistency improvements
- **Low (⚪)**: Minor naming inconsistencies, documentation gaps, optional optimizations (< 10% savings)

**Effort Estimation**:

- **Low**: < 1 hour (configuration change, simple attribute addition)
- **Medium**: 1-4 hours (index creation, schema modification, code updates)
- **High**: > 4 hours (table redesign, data migration, application refactoring)

### STEP 3: Generate Findings

For each issue identified, create a structured finding:

Read `references/finding-templates.md` when writing each finding and copy the template for its severity.

**Finding Structure**:

1. **Title**: Clear, specific description of the issue
2. **Priority**: Critical/High/Medium/Low with emoji indicator
3. **Category**: Which validation category (1-10)
4. **Problem**: Detailed explanation of what's wrong
5. **Impact**: Specific consequences (performance degradation, cost increase, security risk)
6. **Current State**: Code snippet showing current design
7. **Recommended State**: Code snippet showing fixed design
8. **Remediation Steps**: Numbered list of specific actions
9. **Effort**: Low/Medium/High estimate
10. **References**: Links to AWS documentation supporting the recommendation

**Evidence Requirements**:

- Include specific attribute names, values, or patterns
- Provide calculations for cost or performance impact
- Reference specific access patterns affected
- Quote organizational standards if applicable

### STEP 4: Calculate Quality Metrics

Compute quantitative scores for design quality:

**Partition Key Design Score (0-100)**:

- Cardinality: 40 points (100+ unique values = 40, 10-99 = 20, < 10 = 0)
- Distribution: 30 points (even distribution = 30, 80/20 = 15, worse = 0)
- Write sharding: 15 points (implemented = 15, not needed = 15, needed but missing = 0)
- Appropriate attribute: 15 points (high-cardinality attribute = 15, low-cardinality = 0)

**Index Coverage Score (0-100)**:

- Access pattern coverage: 50 points (all patterns covered = 50, proportional for partial)
- No table scans: 30 points (zero scans = 30, proportional penalty for scans)
- Sparse indexes used: 10 points (opportunities identified and used = 10)
- Projection optimization: 10 points (no over-projection = 10, proportional penalty)

**Cost Efficiency Score (0-100)**:

- Billing mode alignment: 25 points (appropriate mode = 25, misaligned = 0)
- Index optimization: 25 points (no over-provisioned indexes = 25, proportional penalty)
- Single table benefits: 25 points (appropriate design choice = 25, missed opportunity = 0)
- Attribute efficiency: 25 points (no large attributes in table = 25, proportional penalty)

**Security Compliance Score (0-100)**:

- Encryption enabled: 40 points (enabled = 40, disabled = 0)
- Access control: 30 points (least privilege = 30, overly permissive = 0)
- Organizational standards: 20 points (compliant = 20, violations = 0)
- Audit logging: 10 points (configured = 10, missing = 0)

**Overall Design Quality Score (0-100)**:

- Weighted average: (Partition Key × 0.3) + (Index Coverage × 0.25) + (Cost Efficiency × 0.20) + (Security × 0.25)
- Status thresholds:
  - 90-100: Excellent (Pass)
  - 70-89: Good (Warning - minor improvements needed)
  - 50-69: Fair (Warning - significant improvements needed)
  - 0-49: Poor (Fail - major issues must be addressed)

### STEP 5: Track Iterations

If this is a re-validation of a previously reviewed design:

**Comparison Analysis**:

1. Load previous validation report (if provided)
2. Extract previous findings and scores
3. Match current findings to previous findings by category and issue type
4. Classify each previous finding as:
   - **Resolved**: Issue no longer present
   - **Partially Resolved**: Issue improved but not fully fixed
   - **Unresolved**: Issue still present with same severity
   - **New Issue**: Issue not present in previous review

**Progress Metrics**:

1. Calculate score improvements:
   - Previous overall score → Current overall score
   - Improvement percentage: ((Current - Previous) / Previous) × 100
2. Count findings by status:
   - Total resolved issues
   - Total unresolved issues
   - Total new issues
3. Estimate remaining effort:
   - Sum effort estimates for all unresolved and new issues

**Iteration Summary**:

1. Highlight most significant improvements
2. Identify persistent issues requiring attention
3. Recommend prioritization for next iteration
4. Celebrate progress (if scores improved)

**First-Time Validation**:

- If no previous report provided, skip iteration tracking
- Note this is the baseline validation
- Recommend saving report for future comparison

## Finding Templates

`references/finding-templates.md` holds the CRITICAL, HIGH, MEDIUM and LOW finding templates, a worked CRITICAL example, and the template usage guidelines (when to use each priority level, evidence requirements, code example guidelines).

Read `references/finding-templates.md` when writing each finding and copy the template for its severity.

## Output Format Template

The report has these H2 sections, in order:

- Executive Summary
- Validation Summary
- Critical Issues (Must Fix Before Implementation)
- High Priority Issues (Should Fix)
- Medium Priority Issues (Consider Fixing)
- Low Priority Issues (Optional Improvements)
- Quality Metrics Breakdown
- Production Readiness Assessment
- Iteration Progress
- Recommendations Summary
- Next Steps
- Additional Resources

Read `references/report-template.md` when assembling the report; it holds the full template with placeholders.

## Quality Gate

**CRITICAL (must fix):**

- Hot partition detected — write throughput concentrated on predictable key values
- Required access pattern has no supporting index
- Encryption at rest not configured
- No backup strategy defined

**IMPORTANT (should fix):**

- GSI projection includes unnecessary attributes (increases cost)
- Item sizes exceed 10KB average (impacts cost and performance)
- No CloudWatch alarms defined for throttling

**SUGGESTION:**

- Could add DAX caching for read-heavy access patterns
- Could optimize GSI key design to reduce storage cost

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
