# design-quality-check fixture key (judge only)

docs/design/notify.md, expected score 1/5:
- missing_section: no Architecture Decision Records section although decisions are made (Kafka, SPI, rules engine). IMPORTANT.
- yagni_violation: pluggable transport SPI (SMS, push, fax) and rules engine + DSL not required by any requirement; plan steps 2-3. IMPORTANT.
- circular_reasoning: "We chose Kafka ... because Kafka is the best choice". IMPORTANT.
- unsupported_claims: "p99 delivery latency to under 20ms" and "cuts notification cost by 45%" with no evidence. IMPORTANT.
- filler_phrases: "It is worth noting that", "In order to". MINOR.
- NOT a hedge: "Lambda cold starts typically add 100-500ms" (accurate range; skill pitfall says do not flag).
3+ IMPORTANT and a missing section -> 1.

docs/design/clean.md, expected 5/5 (or 4/5 at worst): complete sections, claims cite a source, ADR present, brief.

docs/design/minor.md, expected 3/5: all sections present, no IMPORTANT issues; MINOR filler/hedge count is 5 ("Needless to say", "It should be noted that", "As mentioned above", "In order to", "somewhat"), which is >3 MINOR -> 3. The "under a minute ... 41 seconds" claim is measured, not unsupported.
