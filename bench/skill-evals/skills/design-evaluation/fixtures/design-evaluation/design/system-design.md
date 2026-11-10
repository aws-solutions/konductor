# Report Export Service - System Design

Status: Ready for implementation handoff
Team: 2 engineers. Expected load: about 300 export requests per day, peak 5 per minute.

## Overview

Tenants request a CSV export of their monthly usage report. The service builds the
file asynchronously and emails the tenant admin a download link.

## Architecture

1. `POST /exports` (API Gateway -> `createExport` Lambda) writes an export job to the
   `Exports` DynamoDB table with status `QUEUED` and returns `202` with the job id.
2. A DynamoDB stream triggers the `buildExport` Lambda, which reads usage rows from the
   `Usage` table, writes the CSV to S3, sets status `READY`, and calls the third-party
   MailRelay HTTP API to send the email.
3. `GET /exports/{id}` returns job status and a pre-signed S3 URL when `READY`.

To be ready for future growth, the service runs active-active in three regions
(us-east-1, eu-west-1, ap-southeast-2) with DynamoDB global tables, and every job also
goes through a self-managed Kafka cluster (3 brokers on EC2) "so we can add consumers later".

## Failure handling

If `buildExport` throws, Lambda retries the stream batch. Nothing else is planned.
MailRelay has no SLA. The call has no timeout set and no retry or fallback.

## Observability

TBD.

## Testing

Unit tests for the CSV formatter. No plan for integration tests; the Lambdas call the
AWS SDK and MailRelay directly from the handler code, so we will test in the dev account.
