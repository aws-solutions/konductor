# Notification Fan-out Service

## Summary

Orders, shipments, and refunds each need to notify customers by email, SMS, and push. Today each producer calls the
three providers directly, so a provider outage blocks checkout. This design adds a fan-out service between producers
and providers.

## Architecture

1. Producers call `POST /notify` on the fan-out service (API Gateway + Lambda).
2. The Lambda writes the request to a DynamoDB table `notifications` (PK = customerId).
3. The same Lambda then calls the email, SMS, and push providers in sequence and waits for all three.
4. When all three succeed it returns 200 to the producer.
5. If a provider fails, the Lambda retries it in a loop until it succeeds.

## Data

| Field      | Type   | Notes                            |
| ---------- | ------ | -------------------------------- |
| customerId | string | partition key                    |
| channel    | string | email / sms / push               |
| payload    | map    | full message, including phone no |
| status     | string | PENDING / SENT                   |

Provider API keys are stored as Lambda environment variables.

## Scale

Peak load is 4,000 notifications per second during sales events. The Lambda timeout is 15 minutes to leave room for
retries.

## Operations

We will look at CloudWatch logs if customers complain.

## Rollout

Switch all producers over on the same day.
