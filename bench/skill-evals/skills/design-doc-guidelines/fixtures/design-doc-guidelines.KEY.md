# Key: design-doc-guidelines fixture (docs/design/rate-limiter.md)
- Problem section is at line 41, not in the first 10 lines; doc opens with a config table (implementation detail first).
- Overview: AI slop ("In today's fast-paced world", "it's important to note", "robust, scalable, and maintainable", Moreover/Furthermore/Additionally stacked, "leverages", "seamlessly").
- Unexpanded acronyms in overview: WAL, LRU, TTL, API GW.
- How It Works: regex and bash script (implementation detail in design section), ASCII diagram instead of Mermaid, diagram after prose, diagram arrow nonsense (bottom line).
- Decision Requested: "Approve Feature 1, Feature 2 and Feature 3" (feature-listing, not user outcome).
- No Solution Overview; Plan "Build it." (no phased task table).
notes-feature-flags.md (v2): the SDK caches flags for 60 s and polls every 30 s, which contradicts the "< 30 s" goal
(worst case is about 60-90 s before a change is seen). A strong doc applies the skill's Technical Accuracy rule: it flags
or resolves the contradiction (for example lowers the cache TTL, or restates the goal) instead of repeating both claims.
Boundary-crossing flows that need a threat entry: admin UI -> API (who may flip prod flags), SDK -> API poll, audit
event -> S3. rate-limiter.md diagram: the bottom connector line ties Client straight to Redis, which does not match the
runtime flow (Diagram Accuracy).
