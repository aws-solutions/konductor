# Search v2

## Problem

Search p99 latency is 2.3 s on the self-managed Elasticsearch 6.8 cluster; the cluster needs 2 engineer-days a month of
patching.

## Solution Overview

Move to Amazon OpenSearch Service and index via a stream consumer. _(See ADR-1)_ Indexing runs as a worker. _(See ADR-2)_

## Implementation Plan

| Phase | Work                       |
| ----- | -------------------------- |
| 1     | Provision domain, reindex  |
| 2     | Cut over reads             |

## Architecture Decision Records

### ADR-1: Managed OpenSearch Service over self-managed Elasticsearch

**Status:** Accepted

#### Context

The self-managed 6-node cluster costs 2 engineer-days/month in patching and has had 3 unplanned outages in 2025.

#### Decision

We will use Amazon OpenSearch Service because it removes cluster patching and gives managed blue/green upgrades.

#### Alternatives Considered

| Option                         | Pros                     | Cons                       | Why Not Chosen                                        |
| ------------------------------ | ------------------------ | -------------------------- | ----------------------------------------------------- |
| OpenSearch Service (chosen)    | Managed upgrades         | ~15% higher instance cost  | -                                                     |
| Self-managed Elasticsearch 8   | Full control, no premium | Keeps the patching burden  | Keeps 2 engineer-days/month of toil we want to remove |

#### Consequences

**Good:**

- Removes ~24 engineer-days/year of patching.

**Bad:**

- Instance cost rises ~15% (~$1,100/month).

**Neutral:**

- Runbooks move from Ansible to the OpenSearch console/API.

### ADR-2: Indexing worker

**Status:** Accepted

#### Context

Indexing must keep up with 1,200 document updates/s at peak; each update runs a 300-900 ms enrichment call. Some
backfill jobs run for 40 minutes.

#### Decision

We will run the indexer on ECS Fargate.
