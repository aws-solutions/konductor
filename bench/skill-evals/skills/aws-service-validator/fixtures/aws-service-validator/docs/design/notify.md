# Order notifications: design

## Flow
1. Orders are written to a DynamoDB table. DynamoDB Streams supports filter patterns, so the stream itself only emits INSERT events and we never pay for MODIFY or REMOVE records.
2. A Lambda function reads the stream and publishes to an SNS FIFO topic so notifications keep order per customer.
3. The SNS FIFO topic delivers directly to customer email subscriptions and to an SQS FIFO queue for the audit service.
4. SQS FIFO queues handle up to 300 messages per second per API action without batching, or 3,000 with batching; high throughput mode raises this further.
5. Lambda scales instantly to any load, so Black Friday spikes need no planning.
6. Marketing emails go through Amazon SES. SES charges per message sent and receiving email is free.
7. Daily digest emails are triggered by EventBridge Scheduler, which is available in us-east-1.

## Region
us-east-1 only.
