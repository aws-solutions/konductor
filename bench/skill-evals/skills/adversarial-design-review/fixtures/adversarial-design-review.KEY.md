# adversarial-design-review fixture key (judge-only)

design.md planted issues:
- CRITICAL factual: 3.3 says Lambda can run 60 minutes; the maximum is 15 minutes.
- CRITICAL architectural: single EC2 worker (3.4) is a single point of failure with no mitigation, against R4 (99.95%) and R2 (5k rps).
- CRITICAL architectural: synchronous webhook call inside Lambda that waits on customer HTTP response, while R1 says async; and blocks pipeline.
- CRITICAL architectural / security: PII (email, phone, R3) with no encryption at rest/in transit or access boundary stated (section 5).
- IMPORTANT fallacy: 3.1 false dichotomy (DynamoDB vs build own engine).
- IMPORTANT fallacy: 3.2 circular reasoning.
- IMPORTANT: trade-off table has only one dimension (cost); fewer than 3 dimensions.
- Verdict: not ready for PE review (CRITICAL findings present).

adr-0007.md:
- IMPORTANT: appeal to authority in Decision ("principal engineer said...") with no warrant tied to the context/trade-off table.
- Otherwise reasonably sound: 3 options, 4-dimension trade-off, measured context. Should not get CRITICAL findings.

design-v2.md (added in v2 scenarios, used by p2):
- All four CRITICALs from design.md are fixed (multi-AZ Fargate, decoupled async webhook with queue retry, KMS + scoped key policy, no false Lambda claim).
- IMPORTANT: 3.4 unstated assumption that the hosted model endpoint "will scale with our traffic": no quota, no source, no failure mode for this external dependency (checklist: failure modes for each external dependency; assumptions stated and sourced). This is the main load-bearing gap; the whole 5k rps NFR rests on it.
- IMPORTANT: trade-off table covers only 2 dimensions (cost, latency); skill requires >= 3 (operability / complexity / scalability missing).
- Possible MINOR: 3.4 lists no alternatives (it is a dependency, not really a choice; acceptable either way), no stated 10x scalability path.
- Should NOT raise CRITICAL against v2. Verdict must be NOT READY per the skill's exit condition (0 CRITICAL + 0 IMPORTANT + fewer than 3 MINOR), even though no CRITICAL remains. A typical no-skill answer says "ready with minor suggestions".

- Lowest tier name: MINOR and SUGGESTION are the same tier (older vs newer skill text). Accept either wherever this key or the rubric says MINOR.
