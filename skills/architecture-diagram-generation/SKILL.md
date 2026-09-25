---
name: architecture-diagram-generation
description: Use when a system design document needs a visual AWS architecture diagram, or someone asks to draw or diagram an AWS architecture. Generates draw.io XML with official AWS icons and directional data flows, single- or multi-account, compatible with Amazon Design Inspector.
version: 1.0.0
tags: [skill, architecture, diagram, drawio, design-inspector, aws]
---

# Architecture Diagram Generation

## Overview

Generates draw.io XML diagrams from system design descriptions. Diagrams follow AWS Well-Architected Framework conventions with official service icons, proper service scope placement (global/regional/VPC), and security boundaries.

## Usage

Use this skill when:

- Converting a system design document into a visual diagram
- Preparing diagrams for Design Inspector or stakeholder review
- Documenting multi-account or multi-region architectures

## Core Concepts

### Diagram Standards

Diagrams follow AWS Well-Architected Framework conventions: official AWS service icons, proper service scope placement (global services outside regions, regional services inside regions, VPC-scoped services inside VPCs), directional data flow arrows with labels, and security boundaries (account boundaries, VPC boundaries, subnet boundaries).

### Output Format

Produces draw.io XML compatible with Amazon Design Inspector. Supports single-account and multi-account architectures.

## Execution

When this skill is activated, use the following as your full instruction set for generating the architecture diagram. Apply the Quality Gate at the end before presenting output to the user.

---

# Architecture Diagram Generator

## Purpose

This document provides specific implementation guidance for generating AWS architecture diagrams using draw.io XML format that are compatible with Design Inspector, a diagramming platform built on DrawIO with AWS-specific features and security integration.

## Prerequisites

- **Draw.io or Lucidchart**: For importing and editing XML templates
- **XML Editor**: For manual template creation and modification
- **AWS Icon Library**: Official AWS architecture icons
- **Project Analysis**: Complete architecture analysis from main steering document

## Design Inspector Compatible XML Standards

These standards ensure compatibility with both Design Inspector and standard draw.io implementations:

### 1. XML Structure Foundation

```xml
<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>

    <!-- All diagram elements go here -->
  </root>
</mxGraphModel>
```

### 2. Service Scope Representation

**Global Services** (outside VPC, inside account):

- S3, CloudFront, Route 53, IAM, WAF

**Regional Services** (inside region, outside VPC):

- DynamoDB, Lambda, API Gateway, Cognito

**VPC Services** (inside VPC):

- EC2, RDS, ECS, ALB, NAT Gateway

### 3. Connection and Data Flow Standards

**Arrow Types and Colors**:

- **Blue arrows**: Primary data flow (user requests)
- **Green arrows**: Internal service communication
- **Red arrows**: Error/alert flows
- **Orange arrows**: Monitoring/logging data
- **Dashed arrows**: Return traffic or intermittent connections
- **Color-coded relationships**: Use different colors for multi-region traffic (e.g., blue for US-East-1, red for EU-West-1)

**Connection Labels**:

- Include protocol (HTTPS, TCP, UDP)
- Show port numbers where relevant
- Indicate data types (JSON, binary, etc.)
- Add labels to arrows and lines to provide context and explain the purpose of the connection

**Connection Best Practices**:

- Use arrows to clearly indicate the direction of data flow between different components
- Use lines to represent connections between services (network connections, database connections)
- Show return traffic with intermittent/dashed arrows
- Avoid too many lines for complex relationships - use color coding or selective connection display
- Show load balancing patterns with appropriate arrow distributions

### 4. Standardized AWS Icons and Formatting

**Icon Standards**:

- Use official AWS service icons with consistent sizing:
  - **Large icons** (64x64): Primary services
  - **Medium icons** (48x48): Supporting services
  - **Small icons** (32x32): Utility services
- Purpose: Using official AWS icons ensures a consistent and readily understandable visual language

**Diagram Formatting**:

- **Clear diagram title and description**: Put the title of the diagram on top
- **Consistent visual hierarchy**: Proper spacing and alignment
- **Title communication**: The title should communicate the system and the diagram's purpose or intent

**Architecture Organization**:

- **Clear account boundaries**: Depict AWS account boundary, even for single account solutions
- **Regional/AZ separation**: Show regional and availability zone boundaries
- **Logical service grouping**: Group related services with boxes and intermittent lines
- **Security zones identification**: Clearly mark security boundaries and zones (essential for Design Inspector threat modeling)
- **Threat Model Compatibility**: Structure diagrams to support Design Inspector's automated threat detection
- **Security Properties**: Include security-relevant metadata that Design Inspector can analyze

## Design Inspector Compatible XML Templates

These templates are optimized for Design Inspector's security analysis and threat modeling features:

### Single Account Architecture Template

```xml
<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>

    <!-- Title -->
    <mxCell id="title" value="{SYSTEM_NAME} - {ENVIRONMENT} Architecture"
           style="text;fontSize=20;fontStyle=1;align=center;fillColor=none;"
           vertex="1" parent="1">
      <mxGeometry x="400" y="20" width="400" height="30" as="geometry"/>
    </mxCell>

    <!-- AWS Account -->
    <mxCell id="account" value="AWS Account: {ACCOUNT_NAME} ({ACCOUNT_ID})"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;dashed=1;fontSize=14;fontStyle=1;"
           vertex="1" parent="1">
      <mxGeometry x="50" y="80" width="1100" height="700" as="geometry"/>
    </mxCell>

    <!-- Region -->
    <mxCell id="region" value="Region: {REGION_NAME}"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;dashed=1;fontSize=12;fontStyle=1;"
           vertex="1" parent="1">
      <mxGeometry x="80" y="120" width="1040" height="620" as="geometry"/>
    </mxCell>

    <!-- VPC -->
    <mxCell id="vpc" value="VPC: {VPC_NAME}"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;dashed=1;fontSize=12;"
           vertex="1" parent="1">
      <mxGeometry x="110" y="160" width="980" height="540" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

### Multi-Account Architecture Template

```xml
<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1400" pageHeight="900">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>

    <!-- Title -->
    <mxCell id="title" value="{SYSTEM_NAME} - Multi-Account Architecture"
           style="text;fontSize=20;fontStyle=1;align=center;"
           vertex="1" parent="1">
      <mxGeometry x="500" y="20" width="400" height="30" as="geometry"/>
    </mxCell>

    <!-- Production Account -->
    <mxCell id="prod_account" value="Production Account ({PROD_ACCOUNT_ID})"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;dashed=1;fontSize=14;fontStyle=1;"
           vertex="1" parent="1">
      <mxGeometry x="50" y="80" width="600" height="380" as="geometry"/>
    </mxCell>

    <!-- Development Account -->
    <mxCell id="dev_account" value="Development Account ({DEV_ACCOUNT_ID})"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;dashed=1;fontSize=14;fontStyle=1;"
           vertex="1" parent="1">
      <mxGeometry x="700" y="80" width="600" height="380" as="geometry"/>
    </mxCell>

    <!-- Shared Services Account -->
    <mxCell id="shared_account" value="Shared Services Account ({SHARED_ACCOUNT_ID})"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;dashed=1;fontSize=14;fontStyle=1;"
           vertex="1" parent="1">
      <mxGeometry x="375" y="500" width="550" height="300" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

### AWS Service Icon Examples

```xml
<!-- API Gateway -->
<mxCell id="api_gateway" value="REST API"
       style="sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;gradientColor=#FF4F8B;gradientDirection=north;fillColor=#BC1356;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;"
       vertex="1" parent="1">
  <mxGeometry x="300" y="300" width="78" height="78" as="geometry"/>
</mxCell>

<!-- Lambda Function -->
<mxCell id="lambda" value="Task Service"
       style="sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;gradientColor=#F78E04;gradientDirection=north;fillColor=#D05C17;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;"
       vertex="1" parent="1">
  <mxGeometry x="500" y="300" width="78" height="78" as="geometry"/>
</mxCell>

<!-- DynamoDB -->
<mxCell id="dynamodb" value="Tasks DB"
       style="sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;gradientColor=#4D72F3;gradientDirection=north;fillColor=#3334B9;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;"
       vertex="1" parent="1">
  <mxGeometry x="700" y="300" width="78" height="78" as="geometry"/>
</mxCell>

<!-- Connection Arrow -->
<mxCell id="connection1" value="HTTPS"
       style="endArrow=classic;html=1;rounded=0;strokeColor=#0066CC;strokeWidth=2;"
       edge="1" parent="1" source="api_gateway" target="lambda">
  <mxGeometry width="50" height="50" relative="1" as="geometry">
    <mxPoint x="400" y="400" as="sourcePoint"/>
    <mxPoint x="450" y="350" as="targetPoint"/>
  </mxGeometry>
</mxCell>
```

## XML Generation Process

### 1. Review Use-Case Requirements

- Review the use-case prompt thoroughly to understand system requirements
- Identify if architecture is spanning single account or multi-account
- Apply AWS Well-Architected Framework principles
- Determine complexity level and need for multiple diagrams

### 2. Break Down Complexity

- **Multiple Diagrams**: For complex architectures, create multiple diagrams to focus on specific areas or levels of detail
- **Multi-Account Architecture**: Depict the AWS account boundary, even if your solution has a single AWS account
- **Separate Diagrams**: For multi-account scenarios, show only participating accounts of the system or subsystem
- **Environment Focus**: At least one diagram should represent the exact system's production environment

### 3. Start with Template

- Choose appropriate template (single/multi-account)
- Replace placeholder values with actual system information
- Validate basic XML structure

### 4. Add AWS Services

- Use official AWS service icons with proper styling
- Position services according to scope (global/regional/VPC)
- Ensure consistent icon sizing and alignment

### 5. Create Connections

- Add directional arrows with appropriate colors
- Include meaningful labels for protocols and data types
- Use dashed lines for return traffic
- Validate all source/target references

### 6. Design Inspector Validation Checklist

- [ ] All AWS services use official icons
- [ ] Service scope is correctly represented (global/regional/VPC)
- [ ] Global services (S3, CloudFront, Route 53) are inside account but not within VPC
- [ ] Regional services (DynamoDB, Lambda, API Gateway) are inside region but outside VPC
- [ ] VPC services (EC2, RDS, ECS) are properly contained within VPC boundaries
- [ ] Data flow arrows show correct direction
- [ ] Return traffic is indicated with dashed/intermittent arrows
- [ ] Security boundaries are clearly marked (critical for Design Inspector threat modeling)
- [ ] Account boundaries are properly depicted
- [ ] Diagram title is descriptive and clear, positioned on top
- [ ] Logical grouping is shown with boxes and intermittent lines
- [ ] Color-coded relationships are used for complex multi-region scenarios
- [ ] XML structure is valid for Design Inspector import
- [ ] All IDs are unique and follow Design Inspector naming conventions
- [ ] Proper parent-child relationships maintained
- [ ] Security zones are properly defined for threat analysis
- [ ] Data classification boundaries are indicated where applicable
- [ ] Trust boundaries are clearly marked for security review

## Common XML Patterns

### 1. Serverless Web Application XML

```xml
<!-- User -->
<mxCell id="user" value="User"
       style="sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=#232F3D;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.user;"
       vertex="1" parent="1">
  <mxGeometry x="100" y="200" width="78" height="78" as="geometry"/>
</mxCell>

<!-- CloudFront -->
<mxCell id="cloudfront" value="CDN"
       style="sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;gradientColor=#945DF2;gradientDirection=north;fillColor=#5A30B5;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudfront;"
       vertex="1" parent="1">
  <mxGeometry x="300" y="200" width="78" height="78" as="geometry"/>
</mxCell>

<!-- Connection -->
<mxCell id="user_to_cloudfront" value="HTTPS"
       style="endArrow=classic;html=1;rounded=0;strokeColor=#0066CC;strokeWidth=2;"
       edge="1" parent="1" source="user" target="cloudfront">
  <mxGeometry width="50" height="50" relative="1" as="geometry">
    <mxPoint x="200" y="300" as="sourcePoint"/>
    <mxPoint x="250" y="250" as="targetPoint"/>
  </mxGeometry>
</mxCell>
```

### 2. Logical Grouping Pattern

```xml
<!-- API Gateway Cluster with intermittent lines -->
<mxCell id="api_cluster" value="API Layer"
       style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;dashed=1;fontSize=12;fontStyle=1;"
       vertex="1" parent="1">
  <mxGeometry x="200" y="150" width="300" height="200" as="geometry"/>
</mxCell>

<!-- Services within cluster -->
<mxCell id="api_gateway" value="API Gateway" parent="api_cluster" vertex="1">
  <mxGeometry x="50" y="50" width="78" height="78" as="geometry"/>
</mxCell>

<mxCell id="lambda_service" value="Lambda" parent="api_cluster" vertex="1">
  <mxGeometry x="172" y="50" width="78" height="78" as="geometry"/>
</mxCell>

<!-- Return traffic with dashed arrow -->
<mxCell id="return_traffic" value="Response"
       style="endArrow=classic;html=1;rounded=0;strokeColor=#0066CC;strokeWidth=2;dashed=1;"
       edge="1" parent="1" source="lambda_service" target="api_gateway">
  <mxGeometry width="50" height="50" relative="1" as="geometry">
    <mxPoint x="300" y="250" as="sourcePoint"/>
    <mxPoint x="250" y="200" as="targetPoint"/>
  </mxGeometry>
</mxCell>
```

## Error Prevention Guidelines

### 1. Common Mistakes to Avoid

- Placing global services inside VPC boundaries
- Incorrect arrow directions for data flow
- Missing return traffic indicators
- Overcomplicated connection lines
- Inconsistent icon sizing
- Missing security boundaries
- Invalid XML structure
- Duplicate IDs
- Broken parent-child relationships

### 2. Validation Steps

- Verify service scope placement
- Check arrow directions match data flow
- Ensure all connections are labeled
- Validate XML syntax
- Test import in draw.io
- Verify all IDs are unique
- Check proper parent-child relationships

## Output Requirements

Generate complete Design Inspector compatible XML that includes:

1. **Valid XML Structure**: Proper mxGraphModel format compatible with Design Inspector
2. **Comprehensive Service Representation**: All relevant AWS services with official icons
3. **Clear Data Flow**: Directional arrows with labels for security analysis
4. **Proper Boundaries**: Account, region, VPC boundaries clearly marked for threat modeling
5. **Professional Formatting**: Consistent styling and layout following Design Inspector standards
6. **Complete Documentation**: Service descriptions and relationships with security context
7. **Interactive Elements**: Properly structured for editing in Design Inspector
8. **Security Metadata**: Include security-relevant properties for automated threat detection
9. **Trust Boundaries**: Clearly defined security zones for threat modeling workflows
10. **Compliance Markers**: Elements that support Design Inspector's security review integration

The generated diagram should be immediately importable into Design Inspector and represent a production-ready AWS architecture following all best practices and Well-Architected Framework principles.

---

## Quality Gate

**CRITICAL (must fix):**

- Services placed in wrong scope (e.g., global service shown inside VPC)
- Data flow directions missing or incorrect
- Official AWS service icons not used

**IMPORTANT (should fix):**

- Security boundaries (VPC, account boundaries) not shown
- Multi-account relationships not represented if applicable
- Missing labels on data flow arrows

**SUGGESTION:**

- Could add availability zone separation for HA architectures
- Could annotate flows with protocol or data type

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
