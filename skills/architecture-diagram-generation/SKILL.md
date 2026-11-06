---
name: architecture-diagram-generation
description: Generates AWS architecture diagrams in draw.io XML format compatible with Amazon Design Inspector. Use when you need a visual diagram from a system design document. Produces single or multi-account diagrams with official AWS service icons and directional data flows.
version: 1.0.0
tags: [skill, architecture, diagram, drawio, design-inspector, aws]
---

# Architecture Diagram Generation

Generates AWS architecture diagrams as draw.io XML from a system design description, for single-account and multi-account architectures. Diagrams follow AWS Well-Architected Framework conventions: official AWS service icons, each service placed in its scope (global, regional, VPC), labeled directional data flows, and account, VPC and subnet boundaries. The XML imports into standard draw.io and into Design Inspector, a diagramming platform built on draw.io with AWS-specific features and security integration.

Use this skill to turn a system design document into a diagram, to prepare diagrams for Design Inspector or stakeholder review, or to document multi-account or multi-region architectures. Apply the Quality Gate at the end before presenting output to the user.

## Prerequisites

- **Draw.io or Lucidchart**: For importing and editing XML templates
- **XML Editor**: For manual template creation and modification
- **AWS Icon Library**: Official AWS architecture icons

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

## XML Generation Process

Open `references/drawio-templates.md` (relative to this file) when generating the XML. It holds the single-account and multi-account templates, the AWS service icon styles, and the serverless web application and logical grouping patterns.

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

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
