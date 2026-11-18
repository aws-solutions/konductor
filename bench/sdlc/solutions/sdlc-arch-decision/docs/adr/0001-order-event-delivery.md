# ADR 0001: order event delivery to partners

Status: accepted

## Context

Partners need order events (placed, paid, shipped, cancelled) in their own systems. The constraints are in
`docs/context.md`: about 1.8 million events a day, peak 120 a second, freshness within 60 s at p95, no event lost
and 24 h of replay in order, 2 engineers with no on-call for self-run brokers, and 1,500 USD a month.
`data/partners.csv` lists 400 partners; 120 of them (30%) cannot host an HTTPS endpoint.

## Criteria

Ranked from most to least important. A hard criterion rules an option out when it fails.

| rank | criterion | from | kind |
|---|---|---|---|
| 1 | reaches every partner, including the 120 without an endpoint | partners.csv | hard |
| 2 | freshness within 60 s at p95 | context | hard |
| 3 | no loss, 24 h replay in order per order | context | hard |
| 4 | runs with 2 engineers and no self-run broker | context | hard |
| 5 | cost under 1,500 USD a month | context | soft |
| 6 | partner onboarding effort | context | soft |

## Options

### Option 1: webhooks only

We POST each event to the partner's endpoint from a durable outbox, retrying for 24 h. Strongest point: lowest
latency and no polling load. It would win if every partner could host an endpoint.

### Option 2: pull feed

Partners call `GET /events?after=<cursor>` every 10 s (the current rate limit). Strongest point: one mechanism for
every partner, and replay comes from the cursor. It would lose if poll load grew past what the feed can serve.

### Option 3: managed queue per partner

A cloud queue per partner, read with the partner's own credentials. Strongest point: the cloud handles retention
and scaling. It would win if most partners already ran on that cloud and could take credentials from us.

### Option 4: email digest

A summary every 15 minutes. Strongest point: no partner integration at all. It would win only if freshness could
be 15 minutes.

## Trade-offs

| criterion | webhooks only | pull feed | queue per partner | email digest |
|---|---|---|---|---|
| every partner (120 without endpoint) | fails: 120 partners left out | meets: outbound HTTPS only | meets, if the partner can use the cloud SDK | meets |
| freshness 60 s | meets: seconds | meets: at most 10 s plus processing | meets: seconds | fails: 15 min |
| no loss, 24 h replay | meets with an outbox and 24 h of retries | meets: events kept 7 days, cursor replay | meets: queue retention | fails: no replay |
| 2 engineers, no broker | meets: outbox and retry worker | meets: one endpoint | partly: 400 queues and IAM setups to run | meets |
| cost under 1,500 USD | meets | meets: 40 requests a second at full poll load | meets, about 400 USD | meets |
| onboarding | partner builds an endpoint | partner writes a poller | partner sets up cloud credentials | none |

Ruled out: webhooks only (criterion 1), email digest (criteria 2 and 3).

## Decision

Build the pull feed for every partner. Offer webhooks later as an optional push, driven from the same event log,
for the 280 partners that can host an endpoint and want lower latency.

## Consequences

- We keep an event log of at least 7 days and document cursor semantics.
- Poll load of up to 400 partners every 10 s, about 40 requests a second on the feed.
- Partners that want push wait for the second phase.

## Reversal and review

Dropping the feed later would break the 120 partners without an endpoint, so it is expensive: a migration for
each of them. Adding or removing webhooks on top is cheap, since both read the same log.
Revisit when fewer than 10% of partners lack an endpoint, or when feed load passes 200 requests a second.
