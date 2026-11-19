# Zero-downtime product search re-index

**Status:** Proposed for production approval  
**Owner:** Search Platform  
**Author:** Mira Chen  
**Last updated:** 2025-03-03

## 1. Summary

This proposal replaces the current product search generation with a new concrete index while the catalog search endpoint continues serving requests. The replacement index will use the approved mapping in the release bundle, receive a copy of the current documents, and become live through one atomic alias update. Readers will continue to use `products-read`; no client release is required.

The change is intentionally operationally small. We will build one generation in the existing cluster, copy the documents with the search service bulk task, switch the alias, and remove the previous generation. The writer deployment will be updated for the new generation as part of the same run. We expect ordinary search traffic to see no errors and only a short increase in cluster resource use.

The Search Platform team owns the run. Catalog Platform supplies the release mapping and the writer image. Reliability Engineering will watch the existing search dashboard. The runbook linked in the change ticket contains the commands with the generation name substituted before execution.

## 2. Motivation

### 2.1 Why now

The current generation has accumulated fields from several catalog releases and is close to the shard-size range we use for predictable refresh and recovery. The March catalog release also adds locale-aware attributes and removes two obsolete fields. Those mapping changes cannot be applied safely to the existing concrete index.

The October mapping incident showed that a mapping release needs a replacement generation rather than an in-place edit. This design keeps the stable alias and gives the new mapping a separate lifecycle. It also avoids taking a maintenance window during the catalog team's March merchandising event, when search traffic is high and an outage would affect browse and purchase conversion.

### 2.2 Goals and non-goals

The goals are to keep `GET /v2/search/products` available, publish the March mapping, keep the old generation available until the new one is serving, and finish within the temporary capacity allowance. The operation must be repeatable for the rehearsal and the production run.

This proposal does not change analyzers outside the March mapping, introduce a second search cluster, or change the gateway contract. Relevance tuning is a separate project. The catalog database remains the source of truth for product records, while the search writer remains responsible for the denormalized search document.

## 3. Detailed design

### 3.1 Generation naming and preparation

The operator creates `products-2025-03` with one primary and one replica per the existing shard convention. The creation request includes the March mapping, index settings, refresh interval, and the normal index lifecycle labels. The index starts closed to application traffic because no alias points at it yet.

Before the copy, the operator checks that the concrete name is unused, the mapping hash in the release bundle matches the change ticket, and the new index reports the expected shard and replica allocation. The writer image is built with the concrete generation in its configuration. Search requests still use `products-read`, so creating and filling the generation does not change the client path.

The copy uses the cluster bulk task with a batch size of 1,000 documents and a 20 MiB/s request cap. The operator records the task ID in the change ticket and watches the task and cluster health dashboards. Refresh is disabled during the main copy and restored before validation. The task is allowed to run on all three data nodes so the work completes inside the run window.

### 3.2 Populate and enable the writer

At the start of the run, the operator starts the bulk copy from the current concrete index into `products-2025-03`. The current writer continues to send product updates to the old concrete index while the copy runs. Once the bulk task reports completion, the operator deploys writer version 2025.03, which sends every new product event to the new generation. This order prevents two writer versions from competing during the copy and keeps the application path unchanged.

The writer deployment is considered ready after it has consumed its normal startup batch and its bulk requests have succeeded. The old writer is then scaled down. Since the copy has finished before the new writer is enabled, the new generation contains the complete pre-run catalog and the new writer handles all subsequent changes. The operator records the old and new concrete names in the change ticket.

### 3.3 Copy duration and run window

The source generation is expected to contain about 568 GiB of primary data and the same amount of replica data after allocation. At the configured 20 MiB/s copy cap, the document transfer itself is estimated at about five hours. We add one hour for task setup, shard allocation, refresh restoration, and operator checks, giving a six-hour production window.

The estimate uses 18,000 product writes per hour as the background activity rate. That rate is the daytime planning number used by the Search Platform team, and it gives enough allowance for small bulk retries without making the window unnecessarily long. The catalog event stream retains changes during the run, so the writer deployment can start with its normal startup batch after the copy.

The rehearsal uses the same batch size and cap on a representative snapshot. We will record the task's elapsed time, bulk failure count, and peak search latency. If the rehearsal takes more than eight hours, the operator will lower the batch size before production to reduce contention rather than changing the copy plan.

### 3.4 Alias cutover and cleanup

After the writer is ready, the operator sends one alias request that removes `products-read` from the old generation and adds it to `products-2025-03`. The request is atomic from the reader's perspective. The operator then runs the smoke query and checks that the new concrete name appears in the search response metadata.

The old writer is not restarted after this point. The previous generation remains present for 15 minutes while the operator observes search errors, then the operator deletes it to return the cluster to its normal footprint. The change ticket records the alias response and the deletion response. If the smoke query returns an error before deletion, the operator pauses cleanup and lets the service team investigate the new generation.

This is the complete cutover sequence. The new generation becomes the only alias target, and cleanup is part of the same approved run so that an operator does not need a second change window.

### 3.5 Client and writer compatibility

The gateway and clients continue to use the alias name and need no configuration change. The writer deployment receives the concrete index through its existing environment setting. The deployment manifest permits the Search Platform service account to create the generation, write documents, update the alias, and delete the previous generation.

The March mapping preserves the fields consumed by the result formatter. New locale fields are optional in the response and are ignored by older clients. The release bundle includes a mapping hash and the writer image digest so the operator can compare the built artifacts with the change ticket before starting.

### 3.6 Throttling and operator visibility

The copy runs with the bulk request cap and the default cluster recovery settings. Reliability watches p95 latency, p99 latency, bulk failures, and writer lag in the existing dashboard. Search traffic remains the priority; if latency rises, the operator lowers the copy cap in the task settings and continues the run.

The operator adds the old and new index names as dashboard filters before starting. The task ID, index names, start time, and final alias response are written into the change record. A rehearsal run is required before the production change, and the same operator owns both runs so the procedure stays familiar.

## 4. Capacity and validation

### 4.1 Storage calculation

The new generation's primary and replica data are forecast at 568 GiB each across the cluster, or about 379 GiB per data node after allocation. Each data node has a 750 GiB volume. The new generation therefore needs 379 GiB plus a 60 GiB operating buffer, leaving more than 300 GiB of apparent room on each node during the copy.

The old generation is removed during cleanup, so it does not need to be included in the steady-state calculation. The temporary capacity line in the budget covers the copy task and the short overlap. No storage expansion is planned. After deletion, the new generation will have the same shard layout as the current one and the cluster will return to its existing monthly cost.

The operator checks volume utilization before starting and stops if any node is above 80 percent. The 60 GiB buffer covers ordinary merge activity, and the existing snapshot policy provides recovery protection. This keeps the run within the approved budget without adding nodes.

### 4.2 Cluster load and availability

Copying is deliberately capped at 20 MiB/s and uses batches small enough to keep request memory bounded. The new index is refreshed only after the main transfer, which reduces refresh work. Replicas are allowed to allocate normally so the new generation is searchable with its normal fault tolerance before cutover.

The run proceeds only when all nodes are green and there is no unrelated maintenance. Reliability checks latency every 15 minutes against the service dashboard. A temporary latency increase is acceptable if it returns to baseline after the cap is lowered; an operator can pause the bulk task without affecting the old reader path.

Search requests do not wait for the copy task. The alias remains on the current generation until the final cutover request, so a slow copy does not itself create an endpoint outage. The budget permits one rehearsal and one production run on the current cluster.

### 4.3 New-index checks

When the bulk task reports `completed`, the operator restores refresh and waits for the new index to become green. The operator then runs one exact-title query, one locale-filtered query, and one category query. Each must return at least one result and HTTP 200. The response metadata must identify `products-2025-03` before the alias request is sent.

These checks cover index readability, the new mapping, and the alias target. A document count is not used as a gate because updates can arrive while the copy task is finishing and exact counts would make a healthy run appear inconsistent. The control query dashboard remains available to the on-call team after the cutover for normal observation.

### 4.4 Post-cutover observation

For the first 15 minutes, the operator watches the error rate, latency, bulk failures, and writer lag. The search owner confirms one request from each supported locale and records the concrete index from the response. The old generation is deleted only after those checks have passed.

The next morning, Reliability reviews the daily search dashboard and the writer lag graph. The change ticket is closed with the task duration, peak latency, final alias target, and cleanup result. Any relevance issue is routed to the catalog release owner rather than handled by changing the live mapping.

## 5. Rollout plan

### 5.1 Success criteria

The change is successful when the search endpoint continues returning HTTP 200 during the run, the smoke queries return results from the new generation, and the old generation is removed. The operator records the alias response and task completion in the change ticket. The run is considered complete when the dashboard is green and the change owner signs off.

No client-side release is required. The writer deployment is healthy, the new generation is the alias target, and the cluster returns to its normal node count and monthly cost. The same criteria apply to the rehearsal and production run, with the production sign-off coming from Search Platform.

### 5.2 Rehearsal

The rehearsal runs against a representative snapshot in the existing cluster during a low-traffic period. The operator exercises generation creation, the bulk task, writer deployment, alias update, smoke queries, and cleanup. The task duration and peak latency are added to the change ticket.

The rehearsal uses the production mapping and writer image. It does not change client configuration. If a command differs between rehearsal and production, the operator updates the runbook and repeats that part before the production window.

### 5.3 Production steps

The change owner announces the start, confirms the cluster is green, and creates the generation. The owner starts the copy, watches the task and service dashboard, then deploys the new writer after the copy completes. The owner runs the checks, performs the alias update, observes the service, and deletes the previous generation.

The owner records timestamps at each boundary. The catalog team remains available for product-event questions, and Reliability remains available for latency or cluster-health questions. The change is closed after the next dashboard review.

## 6. Drawbacks and risks

### 6.1 Resource contention

The bulk task competes with query and writer traffic for disk, CPU, and network. The cap and refresh setting reduce that effect but also make the copy longer. A longer task increases the time that operators need to watch the cluster and may collide with a catalog event peak.

### 6.2 Operational coordination

The plan requires the index creator, writer deployer, and alias operator to use the same generation name. A typo in a concrete name would be caught by the preflight name check, but an operator still needs to read the change record carefully. The rehearsal reduces command familiarity risk.

### 6.3 Mapping behavior

The new mapping changes locale fields and removes obsolete fields. A successful index operation does not prove that ranking is unchanged for every query. The control queries and next-day dashboard review give the release owner a way to notice a relevance regression without adding a client change to this project.

## 7. Alternatives considered

### 7.1 In-place mapping update

An in-place update would avoid temporary storage and a copy task, but it cannot change existing field mappings safely. It would also tie the release to the incident pattern from October. We rejected it.

### 7.2 Maintenance window

A maintenance window would make the procedure shorter and remove the alias coordination, but it would make search unavailable during a high-value catalog event. The availability target and client behavior do not support that trade-off. We rejected it.

### 7.3 Separate temporary cluster

A separate cluster would isolate copy load and give a clean fallback boundary. The budget excludes a second cluster, and operating two clusters would add network, access, and monitoring work for a one-generation change. We rejected it for this release.

## 8. Unresolved questions

### 8.1 Event stream timing

Catalog Platform should confirm the expected startup batch time for writer version 2025.03 before the rehearsal. The writer image uses the existing consumer configuration, and the release owner will record the observed startup time.

### 8.2 Rehearsal date

Reliability and Search Platform still need to select the low-traffic rehearsal window. The production window should not overlap the merchandising event or routine cluster maintenance.

### 8.3 Release sign-off

The catalog release owner must confirm the March mapping hash and writer image digest in the change ticket. Search Platform will provide the final alias response and cleanup timestamp for the release record.
