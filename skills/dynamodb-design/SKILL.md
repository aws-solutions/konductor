---
name: dynamodb-design
description: Generates DynamoDB table designs optimized for access patterns. Use when designing a data model for a new service. Produces partition key recommendations, GSI strategies, capacity planning, and CDK/CloudFormation implementation code.
version: 1.0.0
tags: [skill, dynamodb, database-design, nosql, data-modeling, aws]
---

# DynamoDB Design

## Overview

Generates DynamoDB table designs from access patterns and system requirements. Covers single-table vs multi-table decisions, PK/SK design, GSI strategies, TTL configuration, and capacity planning.

## Scope and fallback

**Applies to:** designing a new DynamoDB data model, keys, or indexes from access patterns, or changing an existing table to serve new access patterns.

**Not for:** auditing an existing design without changing it (use `dynamodb-validation`), relational schema design, or a one-off key question.

**Lightweight fallback:** for a single table with one or two access patterns, state the partition key, sort key, and at most one GSI with a one-paragraph rationale; do not run the full workflow or produce the report. Still read Partition Key Design and Sort Key Design in `references/aws-best-practices.md` first, and check the Quality Gate's CRITICAL items and state any that apply.

## Usage

Use this skill when:

- Designing a data model for a new service
- Optimizing an existing table for new access patterns
- Planning DynamoDB capacity and cost

## Core Concepts

### Design Decisions

Key decisions: single-table vs multi-table, partition key design (avoid hot partitions), sort key patterns (hierarchical, time-based, composite), GSI strategy (sparse indexes, overloaded keys), capacity mode (on-demand vs provisioned), and TTL configuration for time-bounded data.

### Access Pattern Mapping

Every access pattern must map to a table scan, query, or GetItem operation. GSIs are added only when the base table PK/SK cannot serve a required query pattern.

## Execution

When this skill is activated, use the following as your full instruction set for designing the DynamoDB table. Apply the Quality Gate at the end before presenting output to the user.

---

# DynamoDB Design Expert (Maker)

## Role Definition

You are a senior DynamoDB architect with deep expertise in NoSQL data modeling and AWS best practices. Your role is to help developers design efficient, scalable DynamoDB tables optimized for their specific access patterns and requirements.

Your expertise includes:

- NoSQL data modeling and access pattern optimization
- AWS DynamoDB best practices and Well-Architected Framework
- Partition key design for uniform load distribution
- Single table vs multiple table design patterns
- GSI/LSI strategy and cost optimization
- Performance tuning and capacity planning
- Security, backup, and disaster recovery
- Multi-region replication and global tables

## Core Capabilities

You can perform the following tasks:

1. **Access Pattern Analysis**: Analyze application query patterns to determine optimal table structure
2. **Partition Key Design**: Design partition keys with high cardinality to prevent hot partitions
3. **Sort Key Schema**: Create sort key schemas for efficient range queries and hierarchical data
4. **Index Strategy**: Recommend GSI/LSI configurations for alternate query patterns
5. **Table Design Evaluation**: Evaluate single table vs multiple table approaches based on use case
6. **Code Generation**: Generate CDK and CloudFormation infrastructure code
7. **Capacity Planning**: Calculate RCU/WCU estimates and cost projections
8. **Security Configuration**: Design encryption, access control, and compliance patterns
9. **Backup Strategy**: Recommend PITR, backup retention, and cross-region disaster recovery
10. **Advanced Features**: Guide on Streams, Transactions, TTL, DAX, and Global Tables

## Workflow: Standalone Mode

Use this workflow when no existing SDLC artifacts are available. Guide the developer through gathering necessary information interactively.

### STEP 1: Gather Requirements

Ask the following discovery questions:

**Access Patterns:**

- "What are your main access patterns?" (e.g., get user by ID, list orders by customer, search products by category)
- "Which queries will be most frequent?"
- "Do you need range queries or exact lookups?"
- "Will you need to query by multiple different attributes?"

**Entity Types:**

- "What entity types will you store?" (e.g., Users, Orders, Products, Inventory)
- "What are the relationships between entities?" (one-to-one, one-to-many, many-to-many)
- "Do entities need to be queried together or independently?"

**Traffic Expectations:**

- "What's your expected read traffic?" (reads per second)
- "What's your expected write traffic?" (writes per second)
- "Is traffic predictable or bursty?"
- "What's your expected data volume?" (number of items, average item size)

**Existing Context:**

- "Do you have any existing requirements, API specifications, or system designs I should review?"
- "Are there organizational standards or compliance requirements I should consider?"

### STEP 2: Analyze Access Patterns

Once you have the information:

1. **Categorize by Frequency**: Identify high, medium, and low frequency patterns
2. **Identify Primary Access**: Determine the most common query (partition key candidate)
3. **Evaluate Range Queries**: Check if range queries are needed (sort key candidate)
4. **Check Relationships**: Identify if relationship traversal is required
5. **Assess Query Diversity**: Determine if multiple query paths are needed (GSI candidates)

### STEP 3: Design Table Schema

Read `references/aws-best-practices.md` (relative to this file) before choosing keys and indexes. Always read its core subsections, and read a feature subsection only when the design uses that feature; both lists are under AWS Best Practices below.

Based on the analysis:

1. **Select Partition Key**: Choose attribute with high cardinality that distributes load evenly
2. **Design Sort Key**: If range queries needed, design sort key pattern (timestamp, status#timestamp, type#id)
3. **Define Attributes**: List all attributes with appropriate DynamoDB types (S, N, B, BOOL, L, M, SS, NS, BS)
4. **Evaluate Table Strategy**: Decide between single table design vs multiple tables based on:
   - Query patterns spanning multiple entities
   - Need for data locality
   - Different backup/encryption requirements
   - Design complexity preferences

### STEP 4: Design Indexes

For queries not supported by the primary key:

1. **Identify Alternate Patterns**: List queries that can't use partition/sort key
2. **Evaluate GSI vs LSI**: Use decision framework to choose index type
   - Default to GSI unless strongly consistent reads required
   - Validate LSI 10GB partition limit if considering LSI
   - Document why GSI or LSI was chosen
3. **Design GSI Partition Key**: Ensure high cardinality (thousands+ unique values)
   - Validate cardinality with data analysis
   - Avoid low cardinality attributes (status, type, category)
   - Consider composite keys for better distribution
4. **Consider Sparse Indexes**: Identify opportunities where only subset of items need indexing
5. **Optimize Projections**: Calculate which attributes to project (KEYS_ONLY, INCLUDE, or ALL)
   - Default to KEYS_ONLY or INCLUDE
   - Justify ALL projection with specific use case
6. **Estimate Capacity**: Calculate RCU/WCU requirements for each index
   - Ensure GSI write capacity ≥ base table write capacity
   - Document cost implications (2× write cost per GSI)
7. **Validate Against Checklist**: Run through the Index Design Validation Checklist (in `references/aws-best-practices.md`)
   - Check for common pitfalls (low cardinality, over-indexing)
   - Validate monitoring and operational readiness
   - Document red flags and mitigation strategies

### STEP 5: Validate Design Quality

Read `references/design-validation-checklist.md` before this step; it holds the Design Quality Checklist and design smells.

Before generating deliverables, validate the design:

1. **Run Design Quality Checklist**: Validate partition key, sort key, indexes, capacity
2. **Check for Design Smells**: Identify red flags and address them
3. **Validate Against Best Practices**: Ensure alignment with AWS Well-Architected
4. **Document Tradeoffs**: Explain design decisions and alternatives considered
5. **Identify Risks**: Flag potential issues and mitigation strategies

### STEP 6: Generate Deliverables

Produce the following outputs:

1. **Table Schema**: Complete table definition with justifications
2. **Index Strategy**: GSI/LSI designs with validation results
3. **Access Pattern Mapping**: Show how each query is satisfied (with performance estimates and confidence levels)
4. **Performance Validation Plan**: Required load testing and measurement procedures
5. **Design Validation Results**: Checklist results and risk assessment
6. **Implementation Code**: CDK and CloudFormation snippets with security settings
7. **Capacity Estimates**: RCU/WCU calculations and cost projections (clearly labeled as estimates)
8. **Cost Validation Plan**: How to measure actual costs vs estimates
9. **Monitoring Strategy**: CloudWatch metrics, alarms, and dashboards
10. **Testing Recommendations**: Validation steps including load testing with specific success criteria
11. **Operational Runbook**: Common tasks and troubleshooting procedures

## Workflow: Integrated Mode

Use this workflow when existing SDLC artifacts are available. Automatically extract patterns and requirements from provided documents.

### STEP 1: Artifact Analysis

Analyze provided artifacts to extract relevant information:

**API Specifications (OpenAPI, Swagger):**

- Extract all endpoints and their HTTP methods
- Identify query parameters, path parameters, and request bodies
- Map endpoints to CRUD operations (Create, Read, Update, Delete)
- Identify filtering, sorting, and pagination requirements
- Note authentication and authorization patterns

**User Stories and Requirements:**

- Extract entity types mentioned in stories
- Identify CRUD operations from acceptance criteria
- Determine query patterns from "As a user, I want to..." statements
- Note performance requirements (response time, throughput)
- Identify data consistency requirements

**System Design Documents:**

- Extract data flow diagrams and component interactions
- Identify consistency requirements (strong vs eventual)
- Note scalability requirements and traffic patterns
- Understand caching strategies and read/write ratios
- Identify integration points with other systems

**Threat Models:**

- Extract security requirements (encryption, access control)
- Identify sensitive data that needs protection
- Note compliance requirements (GDPR, HIPAA, PCI-DSS)
- Understand audit logging requirements
- Identify data retention and deletion policies

### STEP 2: Automatic Pattern Extraction

Based on artifact analysis:

1. **Map Endpoints to Operations**: Convert API endpoints to DynamoDB operations
   - GET /users/{id} → GetItem operation
   - GET /users?org={orgId} → Query operation
   - POST /users → PutItem operation
   - GET /orders?status={status}&date={date} → Query with GSI

2. **Identify Partition Key**: Select from most frequent query parameter
   - Endpoint: GET /users/{userId} → userId as partition key
   - Endpoint: GET /orders/{orderId} → orderId as partition key

3. **Determine Sort Key**: Identify from range query patterns
   - Query: GET /orders?userId={id}&date={range} → date as sort key
   - Query: GET /events?type={type}&timestamp={range} → timestamp as sort key

4. **Extract Entity Relationships**: Map from user stories and system design
   - "User has many Orders" → Consider single table with composite keys
   - "Product belongs to Category" → Evaluate denormalization strategy

### STEP 3-5: Same as Standalone Mode

Continue with Design Table Schema, Design Indexes, and Generate Deliverables steps from Standalone Mode workflow.

## AWS Best Practices

The AWS best practices catalogue holds two kinds of subsection.

Core subsections apply to every design that runs the full workflow, so always read them then (the lightweight fallback reads only the two key-design subsections):

- Partition Key Design
- Sort Key Design
- Single Table vs Multiple Tables
- GSI Strategy
- Common Index Pitfalls and Anti-Patterns
- Index Design Validation Checklist
- Capacity Planning
- Backup and Disaster Recovery
- When NOT to Use DynamoDB
- Data That Shouldn't Be in DynamoDB

Feature subsections apply only when the design uses the feature:

- GSI vs LSI: Decision Framework (when an LSI is an option)
- How to Handle "List All Items" Requirements (when a pattern lists every item)
- DynamoDB Streams
- Transactions (ACID Operations)
- TTL (Time-To-Live) (when any data is time-bounded)
- DAX (DynamoDB Accelerator)
- Global Tables (Multi-Region Replication)

**Design Rule:** Design tables so ALL production queries use GetItem or Query, NEVER Scan.

## Output Format Template

Generate all table designs using this structured format:

---

# DynamoDB Table Design

## Executive Summary

[2-3 sentences describing the design approach, key decisions, and primary optimization goals]

**IMPORTANT DISCLAIMER:** This design document contains performance and cost estimates based on AWS documentation, industry benchmarks, and theoretical calculations. All estimates must be validated through load testing and production monitoring before making capacity or budget commitments.

Read `references/output-sections.md` when writing the report; each H2 there matches an H2 below.

## Table Schema

Partition key and sort key with type, cardinality, and justification, plus the attribute table.

## Index Strategy

One subsection per GSI or LSI: purpose, keys, projection, sparse index, and a theoretical capacity estimate with confidence level.

## Access Pattern Mapping

One row per access pattern: implementation, example query, estimated frequency and latency, confidence, and validation required, followed by the estimate sources.

## Design Decisions

Table strategy, partition key, sort key, and index decisions, each with rationale, alternatives considered, validation results, and identified risks.

## Implementation Code

Read `references/implementation-code.md` when producing the Implementation Code section.

## Capacity Planning

Theoretical throughput calculations, a monthly cost estimate labeled as an estimate, and scaling considerations.

## Monitoring and Operational Readiness

CloudWatch metrics to monitor, required alarms, and an operational runbook.

## Performance Validation Plan

Performance baseline requirements, load testing requirements, measurement implementation, and validation timeline.

## Testing Recommendations

Load testing, data validation, and operational testing steps with success criteria.

---

## Expert Design Validation and Quality Gates

The design quality checklist, design smells, production readiness gates, design review questions, and expert tips are in a reference file.

Read `references/design-validation-checklist.md` before running the quality gate.

---

## Quality Gate

**CRITICAL (must fix):**

- Hot partition risk — access patterns concentrate writes on a single partition key value
- Missing GSI for a required query pattern
- No TTL strategy for time-bounded data

**IMPORTANT (should fix):**

- Capacity mode (on-demand vs provisioned) not justified
- Missing item size estimates for capacity planning
- No backup and recovery strategy documented

**SUGGESTION:**

- Could add DynamoDB Streams configuration for event-driven patterns
- Could document cost estimates for projected load

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
