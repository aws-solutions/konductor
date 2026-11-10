# Key: delegation-protocol fixture (.claude/workflows/review.js)
- agent() #1 (list changed files, runs git) and #2 (reads files) need explicit agentType; omitting it is the CRITICAL defect.
- agent() #3 is pure synthesis over inlined data; omission is allowed only with an inline comment directly above explaining why.
v2 notes:
- p1: (a) threat model and (c) Smithy spec -> k-architect; (b) cost estimate -> k-architect (or k-tpm if justified);
  (d) handlers -> k-developer, spawned only after the (c) handoff file exists. (a)-(c) parallel (3 <= 4). Handoff files under
  .konductor/handoff/<agent>-<task>.md, <= 300 lines. The write agent in (d) needs an explicitly named worktree/tree.
  Post-implementation review (reviewer agent with backend-review) should follow (d).
- p2: six tasks but max 4 concurrent; src/router/index.ts must be owned by exactly one write agent or sequenced after tasks 1-2;
  research (5) -> k-researcher; OpenAPI doc (4) -> k-architect or k-developer; every write agent (1, 2, 3, 6) gets a named worktree.
- p3: agentType values cannot be resolved from a live agent list here; a strong answer states the assumed naming form.
