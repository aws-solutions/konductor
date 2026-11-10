# Image Moderation Pipeline: Design (revision 2)

## 1. Requirements

- R1: Customers upload images through the public API. Moderation results must be returned asynchronously through a webhook.
- R2: The pipeline must sustain 5,000 uploads per second at peak with p99 end-to-end latency under 2 seconds.
- R3: Uploader profile data (email address, phone number) is stored with each upload record.
- R4: Availability target is 99.95% monthly.

## 2. Architecture

The API (API Gateway, Cognito-authorized) writes each upload to the S3 bucket `moderation-uploads` (SSE-KMS, public access blocked) and enqueues a message on SQS. An ECS Fargate service of moderation workers, spread across three Availability Zones and scaled on queue depth (minimum 6 tasks), polls the queue, calls the hosted moderation model endpoint, and writes results to DynamoDB. Uploader email and phone are stored in a separate DynamoDB table encrypted with a customer managed KMS key; only the profile service role can decrypt it.

Webhook delivery is decoupled: a result event goes to a second SQS queue, and a Lambda consumer posts to the customer webhook with a 5-second timeout. Failed deliveries are retried with exponential backoff by SQS redrive (up to 24 hours) and then land in a dead-letter queue.

## 3. Decisions

### 3.1 Storage: DynamoDB

Options considered: DynamoDB on-demand, Aurora PostgreSQL Serverless v2, and a self-managed Cassandra cluster. We chose DynamoDB because the access pattern is a single-key lookup by upload ID and on-demand mode absorbs the 5,000 writes/second peak without capacity planning.

### 3.2 Caching: none at launch

Options considered: ElastiCache Redis, DynamoDB Accelerator (DAX), and no cache. Results are read once by the webhook consumer, so a cache would not get repeat hits. We will revisit if a read API is added.

### 3.3 Workers: ECS Fargate across three AZs

Options considered: EC2 Auto Scaling group, ECS Fargate, and Lambda. Fargate avoids instance patching; Lambda was rejected because model calls hold a GPU-backed connection pool that does not survive cold starts well. Losing one AZ leaves four of six tasks, which load testing showed handles 5,200 uploads/second.

### 3.4 Moderation model

The workers call the hosted moderation model endpoint, which will scale with our traffic.

## 4. Trade-offs

| Decision | Cost | p99 latency |
|----------|------|-------------|
| DynamoDB on-demand | about $1,900/month at peak volume | under 10 ms |
| No cache | $0 | n/a |
| Fargate x6 minimum | about $1,100/month | adds no queueing at 5k rps |

## 5. Security

Cognito authorizes API callers. S3 and both DynamoDB tables are encrypted at rest with KMS; all service traffic uses TLS 1.2. The profile table key policy limits decrypt to the profile service role.
