---
name: threat-modeling
description: 'Generates AWS service threat models using STRIDE methodology. Use when asked for a threat model or STRIDE analysis, the security risks of a design, or prep for a security review. Produces a complete threat model with architecture analysis, threat identification, and security controls.'
version: 1.0.0
tags: [skill, threat-modeling, security, stride, aws, architecture]
---

# Threat Modeling

## Overview

Generates threat models through a 9-step workflow: gathers architecture documentation, applies STRIDE methodology, maps security controls to threats, and produces a complete threat model document.

## Usage

Use this skill when:

- Completing system design and ready to identify security risks
- Preparing for a security review or AppSec engagement
- Documenting security controls for compliance

## Core Concepts

### STRIDE Methodology

Analyzes threats across six categories: Spoofing (identity), Tampering (data integrity), Repudiation (audit trails), Information Disclosure (data leaks), Denial of Service (availability), and Elevation of Privilege (authorization bypass). Each component in the architecture is evaluated against all six categories.

## Workflow

Apply the Quality Gate before presenting output.

1. **Clarify Scope** - Define threat model boundaries with user
2. **Gather Design Documents** - Collect and analyze architecture documentation
3. **Collect Service Information** - Document service functionality and security context
4. **Analyze Template** - Use the Threat Model Template below, plus any reference models
5. **Create Introduction** - Build project background and scope documentation
6. **Document Architecture** - Detail system design and components
7. **Identify Threats** - Systematic threat analysis using STRIDE methodology
8. **Define Mitigations** - Map security controls to identified threats
9. **Generate Final Document** - Compile complete threat model

## Context Management

The design documents and reference models can be large. Process at most 2-3 large documents per batch, reference models included. Summarize each document as you read it and work from the summaries. Build the final document section by section. If context runs short, continue with the information you have and list what was left out.

## Required Parameters

### Core Parameters

- **service_name** (required): AWS service name for threat modeling
- **threat_model_scope** (required): Specific scope boundaries (may be narrower than full service)
- **design_document_urls** (optional): Architecture documents, design specs, security reviews
- **existing_threat_models** (optional): Related threat model references
- **template_url** (optional): a team threat model template to use instead of the Threat Model Template below

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

### Step 1: Clarify Threat Model Scope

Define clear scope boundaries with user:

- Identify in-scope components, features, and aspects
- Document out-of-scope elements explicitly
- Confirm scope understanding and alignment
- Consider threat model objective (launch, compliance, security review)
- Suggest appropriate scope boundaries based on common practices

### Step 2: Gather and Analyze Design Documents

Process design documents in batches, following Context Management above:

**Document Processing**:

- Categorize documents by type (architecture, API specs, security reviews)
- Extract scope-relevant information
- Identify gaps and inconsistencies between documents
- Ask clarifying questions for ambiguous information
- Consolidate summaries into unified architecture view

### Step 3: Gather Service Information

Collect essential service information within defined scope:

- Core functionality and architecture components
- Data handling and storage mechanisms
- Authentication and authorization systems
- Integration points with other services
- Security concerns and requirements
- Deployment model (internal, external, multi-tenant)
- Confirm understanding of critical security aspects

### Step 4: Analyze Template and Reference Models

Use the Threat Model Template below unless the user gave a `template_url`:

- Extract required sections and structure from the template
- Process reference models in batches, following Context Management above
- Identify applicable patterns and approaches
- Consolidate template guidance for threat model generation

### Step 5: Create Introduction Section

Build comprehensive introduction with user:

- Project background and business context
- Concise service overview
- Clear scope documentation (in-scope and out-of-scope)
- Security tenets aligned with AWS principles
- Key assumptions with potential mitigations
- Administrative information (AppSec reviews, team info, documentation references)

### Step 6: Document System Architecture

Document architecture focusing on defined scope:

- High-level design with architecture diagrams
- Low-level design for in-scope components
- Authentication/authorization mechanisms
- API specifications (methods, operations, authorization, accessibility)
- Asset inventory (new/existing assets, usage, data classifications, security considerations)
- Clear indication of out-of-scope components

### Step 7: Identify Threats

Systematic threat identification using STRIDE methodology:

- Identify threat actors (external and internal)
- Analyze security anti-patterns within scope
- Create STRIDE-based threat categorization with priority levels
- Use consistent threat numbering (T-001, T-002, etc.)
- Focus on in-scope assets and components
- Suggest 10-15 potential threats for consideration
- Confirm threat assessment with user

### Step 8: Define Mitigations

Document comprehensive mitigations for identified threats:

- Baseline Security Controls (BSCs) implementation
- System-specific mitigations with threat mapping
- Implementation status and verification evidence
- Security testing strategy (test cases, coverage, types)
- Consistent mitigation numbering (M-001, M-002, etc.)
- Ensure each threat has at least one mitigation
- Confirm mitigation strategies with user

### Step 9: Generate Final Document

Compile complete threat model document:

- Organize all sections according to template structure
- Ensure all required sections are complete
- Create appendices for terminology, references, etc.
- Review document for completeness against the Quality Gate
- Validate final document accuracy with user
- Offer to save document to file and suggest review process

**Document Structure Validation**:

- Main document contains STRIDE threats and system-specific mitigations
- Clear separation maintained between core analysis and supplementary guidance

## Threat Model Template

Default sections for the final document:

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

**Template Access**: If a `template_url` can't be read, tell the user and use the Threat Model Template above

**Scope Definition**: Start with specific features, consider data flows and trust boundaries, focus on highest risk components

**Document Integration**: Create consolidated information maps, resolve contradictions, ask user for precedence clarification

**Threat Identification**: Review STRIDE methodology, consider components separately, reference similar service models

**Mitigation Mapping**: Start with highest priority threats, use AWS standard controls, look for patterns in reference models

## Quality Gate

**CRITICAL (must fix):**

- Authentication and authorization threats not analyzed
- Data in transit and at rest encryption not addressed
- No mitigations defined for HIGH severity threats
- External trust boundaries not identified

**IMPORTANT (should fix):**

- STRIDE categories not fully covered for each component
- Security testing strategy not included
- A threat has no mitigation
- Scope, assumptions, or limitations not documented

**SUGGESTION:**

- Mitigations lack implementation status
- Could add threat likelihood and impact scoring
- Could reference specific AWS security services for each mitigation

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
