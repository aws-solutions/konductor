---
name: threat-modeling
description: Use when a system design is done and the AWS service needs its security risks and mitigations identified. Produces a STRIDE threat model with architecture analysis, threats, and security controls.
version: 1.0.0
tags: [skill, threat-modeling, security, stride, aws, architecture]
---

# Threat Modeling

## Overview

Generates threat models through a 10-step workflow: gathers architecture documentation, applies STRIDE methodology, maps security controls to threats, and produces a complete threat model document.

## Usage

Use this skill when:

- Completing system design and ready to identify security risks
- Preparing for a security review or AppSec engagement
- Documenting security controls for compliance

## Core Concepts

### STRIDE Methodology

Analyzes threats across six categories: Spoofing (identity), Tampering (data integrity), Repudiation (audit trails), Information Disclosure (data leaks), Denial of Service (availability), and Elevation of Privilege (authorization bypass). Each component in the architecture is evaluated against all six categories.

## Execution

When this skill is activated, use the following as your full instruction set for generating the threat model. Apply the Quality Gate at the end before presenting output to the user.

---

# AWS Threat Model Generator

## Purpose

This steering document provides guidance for generating AWS service threat models following security documentation standards. It integrates the official AWS threat model template structure with systematic threat identification processes.

## Core Workflow

The threat modeling process follows a 10-step workflow designed for efficient context management and comprehensive security analysis:

1. **Verify Dependencies** - Check required tools availability
2. **Clarify Scope** - Define threat model boundaries with user
3. **Gather Design Documents** - Collect and analyze architecture documentation
4. **Collect Service Information** - Document service functionality and security context
5. **Analyze Template** - Process AWS threat model template and reference models
6. **Create Introduction** - Build project background and scope documentation
7. **Document Architecture** - Detail system design and components
8. **Identify Threats** - Systematic threat analysis using STRIDE methodology
9. **Define Mitigations** - Map security controls to identified threats
10. **Generate Final Document** - Compile complete threat model

## Context Management Strategy

**Critical**: This process involves analyzing large documents and templates. Use phased processing with immediate summarization and context clearing between phases to maintain efficiency.

## Required Parameters

### Core Parameters

- **service_name** (required): AWS service name for threat modeling
- **threat_model_scope** (required): Specific scope boundaries (may be narrower than full service)
- **design_document_urls** (optional): Architecture documents, design specs, security reviews
- **existing_threat_models** (optional): Related threat model references
- **template_url** (optional): AWS Threat Model Template URL (defaults to standard template)

### Collection Guidelines

- Collect all required parameters upfront in single interaction
- Validate parameters before proceeding with analysis
- Clarify scope boundaries explicitly with user
- Support multiple URLs as comma-separated lists
- Encourage optional parameters for comprehensive analysis

### Security Assessment Principles

**CRITICAL**: Follow these principles to ensure accurate, non-speculative threat modeling:

- **Document-Driven Analysis**: Base all threat assessments solely on components explicitly documented in design materials
- **No Component Hallucination**: Never assume or infer the existence of security controls, services, or architecture components not clearly specified
- **Validation-First Approach**: When components or security implementations are unclear, ask clarifying questions rather than making assumptions
- **Scope Adherence**: Limit threat analysis to documented architecture within the defined scope boundaries
- **Evidence-Based Threats**: Only identify threats that apply to the actual documented implementation, not theoretical possibilities
- **User Confirmation**: Validate understanding of architecture components and security controls with the user before proceeding with threat analysis

## Implementation Steps

### Step 1: Verify Dependencies

Check required tools and file-write access. Inform user of missing tools and confirm whether to proceed.

### Step 2: Clarify Threat Model Scope

Define clear scope boundaries with user:

- Identify in-scope components, features, and aspects
- Document out-of-scope elements explicitly
- Confirm scope understanding and alignment
- Consider threat model objective (launch, compliance, security review)
- Suggest appropriate scope boundaries based on common practices

### Step 3: Gather and Analyze Design Documents

Process design documents using phased context management:

**Document Processing**:

- Categorize documents by type (architecture, API specs, security reviews)
- Process in batches of 2-3 documents maximum
- Extract scope-relevant information using appropriate tools
- Immediately summarize and clear raw content after processing
- Identify gaps and inconsistencies between documents
- Ask clarifying questions for ambiguous information
- Consolidate summaries into unified architecture view

### Step 4: Gather Service Information

Collect essential service information within defined scope:

- Core functionality and architecture components
- Data handling and storage mechanisms
- Authentication and authorization systems
- Integration points with other services
- Security concerns and requirements
- Deployment model (internal, external, multi-tenant)
- Confirm understanding of critical security aspects

### Step 5: Analyze Template and Reference Models

Process AWS Threat Model Template and reference models:

- Retrieve template from your architecture or design documentation
- Extract required sections and structure
- Process reference models in batches (max 2 per batch)
- Immediately summarize and clear raw content
- Identify applicable patterns and approaches
- Consolidate template guidance for threat model generation

### Step 6: Create Introduction Section

Build comprehensive introduction with user:

- Project background and business context
- Concise service overview
- Clear scope documentation (in-scope and out-of-scope)
- Security tenets aligned with AWS principles
- Key assumptions with potential mitigations
- Administrative information (AppSec reviews, team info, documentation references)

### Step 7: Document System Architecture

Document architecture focusing on defined scope:

- High-level design with architecture diagrams
- Low-level design for in-scope components
- Authentication/authorization mechanisms
- API specifications (methods, operations, authorization, accessibility)
- Asset inventory (new/existing assets, usage, data classifications, security considerations)
- Clear indication of out-of-scope components

### Step 8: Identify Threats

Systematic threat identification using STRIDE methodology:

- Identify threat actors (external and internal)
- Analyze security anti-patterns within scope
- Create STRIDE-based threat categorization with priority levels
- Use consistent threat numbering (T-001, T-002, etc.)
- Focus on in-scope assets and components
- Suggest 10-15 potential threats for consideration
- Confirm threat assessment with user

### Step 9: Define Mitigations

Document comprehensive mitigations for identified threats:

- Baseline Security Controls (BSCs) implementation
- System-specific mitigations with threat mapping
- Implementation status and verification evidence
- Security testing strategy (test cases, coverage, types)
- Consistent mitigation numbering (M-001, M-002, etc.)
- Ensure each threat has at least one mitigation
- Confirm mitigation strategies with user

### Step 10: Generate Final Document

Compile complete threat model document:

- Organize all sections according to template structure
- Ensure all required sections are complete
- Create appendices for terminology, references, etc.
- Review document for completeness using quality checklist
- Validate final document accuracy with user
- Offer to save document to file and suggest review process

**Document Structure Validation**:

- Main document contains STRIDE threats and system-specific mitigations
- Clear separation maintained between core analysis and supplementary guidance

## AWS Threat Model Template Structure

Standard template sections for final document:

### Introduction

- Project Background and Service Overview
- Scope (In-Scope and Out-of-Scope components)
- Security Tenets and Key Assumptions
- Administrative Information (AppSec reviews, team info, documentation)

### System Architecture

- High-Level and Low-Level Design
- Authentication and Authorization mechanisms
- API Specifications and Asset Inventory

### Threat Analysis

- Threat Actors and Security Anti-Patterns
- STRIDE-Based Threat Categorization table

### Mitigations

- Baseline Security Controls (BSCs)
- System-Specific Mitigations table
- Security Testing Strategy

### Appendix

- **Appendix A**: Terminology and Monitoring/Logging
- **Appendix B**: References and supporting documentation

## Troubleshooting Guidelines

### Common Issues and Solutions

**Template Access**: Consult your architecture or design documentation, use alternative access methods, proceed with embedded template knowledge

**Scope Definition**: Start with specific features, consider data flows and trust boundaries, focus on highest risk components

**Document Integration**: Create consolidated information maps, resolve contradictions, ask user for precedence clarification

**Threat Identification**: Review STRIDE methodology, consider components separately, reference similar service models

**Mitigation Mapping**: Start with highest priority threats, use AWS standard controls, look for patterns in reference models

## Context Management Best Practices

### Phased Processing Workflow

**Phase 1 (Setup)**: Minimal context - parameter collection and tool verification
**Phase 2 (Information Gathering)**: High context managed through batching - document processing and template analysis
**Phase 3 (Content Creation)**: Medium context - introduction, architecture, threats, mitigations
**Phase 4 (Integration)**: Medium context - final assembly

### Key Optimization Rules

- Never retain raw document content - always summarize immediately
- Batch processing limits - maximum 2-3 large documents per batch
- Smart looping - process one item at a time with immediate clearing
- Incremental building - construct final document in phases
- Strategic clearing - remove intermediate artifacts between phases
- Graceful degradation - continue with available information if context limits reached

## Quality Checklist

Final validation requirements:

- [ ] Required parameters collected and validated
- [ ] Scope clearly defined and consistently applied
- [ ] All template sections complete
- [ ] Threats properly categorized using STRIDE methodology
- [ ] Each threat has corresponding mitigation
- [ ] Mitigations mapped with implementation status
- [ ] Professional security documentation standards followed
- [ ] User validated final document accuracy
- [ ] Assumptions and limitations clearly documented

---

## Quality Gate

**CRITICAL (must fix):**

- Authentication and authorization threats not analyzed
- Data in transit and at rest encryption not addressed
- No mitigations defined for HIGH severity threats
- External trust boundaries not identified

**IMPORTANT (should fix):**

- STRIDE categories not fully covered for each component
- Security testing strategy not included

**SUGGESTION:**

- Could add threat likelihood and impact scoring
- Could reference specific AWS security services for each mitigation

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
