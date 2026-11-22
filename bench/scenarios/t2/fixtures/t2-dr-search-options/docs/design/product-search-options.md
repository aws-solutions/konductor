# Product search options

**Status:** Proposed
**Author:** Storefront Platform
**Date:** 2025-03-05
**Decision owner:** Storefront Platform lead

## 1. Summary

The storefront needs a search path that can handle the next two years of catalogue growth without repeating the connection saturation seen during the November campaign. This document compares three options: retain the PostgreSQL title index and `LIKE` query, use Northstar Search as a managed service, or run a search cluster owned by Storefront Platform.

The recommendation is Northstar Search on the standard-2 tier. It gives the team a separate scaling boundary, keeps the application integration small, and has the clearest path to the spring market launch. The team will retain PostgreSQL as the authority for price, stock, and product state. The search index will hold searchable title and facet fields only.

The decision is intended to cover the current four storefront languages and the planned Swedish storefront. This document describes the decision, the scorecard, an initial rollout, and the operating model. Detailed API changes will follow after approval.

## 2. Context and decision drivers

### 2.1 Current path

The Catalogue API receives a locale, an optional department, an optional facet, and a title query. PostgreSQL currently serves title-prefix lookups through a B-tree index. Three read replicas share the work with other catalogue reads. Search results include identifiers and display fields, while price and stock are read from the authoritative tables.

The current path is simple and has low data movement. It also shares connection capacity with the rest of the catalogue workload. In the November campaign, search traffic reached 640 requests per second and p95 reached 1.8 seconds. The service target is 250 ms at p95, 500 ms at p99, and 700 ms at the request timeout. Campaign traffic is expected to reach 1,300 requests per second in two years.

### 2.2 Scope and assumptions

This comparison covers shopper-facing catalogue search. Administrative reporting and export screens remain on their existing queries. A selected search system must support title lookup, locale and department filters, one or more facets, a maximum of 48 results, and a 64-character query. It must allow the API to read prices and stock from PostgreSQL at response time.

The catalogue has 18.4 million active products and 49.6 million localized title rows today. The planning number is 40 million products and 108 million localized title rows in 24 months. The comparison uses the current query volume and the campaign peak as operating inputs. It assumes that a search service can be reached from the same region as the application.

### 2.3 Priority order

The team ranked the decision drivers before looking at vendor features. Search relevance for the storefront languages is first because an apparently fast result that misses a product is not useful. Total operating cost is second because the approved search envelope is limited. Latency at campaign peak is third. The fourth driver is the amount of new operational work for a five-person platform team with one shared overnight rotation.

The design also values a small application change, a reversible cutover, and clear ownership. These are tie-breakers rather than separate decision drivers. Availability and freshness remain service requirements for every option.

## 3. Options and evaluation

### 3.1 Common evaluation scale

Each option receives a score from one to five for relevance, latency, cost, and operations. One means the option needs substantial additional work to meet the stated need; five means it meets the need with little additional work. Scores are based on the current catalogue, expected traffic, and the rollout described later in this document.

The database option uses the existing PostgreSQL read replicas. The managed option uses Northstar standard-2 with two replicas and a client-side integration. The self-run option uses three data nodes and three replicas across the existing production zones. All three options keep the Catalogue API as the only public search endpoint.

### 3.2 Scorecard and decision weights

The final score uses the following weights. The managed service is the highest-scoring choice at 4.00, compared with 3.65 for PostgreSQL and 3.30 for the self-run cluster.

| Criterion | Weight | PostgreSQL index | Managed service | Self-run cluster |
| --- | ---: | ---: | ---: | ---: |
| Relevance | 20% | 3 | 3 | 4 |
| Campaign latency | 35% | 2 | 5 | 4 |
| Operating simplicity | 30% | 5 | 4 | 1 |
| Cost | 15% | 5 | 3 | 2 |
| **Weighted total** | **100%** | **3.65** | **4.00** | **3.30** |

The high latency weight reflects the customer-visible impact of slow search during a campaign. Operating simplicity also receives a large weight because the Storefront Platform rotation supports checkout, catalogue writes, and storefront releases. The scores make Northstar the practical choice without requiring a separate decision gate.

### 3.3 Cost comparison

The annual cost model includes infrastructure and the engineering time expected for integration, routine tuning, and alert response. The team uses a fully loaded engineering cost of 145,000 USD per year. The managed service is estimated at 29,190 USD per year, including 0.15 engineering FTE. The PostgreSQL option is 19,900 USD per year, including 0.10 FTE for tuning and replica capacity.

The self-run cluster is estimated at 37,200 USD per year for three data nodes, three replicas, snapshots, storage, and monitoring. The infrastructure estimate includes a small contingency for storage growth. No additional engineering FTE is assigned because the cluster will use the same dashboards and deployment tooling as the rest of the platform.

| Option | Infrastructure/year | Engineering FTE | Total/year |
| --- | ---: | ---: | ---: |
| PostgreSQL index | 5,400 | 0.10 | 19,900 |
| Managed search | 7,440 | 0.15 | 29,190 |
| Self-run cluster | 37,200 | 0.00 | 37,200 |

The managed option stays below the 36,000 USD operating envelope. Its premium over the database option buys independent query capacity and vendor maintenance. The self-run option is excluded from the recommendation because its infrastructure alone is above the envelope and it needs a larger platform commitment.

### 3.4 Latency and capacity

Northstar's published standard-2 result for the relevant title-prefix query is 115 ms at p95 and 190 ms at p99. The benchmark used two replicas, a result limit of 24, and 40 concurrent requests from the same region. The managed option receives a latency score of five because its p95 is below half the 250 ms target.

The application client will set a 600 ms deadline and use a short connection pool. At the campaign peak, the service can add a replica without changing the Catalogue API. The team will watch p95, p99, timeout rate, and vendor quota consumption during the first launch. PostgreSQL remains available for product detail reads, so search load will not block price and stock reads.

PostgreSQL receives a latency score of two because the November incident showed that its shared connection pool can saturate at campaign volume. The self-run cluster receives a four because three data nodes provide a separate capacity boundary, though it requires capacity planning.

### 3.5 Relevance and storefront behavior

The evaluation treats relevance as title tokenization, prefix matching, facet filtering, and stable ordering. Northstar will store the original title, a normalized title field, locale, department, and facet values. The API will continue to pass locale and department filters and will cap the result set at 48.

The first relevance trial will use 200 representative queries from the English and French storefronts. The team will compare result order with the current database output and review the top ten results with the Catalogue team. Exact title matches receive a small boost, while facet filters remain hard filters. The trial does not change the display title or the price and stock lookup.

### 3.6 Migration and rollout

Migration is rated low effort because the API change is limited to a repository adapter and a feature flag. The plan is to create the Northstar index, deploy the adapter dark, send a small percentage of reads to it, and switch the flag after the launch dashboard is green. The old PostgreSQL path remains available as a fallback during the release window.

The catalogue event consumer will write changed products to Northstar. A one-time export of the active catalogue will populate the initial index before the first read is enabled. The release owner will check document counts, sample titles, and API latency. The target date is two weeks after approval, with one engineer from Storefront Platform and one engineer from Catalogue.

### 3.7 PostgreSQL baseline

The baseline keeps the existing B-tree and adds one read replica for campaign windows. Its benchmark uses a substring search over title and description, represented by `LIKE '%' || :term || '%'`, because this is the more demanding database search shape. The benchmark scans the current 18.4 million product rows at 180 requests per second and records p95 of 460 ms before the extra replica.

This option has no vendor bill and no index format migration. Its relevance behavior stays close to today's behavior, and the repository change is minimal. The extra replica helps with campaign traffic but does not change the query plan for the benchmarked search. The scorecard therefore gives it high cost and simplicity scores but a low campaign latency score.

### 3.8 Managed search service

Northstar provides the index, replicas, snapshots, and node replacement. The application owns the client adapter, field mapping, event consumer, and read selection. The service's standard-2 tier has two replicas in the proposed configuration. The team will set a quota alert before enabling production traffic and will keep the feature flag in the Catalogue API.

The index mapping will include product id, localized display title, normalized title, locale, department, brand, and availability flag. Product price will not be copied into the index. The event consumer will update a document after a product event is acknowledged. Search results will be joined to PostgreSQL rows for authoritative price and stock values.

The managed service earns the recommendation because it separates search capacity from the relational workload and minimizes new on-call work. The vendor handles service patching and replica replacement. The Storefront Platform team remains responsible for the integration and for deciding when a read target is healthy.

### 3.9 Self-run search cluster

The self-run choice uses three data nodes and three replicas in the production zones. Storefront Platform would own upgrades, shard allocation, snapshots, capacity alarms, and recovery drills. The cluster would use the same event stream and document fields as the managed option.

This option offers the most control over mappings and query behavior. It also introduces a stateful production system for a team that already supports the Catalogue API, checkout integrations, and the release platform. The infrastructure estimate does not include a new application dependency, so the initial integration is similar to Northstar. The scorecard gives it a low operations score because of the ownership burden.

## 4. Recommendation

### 4.1 Selected option

Adopt Northstar Search standard-2 for the storefront catalogue path. The choice separates campaign search traffic from PostgreSQL, stays within the approved operating envelope, and keeps the client change behind a feature flag. PostgreSQL remains the fallback and the source for current price and stock.

The decision depends on the vendor tier remaining available in the application region and on the first launch meeting the 250 ms p95 target. If those conditions are not met in the rollout, the feature flag will remain disabled while the team adjusts capacity or returns to the baseline.

### 4.2 Ownership boundaries

Storefront Platform owns the adapter, event consumer, index mapping, alerts, and release flag. The Catalogue team owns event contents and the nightly snapshot. Finance owns the monthly service purchase. The vendor owns the availability of the Northstar control plane and data nodes under the service agreement.

The primary rotation will receive alerts for client errors, latency, event lag, and document count changes. A short operating note will describe how to disable the managed read path and return to PostgreSQL. The note will be reviewed during the launch readiness meeting.

## 5. Delivery plan

### 5.1 Build sequence

In week one, the team will create the adapter, define the Northstar mapping, configure the event consumer, and add dashboards. In week two, it will run the export, validate sample documents, and exercise the feature flag in a non-production environment. The launch window will begin with internal storefront traffic and then move to five percent of production requests.

The Catalogue team will provide the export and event stream. The application team will compare response errors, latency, result counts, and price or stock joins. The release owner will record the final read target and the feature flag state in the release note.

### 5.2 Acceptance measures

The release can proceed when the service reaches 99.95% availability in the test window, p95 is at or below 250 ms, p99 is at or below 500 ms, and no price or stock mismatch is found in the sampled joins. The event consumer must stay within the ten-minute title freshness target. The team will also compare the top ten results for the English and French trial queries.

The campaign readiness test will replay 620 requests per second for fifteen minutes and then a 900 requests-per-second step. The test will record API and vendor latency separately. A second run will exercise the feature flag while the old PostgreSQL path is still available.

## 6. Operations and support

### 6.1 Dashboards and alerts

The dashboard will show request rate, p50, p95, p99, timeout rate, HTTP status, vendor quota, event lag, document count, and PostgreSQL join latency. Alerts will cover the service target, a growing event lag, and a fall in successful result responses. The client deadline is shorter than the API timeout so it can return a controlled error before the request budget is exhausted.

The team will review dashboards daily during the first week and then in the weekly storefront operations meeting. Vendor support will be contacted for a service-side incident after the application checks have ruled out an invalid mapping or event consumer failure.

### 6.2 Fallback and release control

The Catalogue API retains a feature flag that selects PostgreSQL or Northstar. The flag is scoped to storefront and locale so that a release owner can reduce exposure. A rollback changes the flag and does not modify catalogue data. The old read path will be kept through the first campaign after launch.

If Northstar returns an error, the adapter records the error and the API returns the normal search error response. Price and stock reads remain in PostgreSQL. The release owner will decide whether to restore Northstar after the dashboard has been stable for one hour.

## 7. Open decisions

### 7.1 Launch approval

The Storefront Platform lead approves the service purchase and the two-week delivery plan. The Catalogue lead approves the event payload and snapshot export. The Reliability lead attends the campaign readiness test. No change is required to the storefront response contract.

### 7.2 Follow-up work

After launch, the team will tune result ordering from shopper click data, review the service tier after the first campaign, and remove the extra PostgreSQL replica if the shared database remains within its normal connection range. The team will add more localized trial queries as the Swedish storefront moves through content review.
