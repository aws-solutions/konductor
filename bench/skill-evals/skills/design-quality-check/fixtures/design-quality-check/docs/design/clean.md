# Password Reset Rate Limit

## Background

The password reset endpoint has no rate limit. Last month one IP sent 40,000 reset requests in an hour, which filled customers' inboxes and cost $310 in email fees (billing report, March 2026).

## Requirements

1. Limit reset requests to 5 per account per hour and 50 per IP per hour.
2. Return HTTP 429 with a Retry-After header when a limit is hit.

## Solution Overview

Add a fixed-window counter in the existing Redis cluster, keyed by account and by IP. The reset handler checks both counters before sending email.

## How It Works

See Figure 1 (docs/diagrams/reset-limit.png). The handler runs INCR on `reset:acct:<id>:<hour>` and `reset:ip:<ip>:<hour>` with a one-hour TTL, then rejects the request if either value exceeds its limit.

## Implementation Plan

1. Add the counter helper with unit tests.
2. Call it from the reset handler and return 429 with Retry-After.
3. Add a CloudWatch metric for rejected requests.

## Architecture Decision Records

### ADR-1: Fixed window instead of sliding window

A fixed window can allow up to 2x the limit across a window boundary. For a limit of 5 per hour that worst case is 10 emails, which is acceptable. A fixed window needs one key per window instead of a sorted set per account, so it is simpler to build and cheaper to store.
