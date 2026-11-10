# Partner Delivery Webhooks

## Summary

Forty logistics partners want delivery-status updates pushed to their HTTPS endpoints instead of polling
`GET /shipments/{id}` every minute. Polling is 70% of our API traffic (about 2,800 requests/s at peak). This design
adds outbound webhooks for the `shipment.status_changed` event.

## Requirements

- Deliver each status change to every subscribed partner within 60 s, at least once.
- Partners register one HTTPS endpoint each and a shared secret; payloads are signed with HMAC-SHA256.
- A partner endpoint that is down must not delay delivery to other partners.
- Peak volume: 600 status changes/s, fanned out to an average of 3 partners each (about 1,800 deliveries/s).

## Delivery mechanism (open)

We have not picked the delivery mechanism. The three candidates the team considers viable:

| Option | Sketch | What the team likes | What worries the team |
| ------ | ------ | ------------------- | --------------------- |
| A. SNS HTTPS subscriptions | One SNS topic; one HTTPS subscription per partner endpoint | No code to run; per-subscription retry policy | Partners must confirm the subscription; custom HMAC signing is not built in |
| B. EventBridge API destinations | Custom bus; one rule + API destination per partner | Built-in retries and DLQ per target; per-destination rate limit | Per-account rule and destination quotas as partners grow; connection auth models may not fit HMAC |
| C. SQS + webhook worker | Status events to SQS; a Lambda worker signs and POSTs | Full control over signing, backoff and per-partner circuit breaking | We own the worker, its retries and its on-call |

## Data

Partner registrations live in DynamoDB table `partners` (PK = partnerId) with `endpointUrl` and `secret` stored as
plain attributes.

## Operations

Failed deliveries are logged. Partners can email support if they stop receiving updates.

## Rollout

Enable webhooks for all 40 partners at once and turn off polling the following week.
