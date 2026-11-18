# Cost estimation: REVIEW workflow

Read this when the user asks to review, check, or correct an existing estimate, shares one, or picked REVIEW at the path choice in `SKILL.md`. After Step 8, apply the Quality Gate in `SKILL.md`.

## REVIEW WORKFLOW - Existing Cost Estimate Enhancement

### Step 1: Path Selection

If the request already asked for a review or included the estimate, start here without waiting. Otherwise wait for the user to pick REVIEW.

Respond with: "Excellent! I'll help you analyze and enhance your existing cost estimate. Let me review your current materials first before validating against current AWS pricing."

### Step 2: Complete Existing Estimate Gathering

**DO NOT make any MCP calls yet. Focus on understanding their current estimate.**

If the user already shared the estimate, read it and go to Step 3 instead of sending this request. Otherwise ask:

"## Current Cost Estimate Review

I need to understand your existing cost estimate thoroughly before validating pricing and identifying improvements. Please share your materials using any of these methods:

### Existing Cost Analysis Materials

**Upload or Reference:**
• **PDF cost analysis reports** - Previous estimates, customer presentations
• **Word documents** - Cost proposals, architectural documents with pricing
• **Excel/CSV spreadsheets** - Detailed pricing calculations and breakdowns
• **PowerPoint presentations** - Customer-facing cost presentations

### Supporting Architecture Information

**Include if available:**
• **Architecture diagrams** - Current solution design (I'll analyze these to understand services)
• **Requirements documents** - Original specifications used for estimation
• **Infrastructure code** - CDK, Terraform, CloudFormation templates (I'll analyze to identify services)
• **Previous customer feedback** - Questions or concerns about costs

### Current Estimate Context

**Tell me about:**
• **When was this estimate created?** - Age affects pricing accuracy
• **What assumptions were used?** - Usage patterns, growth projections, service selections
• **What's the current status?** - Approved, under review, needs updates
• **Any specific concerns?** - Areas where you suspect costs might be off
• **Customer feedback received?** - Questions about pricing or alternatives

### Direct Information Sharing

**You can also:**
• **Copy/paste** your current cost breakdown directly
• **Describe** the architecture and estimated costs verbally
• **List** specific services and their estimated monthly costs
• **Share** any constraints or optimization goals

**What existing cost estimate materials can you share for analysis?**"

### Step 3: Current Estimate Analysis and Understanding

**Still NO MCP calls. Focus on understanding their existing estimate.**

Once they provide materials:

1. **Analyze** their current cost structure and assumptions
2. **Identify** the services and configurations they've estimated
3. **Note** any obvious gaps or areas of concern
4. **Ask clarifying questions** about:
   - Specific usage assumptions
   - Regional deployment details
   - Service configuration choices
   - Timeline and growth expectations
5. **Summarize** your understanding of their current estimate

### Step 4: Current Pricing Validation (FIRST MCP calls)

**NOW begin pricing calls through the AWS MCP server**, as `SKILL.md` describes under Available Tools:

1. **Load `aws-billing-and-cost-management`** and its pricing lookup reference, and confirm each service in their estimate has a Price List service code.

2. **For each service in their existing estimate**, call `DescribeServices` and `GetAttributeValues` for the filters, then `GetProducts` for the current unit price.

If the AWS MCP server isn't available, or a pricing call is denied and you can't ask the user to fix it (they said not to ask, or nobody is there to answer), use published list prices for the estimate's region. Say so at the top of the report and mark those figures unverified. Never invent a unit price you don't know: leave that line unpriced and say what would price it.

### Step 5: Complete Validation and Gap Analysis

**Pricing Accuracy Assessment:**

- Recompute every existing line from its stated usage and unit prices, not only the missing ones. Mark each line correct, wrong (with the corrected figure and why), or unverifiable. Keep the estimate's usage figures unless the context contradicts them
- Compare their estimates against current AWS pricing
- Identify significant pricing discrepancies
- Check for outdated pricing models or discontinued services
- Validate regional pricing assumptions

**Architecture Completeness Review:**

- Identify missing services commonly overlooked:
  - Data transfer costs
  - Monitoring and logging
  - Backup and disaster recovery
  - Security services
  - Operational overhead
- Add a missing service only when the architecture or context shows it. Label anything you infer (a NAT gateway, WAF, backups) as an assumption on its own line, so the reader can drop it
- Check for unrealistic usage assumptions, and for usage that grows over the budget period (accumulating storage, rising traffic) but is priced flat
- Validate service sizing and configuration choices

**Optimization Opportunity Identification:**

- Reserved Instance and Savings Plan potential
- Right-sizing opportunities
- Alternative service recommendations
- Storage tier optimization possibilities
- Network architecture improvements

### Step 6: Enhancement Recommendations Development

**Immediate Corrections (Pricing Updates):**

- Current AWS pricing for all services
- Corrected regional pricing where applicable
- Updated service configurations and options
- Fixed calculation errors or omissions

**Cost Optimization Opportunities:**

- **Short-term (0-90 days):**
  - Reserved Instance quick wins
  - Right-sizing low-hanging fruit
  - Storage tier optimizations
  - Unused resource elimination

- **Medium-term (3-12 months):**
  - Complete Reserved Instance strategy
  - Architecture optimization projects
  - Savings Plans implementation
  - Performance optimization initiatives

- **Long-term (12+ months):**
  - Multi-year commitment strategies
  - Architecture modernization opportunities
  - Enterprise discount program eligibility
  - Strategic cost management implementation

**Presentation and Documentation Improvements:**

- Enhanced executive summary
- Better cost visualization and comparisons
- Clearer assumptions and exclusions
- Professional formatting and structure
- Risk assessment and mitigation strategies

### Step 7: Enhanced Report Format Selection

**BEFORE generating the enhanced report, ask for format preference** unless the user already named a format or a file to write; then use it and go to Step 8:

"## Cost Estimate Analysis Complete - Enhanced Report Generation

I've completed a detailed analysis of your existing cost estimate and identified several key findings:

### Analysis Summary

**Pricing Validation** - Checked all services against current AWS rates
**Gap Analysis** - Identified missing components and services
**Optimization Opportunities** - Found [X] potential cost reduction strategies
**Architecture Review** - Validated service selections and configurations
**Accuracy Assessment** - Corrected calculation errors and outdated assumptions
**Enhancement Recommendations** - Developed immediate and strategic improvements

### Choose Your Enhanced Report Format

• **PDF** - Professional presentation with executive summary and detailed analysis
• **HTML** - Interactive format with before/after comparisons and optimization calculators
• **CSV** - Detailed spreadsheet with original vs. updated pricing analysis
• **Markdown** - Technical documentation format with change tracking
• **💬 Terminal Display** - Show complete analysis results directly in chat
• **📁 Complete Package** - PDF presentation + CSV analysis + Markdown documentation

**What format would you prefer for your enhanced cost analysis?**

Your enhanced report will include:

- Side-by-side comparison (original vs. updated estimates)
- Detailed explanation of all changes and corrections
- Prioritized optimization roadmap with savings projections
- Risk assessment and implementation considerations
- Professional executive summary for stakeholder presentations"

### Step 8: Enhanced Cost Analysis Report Creation

**Compile enhanced analysis using the Price List API data:**

1. **Create comparison analysis:**
   - Original estimate vs. current AWS pricing from the `GetProducts` calls
   - One row per original line with its original and corrected cost and the reason, including lines that were right; mark added lines as new
   - Identify pricing discrepancies and corrections needed
   - Calculate potential savings from optimization opportunities
   - Document all changes and improvements made

2. **Generate enhanced cost analysis:**
   - Updated service-by-service breakdown with current pricing
   - Corrected assumptions and validated calculations
   - The pricing source (Price List API or published list prices) and a confidence range for the corrected total
   - Optimization levers with estimated monthly savings, grouped by horizon (0-30 days, 1-6 months, 6+ months)
   - Risk assessment and implementation considerations
   - Professional executive summary for stakeholders

3. **Format enhanced analysis according to user preference:**
   - **PDF format**: Professional presentation with before/after comparisons
   - **HTML format**: Interactive format with optimization calculators
   - **CSV format**: Detailed spreadsheet with original vs. updated analysis
   - **Markdown format**: Technical documentation with change tracking
   - **Terminal display**: Show complete analysis results in chat
