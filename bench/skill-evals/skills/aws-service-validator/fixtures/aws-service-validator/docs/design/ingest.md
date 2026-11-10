# Clickstream ingest: design

## Service choices
1. Events arrive through Amazon API Gateway REST API. API Gateway REST APIs have a maximum integration timeout of 29 seconds by default.
2. A Lambda function validates each batch. Lambda functions can run for up to 60 minutes, so long batches are not a concern.
3. Lambda synchronous invocation payloads can be up to 6 MB.
4. Valid events are written to DynamoDB. DynamoDB items can be up to 4 MB, so we store the raw event inline.
5. Amazon S3 provides strong read-after-write consistency for PUTs of new objects and overwrites.
6. Aggregation runs in Step Functions Standard workflows, which can run for up to one year.
7. DynamoDB on-demand tables are charged per read and write request rather than provisioned capacity.
8. We deploy to us-east-1 and eu-west-1; every service above is available in both regions.
