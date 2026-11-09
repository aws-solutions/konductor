# CREATE workflow: Steps 4-10

Read this when a new estimate's context is gathered and confirmed (CREATE Step 3 in `references/create-context.md`). It runs from the first pricing calls through the final report. Steps 1-3 are in `references/create-context.md`; the REVIEW workflow is in `references/review-workflow.md`; after Step 10, apply the Quality Gate in `SKILL.md`.

## Step 4: AWS Pricing Research (FIRST MCP calls)

**NOW begin AWS Pricing MCP server usage:**

1. **USE get_pricing_service_codes()** to identify all available AWS services for pricing

2. **For each service in their solution:**

   ```
   USE get_pricing_service_attributes(service_code)
   USE get_pricing_attribute_values(service_code, [relevant_attributes])
   ```

3. **If they provided infrastructure code, analyze it to identify services:**

   ```
   USE analyze_cdk_project(project_path) # if CDK code provided
   USE analyze_terraform_project(project_path) # if Terraform code provided
   ```

If the pricing tools aren't available and you can't ask the user to add them (they said not to ask, or nobody is there to answer), use published list prices for the estimate's region. Say so at the top of the report and mark those figures unverified. Never invent a unit price you don't know: leave that line unpriced and say what would price it.

## Step 5: Architecture Validation for Cost Estimation

Analyze their solution to ensure complete and accurate cost estimation:

**Service Selection Review:**

- Validate each service choice for cost estimation accuracy
- Identify more cost-effective alternatives where appropriate
- Ensure all cost-impacting services are included

**Missing Cost Component Identification:**

- Security services costs (WAF, GuardDuty, Config)
- Monitoring and logging costs (CloudWatch, X-Ray)
- Backup and disaster recovery costs
- Data transfer and networking costs
- Operational overhead costs

**Cost Optimization Opportunities:**

- Right-sizing recommendations for accurate pricing
- Reserved Instance and Savings Plan eligibility
- Storage tier optimization for cost efficiency
- Network architecture cost efficiency

## Step 6: Multi-Scenario Cost Analysis

**USE get_pricing()** with detailed filters for each service:

**Create Three Detailed Scenarios:**

1. **Baseline Scenario** - Standard configuration meeting minimum requirements

   ```
   USE get_pricing(service_code, region, baseline_filters, output_options)
   ```

2. **Optimized Scenario** - Cost-optimized with Reserved Instances and right-sizing

   ```
   USE get_pricing(service_code, region, optimized_filters, output_options)
   ```

3. **High-Availability Scenario** - Multi-AZ, enhanced monitoring, disaster recovery

   ```
   USE get_pricing(service_code, region, ha_filters, output_options)
   ```

**Include All Cost Components:**

- Compute costs (EC2, Lambda, Fargate)
- Storage costs (S3, EBS, EFS) with lifecycle policies
- Database costs (RDS, DynamoDB) with backup and maintenance
- Network costs (data transfer, load balancers, VPN)
- Security costs (WAF, certificates, compliance tools)
- Operational costs (monitoring, logging, automation)
- Data processing costs (ETL, analytics, ML services)

## Step 7: Growth and Scaling Analysis

Model costs for different growth scenarios:

- **Current state** - Immediate deployment needs
- **2x growth** - Double the current requirements
- **5x growth** - Five times current scale
- **10x growth** - Ten times current scale

Give each growth level its own total in one table. Leaving out 2x or 10x is a gap, even when a launch only calls for one multiplier.

Include scaling considerations:

- Auto-scaling cost implications
- Reserved Instance strategy evolution
- Architecture changes needed at scale
- Performance optimization requirements

## Step 8: Optimization Recommendations Development

Provide detailed optimization strategies:

**Immediate Optimizations (0-30 days):**

- Right-sizing opportunities
- Storage tier optimizations
- Reserved Instance quick wins
- Unused resource elimination

**Medium-term Optimizations (1-6 months):**

- Savings Plans implementation
- Architecture refactoring opportunities
- Automation and operational efficiency
- Performance optimization initiatives

**Long-term Strategic Optimizations (6+ months):**

- Multi-year Reserved Instance commitments
- Architecture modernization (serverless, containers)
- Advanced cost management strategies
- Enterprise discount program eligibility

## Step 9: Professional Report Format Selection

**BEFORE generating the final report, ask for format preference** unless the user already named a format or a file to write; then use it and go to Step 10:

"## Cost Analysis Complete - Report Generation

I've completed your complete AWS cost analysis including:
**Architecture validation** with optimization recommendations
**Three detailed scenarios** (baseline, optimized, high-availability)
**Growth modeling** for 2x, 5x, and 10x scaling
**Reserved Instance analysis** with savings projections
**Complete cost breakdown** by service and category
**Strategic optimization roadmap** with immediate and long-term recommendations

### Choose Your Report Format

• **PDF** - Professional presentation format perfect for customer meetings and executive reviews
• **HTML** - Interactive web format with expandable sections and cost calculators
• **CSV** - Spreadsheet format for detailed analysis and budget planning
• **Markdown** - Documentation format for technical teams and version control
• **💬 Terminal Display** - Show complete results directly in our chat
• **📁 Multiple Formats** - Generate PDF + CSV + Markdown for complete documentation

**What format would you prefer for your complete cost analysis report?**

I'll also include:

- Executive summary with key findings
- Detailed service-by-service breakdown
- Visual cost comparisons between scenarios
- Implementation timeline with cost phases
- ROI analysis and business case support
- Complete cost analysis documentation"

## Step 10: Complete Cost Analysis Report Creation

**Compile all pricing data from AWS Pricing MCP server into detailed analysis:**

1. **Summarize all pricing data collected:**
   - Service-by-service cost breakdown with unit pricing from get_pricing() calls
   - Multiple scenario comparisons (baseline, optimized, high-availability)
   - Growth projections and scaling cost implications
   - Reserved Instance and Savings Plan analysis

2. **Create detailed cost analysis report using collected pricing data:**
   - Executive summary with total costs for each scenario
   - Detailed service breakdown with calculations
   - Optimization recommendations based on pricing analysis
   - Implementation timeline with cost phases
   - Assumptions and exclusions clearly documented

3. **Format the analysis according to user preference:**
   - **PDF format**: Structure as professional presentation
   - **HTML format**: Create interactive cost breakdown
   - **CSV format**: Organize as spreadsheet with detailed calculations
   - **Markdown format**: Structure as technical documentation
   - **Terminal display**: Present complete results in chat
