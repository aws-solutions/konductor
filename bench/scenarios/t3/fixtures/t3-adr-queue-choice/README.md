# Event Processing Queue Selection

## Project Overview
This project involves selecting an appropriate AWS managed queue service for Acme Analytics' event processing pipeline. The system needs to handle mobile app user activity logs with specific throughput, latency, and cost requirements.

## Problem Statement
Our mobile applications generate approximately 11 million events per day that need to be processed and stored in our data warehouse. We need a reliable, scalable, and cost-effective queue service to buffer these events during processing.

## Current State
- Events are sent from mobile SDKs via HTTP/REST
- Current prototype uses SQS Standard queues
- Experiencing occasional duplicate processing
- Need to formalize production architecture

## Requirements
See `requirements.md` for detailed functional and non-functional requirements.

## Options Under Consideration
1. **Amazon SQS Standard Queue**
2. **Amazon SQS FIFO Queue** 
3. **Amazon Kinesis Data Streams**

## Decision Process
We will:
1. Analyze each option against requirements
2. Calculate cost projections for each option
3. Evaluate operational complexity
4. Make recommendation based on total cost of ownership

## Key Constraints
- Monthly budget: $900 for queue infrastructure
- Peak throughput: 400 events/second
- Event size: Average 90KB
- Must be AWS managed service

## Files in this Directory
- `requirements.md` - System requirements and constraints
- `technical-design.md` - Technical analysis and capacity planning
- `pricing-guide.md` - Pricing overview and models
- `pricing-data.json` - Detailed pricing data in JSON format
- `operations-runbook.md` - Operational procedures and monitoring
- `cost-calculator.js` - Sample cost calculation script

## How to Proceed
1. Review all documentation thoroughly
2. Understand the pricing model for each service
3. Calculate costs based on actual message volume and size
4. Consider throughput limits and operational requirements
5. Document your decision in an ADR (Architecture Decision Record)

## Decision Deliverable
Create a file `docs/adr/0001-queue.md` with your decision. The file must contain a fenced code block with info string `decision` containing JSON with the following structure:

```json
{
  "chosen": "option_id",
  "options": ["option_id1", "option_id2", "option_id3"],
  "limits": {
    "limit_name": {
      "limit": 123,
      "value": 456
    }
  },
  "monthly_cost_usd": 789.00
}
```

## Important Notes
- Pay attention to how messages are billed (chunk-based vs. request-based)
- Consider both average and peak throughput requirements
- Verify all calculations match the pricing data provided
- The solution must be operational within the stated budget

## Getting Help
- AWS Documentation: https://docs.aws.amazon.com/
- AWS Pricing Calculator: https://calculator.aws/
- Internal Slack: #architecture-reviews