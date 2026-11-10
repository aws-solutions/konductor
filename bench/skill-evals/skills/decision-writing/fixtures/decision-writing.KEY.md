# Key: decision-writing fixture
0007-auth.md planted: vague quantifiers (recently, many teams, some concerns, often, significantly), passive voice ("it was decided", "was felt", "was determined"),
filler ("After careful consideration..."), straw-man alternatives (home-grown "terrible idea", Auth0 "insecure"), vague consequences, no Status, no Neutral consequences.
notes.md gives data to replace them.
v2 notes:
- p1: the decision should state a reason (p99 310 ms vs 1,450 ms against a 500 ms SLA; 3 Q2 2025 incidents). Auth0 must be
  described with its real strengths (rules engine, hosted login, SOC 2 Type II) and rejected on cost ($12,600 vs ~$8,250 per
  month). Home-grown: zero license cost, team knows it (4 of 6), rejected on SLA misses and incidents. Neutral: dual-write
  period ~3 weeks, runbooks/dashboards. Bad: 4 of 6 engineers have no Cognito experience. Cognito pricing/limits are AWS claims:
  either cite the notes as source or flag them for validation; no invented links.
- p2: Thrift has no data in the prompt; a strong record states its real strengths without inventing benchmark numbers.
  Dashboard 'rpc-latency' should be cited by name, not as a fabricated URL.
- p3: the PM's "significantly boost engagement" claim has no baseline; a strong UXDR replaces it with a measurable target or
  marks it unmeasured instead of repeating it.
