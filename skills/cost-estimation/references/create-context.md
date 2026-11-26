# Cost estimation: CREATE context gathering

Read this when the user wants a new estimate: they ask what an architecture will cost, give a design with no estimate yet, or picked CREATE at the path choice in `SKILL.md`. It covers Steps 1-3. Make no pricing calls here; when Step 3 confirms you have enough detail, open `references/create-analysis.md` for Steps 4-10.

## CREATE WORKFLOW - Complete New Cost Analysis

### Step 1: Path Selection and Setup

If the request already asked for a new estimate, start here without waiting. Otherwise wait for the user to pick CREATE.

Respond with: "Perfect! I'll guide you through creating a complete AWS cost analysis. Let me understand your solution requirements first before we dive into pricing research."

### Step 2: Complete Context Gathering

**DO NOT make any MCP calls yet. Focus entirely on understanding their solution.**

If the user already shared the design, requirements, or load figures, read them and go to Step 3 instead of sending this request. Otherwise provide this detailed context gathering request:

"## Solution Context Required

I need to understand your AWS solution completely before researching pricing. Please provide your project details using any of these methods:

### Architecture & Requirements

**Upload or Reference:**
• **PDF architectural diagrams** - I'll analyze service components and data flows
• **Requirements documents** - RFPs, technical specifications, project briefs, SOWs
• **Infrastructure as Code** - CDK, Terraform, CloudFormation templates
• **Existing estimates** - Spreadsheets, previous cost analyses for comparison

### Business Context (Critical for Accurate Estimation)

**Tell me about:**
• **Business use case** - What specific problem does this solve?
• **Target users** - Who will use this system and how?
• **Expected scale** - Users, transactions, data volume (daily/monthly/yearly)
• **Growth projections** - Expected scaling over 1-3 years
• **Budget constraints** - Any cost limitations or targets?
• **Timeline** - When does this need to be deployed?

### Technical Requirements (Essential for Service Selection)

**Specify:**
• **Performance needs** - Response times, throughput, concurrent users
• **Availability requirements** - SLA targets, downtime tolerance, multi-AZ needs
• **Security & compliance** - Industry standards (HIPAA, PCI, SOC), data sensitivity
• **Integration points** - External systems, APIs, data sources
• **Operational requirements** - Monitoring, backup, disaster recovery needs

### Architecture Preferences

**Include:**
• **Preferred AWS services** - Any specific services you want to use or avoid
• **Architecture patterns** - Microservices, serverless, containerized, traditional
• **Data strategy** - Storage types, processing patterns, analytics needs
• **Deployment model** - Single region, multi-region, hybrid cloud

### Direct Description Option

**Alternatively, describe your solution in detail:**

Example: "I need a cost estimate for a three-tier web application serving 10,000 concurrent users. The solution requires high availability across two AZs, includes a React frontend hosted on CloudFront, Node.js API backend on ECS Fargate, and PostgreSQL database on RDS. Expected traffic is 1 million page views per month with 500GB monthly data transfer. Must comply with SOC 2 requirements."

**What information can you provide to get started? The more detail you share, the more accurate and detailed your cost analysis will be.**"

### Step 3: Solution Understanding and Clarification

**Still NO MCP calls. Focus on understanding and asking clarifying questions.**

Once they provide context:

1. **Acknowledge** what they've shared
2. **Ask clarifying questions** for any missing critical details:
   - Usage patterns and peak loads
   - Data retention and backup requirements
   - Specific compliance or security needs
   - Regional deployment preferences
   - Integration complexity
3. **Summarize** your understanding of their solution
4. **Confirm** you have enough detail to proceed with pricing research
