# T12 authoring log

Every paid model call made for a T12 task, with its credits. The first four tasks (2026-11-20, mate task-fix worker)
were written by hand with no model call, so they have no rows. Batch CV-A (2026-11-20, mate CV-A worker): estimate 180
credits, stop 360; each call is counted at 15 credits in the spend check before it starts, and one call runs at a time.
Calls run through a run script that starts Kiro CLI in a scratch HOME holding only a copy of the Kiro login (no
steering, rules, MCP or skills), in an empty directory outside every git worktree.

| Task | Step | Model | Credits | Note |
| --- | --- | --- | ---: | --- |
| t12-mux-parallel-merge | step1 (fixture and request) | gpt-5.6-luna | 1.38 | counted 15 before the call; spend check 0 + 15 <= 360; audit clean (no unit reads, no path outside the authoring dir) |
| t12-mux-parallel-merge | step2 (key: hidden tests, ticket files, reference and alternative work), a separate call | gpt-5.6-luna | 1.36 | counted 15; spend check 15 + 15 <= 360; audit: no unit reads, no other batch; the only outside paths are the authoring dir under its /local/home spelling and /var/tmp inside the Kiro account memory the CLI loads (3.6k tokens on temp-dir hygiene, no konductor unit text) |
| all four CV-A tasks | map (one call, names and descriptions only, from `t1/catalog-descriptions.js`) | glm-5 | 0.24 | counted 15; spend check 30 + 15 <= 360; audit clean. Taken: delegated-worker-fix skills delegation-protocol, git-merge, code-review and SOP k-delegate; mux and cmux SOP k-delegate. Kept against the map: delegated-worker-fix agent `konductor` (map: konductor-mux-orchestrator; the request names no multiplexer) and sop-route-choice targets `sdlc-navigator`, `pre-planning-analysis`, `konductor` (map: none; the coverage review added the task to test exactly that route choice) |
| t12-delegated-worker-fix | review and checklist recheck (one call) | deepseek-3.2 | 4.55 | counted 15; spend check 45 + 15 <= 360; audit clean; 5 of 5 verdicts and 4 of 4 checklist items pass, no fixes |
| t12-sop-route-choice | review and checklist recheck (one call) | qwen3-coder-next | 0.83 | counted 15; spend check 60 + 15 <= 360; audit clean; 5 of 5 verdicts and 4 of 4 checklist items pass, no fixes (the reviewer notes the one-tier `TIERS` list points at the missing tier; the policy states the tiers anyway, so it stays) |
| t12-cmux-parallel-merge | review and checklist recheck (one call) | minimax-m2.5 | 2.86 | counted 15; spend check 75 + 15 <= 360; audit clean; 5 of 5 verdicts and 4 of 4 checklist items pass, no fixes |
| t12-mux-parallel-merge | review (one call, a family other than the author's) | deepseek-3.2 | 4.59 | counted 15; spend check 90 + 15 <= 360; audit: no unit reads, no other batch; the reviewer made its git scratch copy under /tmp/scratch, outside the authoring dir; 5 of 5 verdicts pass, no fixes. Not hand-edited, so no recheck. Total: 7 calls, 15.80 credits used, 105 counted against the 180 estimate and the 360 stop |
