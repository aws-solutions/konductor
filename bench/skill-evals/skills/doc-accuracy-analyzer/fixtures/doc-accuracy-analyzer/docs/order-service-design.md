# Order Service v2 Design

## 1. Overview

Order Service v2 replaces the legacy cron-driven order sync with an event-driven
pipeline. Most of the building blocks already exist, so the remaining work is
mostly configuration.

## 2. Current State

The current service handles 10,000 requests per second at peak, as shown by the
load test in `perf/results.csv`. Retry logic with exponential backoff is already
implemented in `src/retry.js` and is used by every outbound call.

## 3. Design

Authentication requires only configuration: `src/auth.js` already validates
JWTs against the identity provider, so we only need to set the issuer URL.

All database access goes through parameterized queries in `src/orderRepo.js`,
which rules out SQL injection.

Orders are stored as single DynamoDB items. The DynamoDB maximum item size is
400 KB, which comfortably fits our largest order (about 40 KB).

A single Lambda invocation can run for up to 15 minutes, so the nightly
reconciliation job fits in one invocation.

Using an outbox table with a stream consumer is the standard pattern that AWS
recommends for this problem, and it is well known that it guarantees
exactly-once delivery.

## 4. Rollout

Because nearly everything is built, rollout takes one sprint.
