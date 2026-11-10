# Key: adr-generator fixture
payments.md: no ADR section. Correct output: new "## Architecture Decision Records" after "## Implementation Plan", ADR-1 (DynamoDB chosen),
>=2-row alternatives table with Why Not Chosen, Good/Bad/Neutral, cross-ref "_(See ADR-1)_" in Solution Overview (or the section where the decision is mentioned).
search.md: ADR-2 lacks Alternatives Considered and Consequences (Lambda would be the natural alternative: 15-min limit vs 40-min backfill).
A new ADR in search.md must be ADR-3. ADR-1 text must stay intact.
v2 note: payments.md had been overwritten at some point after authoring with a model-style "## Decision Records /
ADR-001 (Proposed)" section (output leaked back into the fixture). It was restored to the clean state this key
describes: no ADR section, data only in the Trade-offs notes. The team "has agreed", so Status should be Accepted.
search.md ADR-3 (OpenSearch Serverless): engineer has not signed off, so Status Proposed; serverless billing claims
(minimum OCU charges that do not scale to zero, feature differences from provisioned domains) must be verified or
flagged as unverified, not asserted.
