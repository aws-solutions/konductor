# Rate Limiter v2

| Config key            | Default | Notes                      |
| --------------------- | ------- | -------------------------- |
| RL_BUCKET_SIZE        | 100     | tokens per bucket          |
| RL_REFILL_MS          | 1000    | refill interval            |
| RL_WAL_ENABLED        | true    | turn on the WAL            |
| RL_REDIS_URL          | none    | cluster endpoint           |
| RL_SHADOW_MODE        | false   | log-only mode              |
| RL_TENANT_OVERRIDES   | {}      | per-tenant JSON            |

## Overview

In today's fast-paced world, it's important to note that rate limiting is a crucial, robust, scalable, and maintainable
capability. Moreover, the new limiter leverages a token-bucket approach. Furthermore, it uses the WAL and an LRU and
TTLs. Additionally, it seamlessly integrates with the API GW via a Lambda authorizer.

## How It Works

The limiter is implemented as follows. Each request key is computed with this regex:

```
^tenant:(?<tenant>[a-z0-9-]{3,32}):route:(?<route>[A-Z]+ /[^ ]*)$
```

The deploy script:

```bash
for r in us-east-1 eu-west-1; do aws cloudformation deploy --region $r --template rl.yaml; done
```

Requests flow like this:

```
+--------+     +---------+     +-------+
| Client | --> | Limiter | --> | Redis |
+--------+     +---------+     +-------+
     \_______________________________/
```

## Problem

Customers get throttled at random. Last month tenant "acme" got 429s on 18% of requests during a sale even though it
was under its contract limit of 500 rps, because the current limiter counts per Lambda instance, not per tenant.
Support spent 40 hours on these tickets in March.

## Decision Requested

Approve Feature 1, Feature 2 and Feature 3.

## Plan

Build it.
