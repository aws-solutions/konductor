# Change rules for search index work

These rules apply to production changes that move Search Gateway to a new physical index.

1. Every execution step has one named owner.
2. Every execution step has a check that another person can run and understand from the recorded evidence.
3. Every step that changes production has a stated way back or a reason that a way back is not possible.
4. The release record names the physical index before and after the change, the operator, the observed service measures, and the final decision.
5. The change is complete only after the alias, indexer watermark, service measures, and release evidence have been checked. The release manager marks the record complete after the on-call engineer signs off.
6. A change during a known traffic peak requires the release manager to record the reason and the expected safeguards.
