# Receipts service: system design

Single AWS account (`receipts-prod`, 111122223333), region us-east-1, production.

## Request path
1. Customers use a browser. Static assets come from an S3 bucket (`receipts-web`) through CloudFront.
2. CloudFront has AWS WAF attached.
3. API calls go from the browser to Amazon API Gateway (REST, HTTPS). Cognito user pool authorizes requests.
4. API Gateway invokes the `receipt-api` Lambda function.
5. `receipt-api` reads and writes the `Receipts` DynamoDB table and stores scanned images in the `receipts-images` S3 bucket.
6. `receipt-api` publishes a `ReceiptUploaded` event to an SQS queue. The `ocr-worker` service runs on ECS Fargate in private subnets of the `receipts-vpc` VPC, polls the queue, and writes OCR results to an Aurora PostgreSQL cluster in the same VPC's isolated subnets.
7. Fargate tasks reach S3 through a VPC gateway endpoint.

## Operations
- All Lambda and ECS logs go to CloudWatch Logs; alarms notify an SNS topic.
- Failed SQS messages move to a dead-letter queue.
