# Product search reindex plan

**Owner:** Maya Chen, Search Foundations  
**Proposed window:** Monday, March 3, 2025, 09:00–12:00 local time  
**Reviewers:** Luis Romero, Hannah Brooks, Omar Haddad  
**Status:** ready for review

## 1. Purpose and outcome

This plan moves product search from the November physical index to a newly built index without changing the Search Gateway API. The work is deliberately divided into preparation, data loading, comparison, and traffic operations so that the team can observe the new data before customers depend on it.

The expected outcome is a current index with the same query behavior as today, fresher catalog data, and a release record that lets the team explain what happened. The team will retain the previous index during the observation period. We will use the Monday morning window because it gives the catalog team a full business day to prepare the export and leaves several days before the member promotion begins.

The plan assumes the catalog export is complete by 08:30, the managed search cluster has room for one additional physical index, and Search Gateway dashboards are available to all reviewers. If the export is late, the team will keep the current index and move the work to the next available window.

## 2. Roles, inputs, and operating boundaries

Maya coordinates the plan and owns the physical index preparation. Omar owns the catalog export and the bulk load. Priya owns relevance analysis and confirms that query behavior is suitable for release. Hannah is the Search Gateway on-call and watches the production measures during the traffic change. Luis records decisions, timing, and evidence in the release log.

The source of truth for index settings is `config/index-settings.yaml`. The plan uses the current six-primary-shard layout, two replicas, the standard tokenizer, and the catalog dictionary for synonyms. Bulk requests stay at or below 40 per second, with batches of no more than 1,000 documents. The expected overlap is seven days, subject to the budget and cluster health.

The public API remains unchanged. The change affects the physical index behind `catalog-search-live`, the indexer watermark, and the internal dashboards. No client release is needed. The team will not delete the previous index during this window.

## 3. Execution plan

### 3.1 Confirm the window and current settings

**Owner:** Maya Chen  
**Inputs:** `config/index-settings.yaml`, `data/traffic-calendar.csv`, cluster health dashboard  
**Work:** At 08:30, confirm that the cluster has capacity for a second physical index and that the current index has six primaries, two replicas, a one-second refresh interval, and the standard analyzer. Confirm that the Monday window is outside the listed promotion peak. Record the current physical index, alias target, document count, and indexer watermark in the release log.

**Done check:** Luis Romero reads the release log and compares each recorded setting with the configuration file and dashboard. The check is complete when the values agree and no bulk rejection alert is active.

**Way back:** If the values do not agree or the cluster is not healthy, do not create the new index. Keep `catalog-search-live` on its current target and reschedule.

### 3.2 Prepare the relevance comparison

**Owner:** Maya Chen  
**Inputs:** the catalog team's 200-query fixture, the current index, and the baseline captured with the last catalog export  
**Work:** Run the saved queries against the current index and capture the top 20 IDs, facet counts, response time, and request IDs. Compare the output with the approved baseline, then use the same query set after the new index is loaded. Review the differences by brand, category, typo, price, and availability so that the team can explain material changes. Make sure the results look good before the traffic change.

**Done check:** Priya records the query groups she reviewed and attaches the before-and-after captures to the release log. The team will discuss any differences that appear unusual.

**Way back:** No production setting changes in this step. If the fixture cannot run, retain the current index and stop the plan before loading data.

### 3.3 Create the physical index

**Owner:** Maya Chen  
**Inputs:** the approved settings, cluster capacity check, and catalog mapping from Omar Haddad  
**Work:** Create `catalog_search_v3` with six primary shards and two replicas. Apply the standard tokenizer, the catalog dictionary analyzer, the one-second refresh interval, and the document mapping. Record the creation request and resulting health state. Do not attach the alias yet.

**Done check:** Maya verifies that the physical index is green, has the expected shard and replica counts, and accepts a one-document mapping check. Luis records the physical name and health response.

**Way back:** If creation fails, leave the existing alias unchanged, remove only the incomplete physical index, and reschedule after the cluster issue is understood.

### 3.4 Load the catalog and synonyms

**Owner:** Omar Haddad  
**Inputs:** the catalog export at the recorded watermark, `synonym-bundle-2025-02.json`, and the batch limit in `config/index-settings.yaml`  
**Work:** Load the export in batches of 1,000 documents at no more than 40 bulk requests per second. Apply the synonym bundle before opening the index for comparison. Record the starting watermark, document count, rejected batches, and elapsed time. Pause the job if the rejected-batch count is nonzero or the cluster reports degraded health.

**Done check:** Omar compares the final document count and watermark with the export manifest, and Luis confirms that the rejected-batch count is zero. The new physical index remains detached from the live alias while the evidence is collected.

**Way back:** Pause or resume from the last recorded watermark. If the load cannot complete, keep the current alias target and leave the partial physical index detached.

### 3.5 Compare the loaded index

**Owner:** Maya Chen  
**Inputs:** the release log from Sections 3.2 and 3.4, the approved query fixture, and the loaded physical index `catalog-search-2025-03`  
**Work:** Run the saved query fixture against the loaded index and compare top-20 IDs, facet counts, empty-result behavior, response time, and request errors with the current-index capture. Check the mapping for `merchant_group` and confirm that the catalog export watermark is visible. Summarize differences for the release manager and attach the comparison output.

**Done check:** Priya signs the comparison summary when the query results are suitable for the planned traffic change and the index is healthy. Luis checks that the summary has a timestamp and both index names.

**Way back:** Do not attach the alias if the comparison is not acceptable. Keep the current index serving and return the loaded index to the catalog team for investigation.

### 3.6 Rehearse the traffic operation

**Owner:** Priya Nair  
**Inputs:** the alias operation notes, the previous and new physical names, the dashboard links, and the release record  
**Work:** Walk through the alias operation with Hannah and Luis. Confirm who will issue the control-plane request, who will watch gateway measures, where the previous target is recorded, and how the team will communicate during the window. Use the non-production alias to rehearse the command shape and evidence capture. Do not make a production alias change during the rehearsal.

**Done check:** Hannah can describe the observation dashboards and Luis has recorded the operation owner, the previous target, the proposed target, and the communication channel. The team marks the rehearsal complete in the release log.

**Way back:** This rehearsal does not change production. If any person or dashboard is unavailable, stop before the traffic operation.

### 3.7 Switch traffic to the new index

**Owner:** Hannah Brooks  
**Inputs:** the comparison summary, green cluster health, the release log, and the alias operation command  
**Work:** At the agreed point in the window, update `catalog-search-live` so all Search Gateway requests use the new physical index. Record the control-plane response and the time of the change. Watch error rate, p95 latency, empty-result rate, facet mismatch rate, and watermark age for 30 minutes. Luis records the measures at five-minute intervals.

**Done check:** The alias inspection shows the new target, the dashboards show traffic on the new target, and each watched measure is recorded in the release log for the observation period.

**Way back:** The team keeps the previous physical index during observation and will decide whether to continue after reviewing the dashboard readings.

### 3.8 Observe the new target

**Owner:** Hannah Brooks  
**Inputs:** the gateway dashboard, indexer watermark, release log, and support channel  
**Work:** Monitor the service measures for the rest of the window and notify the release manager of customer reports or unexpected changes in result shape. Compare the observed request rate with the traffic calendar and note any bulk-load activity that remains. Keep the indexer watermark visible while the team observes.

**Done check:** Hannah posts an observation note with the final error rate, p95 and p99 latency, empty-result rate, facet mismatch rate, watermark age, and support reports. Luis links the note from the release record.

**Way back:** If the dashboard or support channel shows a customer-impacting change, pause further migration work and keep the observation record open for the release manager.

## 4. Closeout

### 4.1 Record the release outcome

**Owner:** Luis Romero  
**Inputs:** the release log, settings comparison, bulk-load evidence, relevance comparison, alias inspection, and observation note  
**Work:** Bring the evidence together, announce the outcome in the release channel, and keep the previous physical index for seven days. Link the dashboard and comparison artifacts so that another engineer can reconstruct the change. Add follow-up work for any differences that the team accepts for later review.

**Done check:** The release record contains the owners, timestamps, physical index names, document count, watermark, comparison artifacts, and observation note. The team archives the packet after the announcement.

**Way back:** The previous index remains available during the seven-day retention period. Deletion is a separate change under the operating rules.

### 4.2 Retire the previous index

**Owner:** Maya Chen  
**Inputs:** the completed release record, seven days of stable operation, and a Search Gateway on-call approval  
**Work:** Confirm that no investigation or support case still needs the previous index. Request approval, then remove the old physical index and record the capacity change. Leave the alias on the new target.

**Done check:** The release manager links the approval and the cluster health check to the release record.

**Way back:** Index deletion is deferred if approval or stable-operation evidence is missing.

## 5. Risks and communications

The main operational risks are a slow bulk load, unexpected differences in facet counts, and a change in response latency under live traffic. Omar will pause bulk processing when the rejected-batch count rises. Priya will explain relevance differences in the comparison summary. Hannah will page the normal Search Gateway on-call if service measures cross the dashboard alerts. Luis will coordinate customer support communications and record decisions.

The Monday window is scheduled before the member promotion. The team will not combine this move with a client release, analyzer change, or shard-count change. Any request to alter those boundaries goes back through release management. The team expects the old physical index to remain available for the full overlap period and has included that overlap in the quarterly budget.

## 6. Sign-off

Maya owns the plan and asks the release manager to confirm the window. The Search Gateway on-call confirms dashboard access. The catalog data engineer confirms the export manifest. The relevance engineer confirms the comparison summary. The release manager records the final decision and links the evidence before the plan is archived.
