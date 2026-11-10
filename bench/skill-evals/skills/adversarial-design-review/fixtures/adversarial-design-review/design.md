# Image Moderation Pipeline: Design

## 1. Requirements

- R1: Customers upload images through the public API. Moderation results must be returned asynchronously through a webhook.
- R2: The pipeline must sustain 5,000 uploads per second at peak with p99 end-to-end latency under 2 seconds.
- R3: Uploader profile data (email address, phone number) is stored with each upload record.
- R4: Availability target is 99.95% monthly.

## 2. Architecture

The API (API Gateway) writes each upload to an S3 bucket named `moderation-uploads` and enqueues a message on SQS. A single EC2 instance (`m6i.2xlarge`) polls the queue, calls the moderation model, and writes results plus the uploader profile to DynamoDB. A Lambda function then reads the result and calls the customer webhook synchronously, waiting for the customer's HTTP response before acknowledging.

## 3. Decisions

### 3.1 Storage: DynamoDB

We chose DynamoDB. The alternative would be to build our own storage engine on EBS volumes, which nobody wants to maintain, so DynamoDB is the only reasonable choice.

### 3.2 Caching: Redis

We use ElastiCache Redis in front of DynamoDB because Redis is the best cache for this pipeline. Redis is the best cache here because it is the cache we selected for its strengths.

### 3.3 Webhook delivery: Lambda

Webhook delivery runs in Lambda. Long customer endpoints are fine because a Lambda function can run for up to 60 minutes, so retries can happen inside a single invocation.

### 3.4 Compute: single EC2 worker

One worker keeps the system simple. The `m6i.2xlarge` instance has plenty of headroom.

## 4. Trade-offs

| Decision | Cost |
|----------|------|
| DynamoDB | Low at our volume |
| Redis | About $400/month |
| EC2 worker | About $280/month |

## 5. Security

The API uses API keys. Data is stored in S3 and DynamoDB.
