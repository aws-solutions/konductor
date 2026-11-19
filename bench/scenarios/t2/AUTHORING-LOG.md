# T2 authoring log

Every model call made to write, map or review a T2 task, in order. Calls ran through Kiro CLI 3.5.0 in an empty work dir with an isolated home (no steering, rules, skills, MCP servers; memory disabled). Credits are read from the call's own stream; a call stopped before its final metering event shows "not captured".

Total captured: 6.02 credits over 8 calls.

| Time (UTC) | Task | Step | Model | Seconds | Credits | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-19T17:12:44Z | t2-dr-notify-fanout | author | deepseek-3.2 |  | not captured | killed (host memory: one call at a time) |
| 2026-11-19T17:12:44Z | t2-gaps-jwt-middleware | author | gpt-5.6-luna |  | not captured | killed (host memory: one call at a time) |
| 2026-11-19T17:12:45Z | t2-sec-pr-webhooks | author | deepseek-3.2 |  | not captured | killed (host memory: one call at a time) |
| 2026-11-19T17:12:45Z | t2-arch-dr-event-store | author | gpt-5.6-luna |  | not captured | killed (host memory: one call at a time) |
| 2026-11-19T17:13:35Z | t2-pr-refund-flow | author | gpt-5.6-luna | 956 | 0.00 | exit 143 |
| 2026-11-19T17:32:05Z | t2-pr-refund-flow | author-resume | gpt-5.6-luna | 171 | 3.47 | ok |
| 2026-11-19T17:45:34Z | t2-pr-refund-flow | map | glm-5 | 22 | 0.51 | ok |
| 2026-11-19T17:46:45Z | t2-pr-refund-flow | review | glm-5 | 65 | 2.04 | ok |
