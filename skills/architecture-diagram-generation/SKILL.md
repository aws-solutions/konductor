---
name: architecture-diagram-generation
description: Generates AWS architecture diagrams as draw.io (diagrams.net) XML. Use when you need a visual diagram from a system design document. Draws single or multi-account layouts with official AWS icons and directional data flows.
version: 1.0.0
tags: [skill, architecture, diagram, drawio, aws]
---

# Architecture Diagram Generation

Generates AWS architecture diagrams as draw.io XML from a system design description, for single-account and multi-account architectures. Diagrams follow AWS Well-Architected Framework conventions: official AWS service icons, each service placed in its scope (global, regional, VPC), labeled directional data flows, and account, VPC and subnet boundaries. Save the XML as a `.drawio` file and open it in draw.io (desktop or app.diagrams.net), or paste it into Extras > Edit Diagram.

Use this skill to turn a system design document into a diagram, to prepare diagrams for security or stakeholder review, or to document multi-account or multi-region architectures. Apply the Quality Gate at the end before presenting output to the user.

## Prerequisites

- **draw.io (diagrams.net)**: For opening and editing the generated XML
- **XML Editor**: For manual template creation and modification
- **AWS shape library**: draw.io's built-in AWS icons, referenced by `mxgraph.aws4.*` styles

## draw.io XML Standards

The XML must be a valid draw.io `mxGraphModel`, so the file opens without errors:

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

**Global Services** (inside account, outside any region and VPC):

- IAM, CloudFront, Route 53, WAF web ACLs scoped to CloudFront

**Regional Services** (inside region, outside VPC):

- S3, DynamoDB, Lambda (without VPC config), API Gateway, Cognito, WAF web ACLs with regional scope (for example on an ALB or API Gateway)

S3 bucket names are global, but each bucket lives in one region, so draw it in that region.

**VPC Services** (inside VPC):

- EC2, RDS, ECS, ALB, NAT Gateway

A Lambda function with VPC config (`VpcConfig` subnets) goes in its subnets. Other Lambda functions stay regional.

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
- **Security zones identification**: Clearly mark security boundaries and zones
- **Trust boundaries**: Mark where data crosses a trust boundary (internet to edge, edge to VPC, account to account), so the diagram can feed a threat model

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

Open `references/drawio-templates.md` (relative to this file) now, before writing any XML. It holds the single-account and multi-account templates, the AWS service icon styles, and the serverless web application and logical grouping patterns used in steps 4 and 5.

- Choose appropriate template (single/multi-account)
- Replace placeholder values with actual system information
- Validate basic XML structure

### 4. Add AWS Services

- Use official AWS service icons, copying the icon styles from `references/drawio-templates.md`
- Position services according to scope (global/regional/VPC)
- Ensure consistent icon sizing and alignment

### 5. Create Connections

- Add directional arrows with appropriate colors
- Include meaningful labels for protocols and data types
- Use dashed lines for return traffic
- Validate all source/target references

### 6. Validation Checklist

- [ ] All AWS services use official icons
- [ ] Service scope is correctly represented (global/regional/VPC)
- [ ] Global services (IAM, CloudFront, Route 53, CloudFront-scoped WAF) are inside the account but outside any region and VPC
- [ ] Regional services (S3, DynamoDB, non-VPC Lambda, API Gateway) are inside their region but outside VPC
- [ ] VPC services (EC2, RDS, ECS) are properly contained within VPC boundaries
- [ ] Data flow arrows show correct direction
- [ ] Return traffic is indicated with dashed/intermittent arrows
- [ ] Security boundaries are clearly marked
- [ ] Account boundaries are properly depicted
- [ ] Diagram title is descriptive and clear, positioned on top
- [ ] Logical grouping is shown with boxes and intermittent lines
- [ ] Color-coded relationships are used for complex multi-region scenarios
- [ ] The file opens in draw.io without errors
- [ ] All IDs are unique
- [ ] Proper parent-child relationships maintained
- [ ] Security zones are properly defined for threat analysis
- [ ] Data classification boundaries are indicated where applicable
- [ ] Trust boundaries are clearly marked for security review

## Error Prevention Guidelines

### 1. Common Mistakes to Avoid

- Placing services that cannot attach to a VPC (such as CloudFront, Route 53, S3 or DynamoDB) inside VPC boundaries
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

Generate complete draw.io XML that includes:

1. **Valid XML Structure**: A well-formed mxGraphModel that opens in draw.io
2. **Comprehensive Service Representation**: All relevant AWS services with official icons
3. **Clear Data Flow**: Directional arrows with labels for security analysis
4. **Proper Boundaries**: Account, region, VPC boundaries clearly marked for threat modeling
5. **Professional Formatting**: Consistent styling and layout following the standards above
6. **Complete Documentation**: Service descriptions and relationships with security context
7. **Editable Structure**: Valid parent-child relationships and unique IDs, so the diagram can be edited in draw.io
8. **Trust Boundaries**: Clearly defined security zones for threat modeling workflows

The generated diagram should open in draw.io without edits and represent a production-ready AWS architecture following all best practices and Well-Architected Framework principles.

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
