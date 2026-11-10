# Session log: getting the DynamoDB stream consumer tests running locally (2026-11-03)

Goal: run `npm run test:stream` against LocalStack instead of real AWS.

Attempt 1: `docker run -p 4566:4566 localstack/localstack` then `npm run test:stream`.
Result: tests hang. The consumer polls `ListStreams` on the real endpoint because AWS_ENDPOINT_URL was not set.

Attempt 2: `export AWS_ENDPOINT_URL=http://localhost:4566` and rerun.
Result: `ResourceNotFoundException: Requested resource not found: Table: orders-local`. The table is not created automatically.

Attempt 3: created the table with streams enabled:
  aws --endpoint-url http://localhost:4566 dynamodb create-table --table-name orders-local \
    --attribute-definitions AttributeName=pk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES
Then `npm run test:stream`.
Result: tests run but 2 of 9 fail with `ExpiredIteratorException`. The default AWS_REGION in the shell was eu-west-1 while the test config hardcodes us-east-1, so LocalStack created the table in a different region than the consumer read from.

Attempt 4: `export AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test`, deleted and recreated the table, reran.
Result: 9 of 9 pass. Confirmed with `aws --endpoint-url http://localhost:4566 dynamodbstreams list-streams --region us-east-1` showing one stream for orders-local.
