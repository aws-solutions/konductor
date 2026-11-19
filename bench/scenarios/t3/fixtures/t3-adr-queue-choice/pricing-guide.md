# AWS Queue Services Pricing Guide

## Overview
This document outlines the pricing models for AWS managed queue services in the us-east-1 region. All prices are in USD and are subject to change. Please verify current prices on the AWS Pricing Calculator before finalizing decisions.

## Pricing Models

### Amazon SQS (Simple Queue Service)
SQS charges based on the number of requests made to the service. Each 64KB chunk of a payload is billed as one request.

**Important Billing Concept**: 
- A "request" is an API call (SendMessage, ReceiveMessage, DeleteMessage)
- Messages larger than 64KB are split into multiple 64KB chunks
- Each chunk counts as one request for billing purposes

#### SQS Standard Queue Pricing
- **First 1 million requests/month**: $0.00 (free tier)
- **Additional requests**: $0.50 per million requests
- **Data transfer**: No additional charge for data in/out within AWS regions
- **Additional features**: No charge for standard features (visibility timeout, delay queues)

#### SQS FIFO Queue Pricing
- **First 1 million requests/month**: $0.00 (free tier)
- **Additional requests**: $0.45 per million requests
- **Data transfer**: No additional charge for data in/out within AWS regions
- **Additional features**: No charge for standard features

### Amazon Kinesis Data Streams Pricing
Kinesis uses a combination of provisioned capacity and data volume pricing.

#### Kinesis Pricing Components
1. **Shard Hours**: $0.02 per shard-hour
   - Each shard provides 1 MB/sec write capacity and 2 MB/sec read capacity
   - Billed per hour while the stream is active
   
2. **PUT Payload Units**: $0.014 per million units
   - Each PUT payload unit is 25KB
   - Messages larger than 25KB consume multiple units
   
3. **Data Retention**: $0.02 per GB-month for extended retention (beyond 24 hours)

## Example Calculations

### SQS Example
For a message of 90KB:
- Message size: 90KB = 1.41 chunks (rounds up to 2 chunks)
- Each API operation (send, receive, delete) processes 2 chunks
- Total: 6 requests per message lifecycle

### Kinesis Example
For a message of 90KB:
- Message size: 90KB = 3.6 PUT payload units (rounds up to 4 units)
- Each message consumes 4 PUT payload units

## Cost Optimization Tips

1. **Batch operations**: Use batch APIs where available to reduce request count
2. **Message size**: Consider compressing messages to reduce chunk count
3. **Shard sizing**: Right-size Kinesis shards to match actual throughput needs
4. **Retention period**: Use minimal retention where data archival isn't required

## Free Tier
All services include a free tier:
- SQS: 1 million requests/month
- Kinesis: 100 shard-hours/month

## Important Notes
- Prices are for us-east-1 region as of Q4 2024
- Data transfer between AWS services in the same region is typically free
- Additional charges may apply for cross-region transfer, extended features, or premium support
- Always use the AWS Pricing Calculator for final cost estimates

*Historical note: Previous pricing for SQS FIFO queues was $0.50 per million requests. The current $0.45 rate reflects AWS's October 2024 price reduction.*