# Receipts service: load and context
- Region: us-east-1 only today. DR region eu-west-1 is being discussed.
- 1M requests/day average, peak 3x average between 08:00 and 10:00 UTC.
- Each request returns ~150 KB to the internet on average (images and JSON), served through CloudFront.
- S3 grows by 300 GB per month. Images older than 90 days are rarely read.
- Team expects 5x traffic within 18 months after the enterprise launch.
- Users: about 40,000 monthly active users.

## Architecture (from the approved design)
- CloudFront + S3 static site, API Gateway REST, Lambda `receipt-api` (512 MB, ~300 ms avg).
- DynamoDB on-demand table (200 GB), S3 image bucket (4 TB today).
- SQS queue + DLQ feeding an ECS Fargate `ocr-worker` service (2 tasks, 1 vCPU / 2 GB, always on).
- Aurora PostgreSQL, one db.r6g.large writer, single AZ today.
- CloudWatch Logs for all services (~150 GB ingested per month).
