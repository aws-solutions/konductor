# Review: product search reindex plan

**Verdict: No-go for the Monday window.** The plan has a sensible sequence and names owners, inputs, checks, and retention in most sections. It cannot start as written because one required owner is away, the build and comparison refer to different physical indexes, one required input has no producing step, and the live switch does not provide an executable recovery action. The release evidence also lacks a clear completion decision, and the relevance gate is subjective rather than reproducible.

The team should first make the physical index name consistent with the reserved name, identify how the synonym bundle is produced and recorded, assign the rehearsal to an available owner, and write the exact alias rollback command and trigger. The relevance comparison should use the existing top-20 and facet-count contract with a stated pass threshold. Closeout should state which checks allow the release manager to mark the migration complete.

## Findings

- **3.2 — High:** “Make sure the results look good” is not a check another reviewer can run. Use the versioned fixture and record a pass/fail result against the 98% top-20 coverage and facet-count comparison, with the response-time evidence.
- **3.3 — High:** The plan creates `catalog_search_v3`, while the architecture and settings reserve `catalog-search-2025-03`. Rename the target to the canonical name and record that same physical name in the release evidence.
- **3.4 — High:** The step requires `synonym-bundle-2025-02`, but no earlier step produces it and the plan does not identify its source or approval. Add a producing/input step and record the bundle version before loading.
- **3.5 — High:** The comparison names `catalog-search-2025-03`, even though the preceding build creates `catalog_search_v3`. Align the comparison with the same physical name that was built, preferably by using the canonical name throughout.
- **3.6 — Medium:** Priya Nair is the owner during her March 3–7 leave. Reassign the rehearsal to an available owner and keep the handoff responsibilities explicit.
- **3.7 — Critical:** The way-back text does not say how to restore service if the all-traffic switch causes errors or bad results. Record the previous index, the rollback alias operation, the trigger thresholds, and the person authorized to abort or roll back.
- **4.1 — Medium:** The closeout list does not establish when the whole migration is complete. Add completion criteria and release-manager sign-off covering the alias target, indexer watermark, service measures, comparison evidence, and observation record.

```json
[
  {
    "location": "3.2",
    "severity": "high",
    "issue": "The result-quality step has no reproducible pass/fail check, so a relevance regression could be accepted by judgment alone.",
    "fix": "Run the versioned relevance fixture and record a pass/fail result against the 98% top-20 and facet-count threshold."
  },
  {
    "location": "3.3",
    "severity": "high",
    "issue": "The step creates catalog_search_v3 instead of the canonical catalog-search-2025-03 name used by the architecture and settings.",
    "fix": "Rename the target to the canonical physical name and use it consistently in the release evidence."
  },
  {
    "location": "3.4",
    "severity": "high",
    "issue": "The synonym input has no producing step or identified source, so the load cannot be completed from the plan's earlier outputs.",
    "fix": "Add the source or a step that produces and approves synonym-bundle-2025-02 before loading."
  },
  {
    "location": "3.5",
    "severity": "high",
    "issue": "The comparison targets catalog-search-2025-03 while the build step creates catalog_search_v3.",
    "fix": "Align the comparison with the same physical name that was built, using the canonical name throughout."
  },
  {
    "location": "3.6",
    "severity": "medium",
    "issue": "Priya Nair owns the rehearsal while the roster puts her on leave for the proposed week.",
    "fix": "Reassign the rehearsal to an available owner and record the handoff."
  },
  {
    "location": "3.7",
    "severity": "critical",
    "issue": "The all-traffic switch has no executable rollback if production behavior degrades.",
    "fix": "Record the previous index, rollback alias operation, trigger thresholds, and authorized operator."
  },
  {
    "location": "4.1",
    "severity": "medium",
    "issue": "The closeout step does not define the checks and sign-off that establish the whole migration is complete.",
    "fix": "Add completion criteria and release-manager sign-off for the alias, watermark, service measures, and evidence."
  }
]
```
