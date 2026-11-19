# T2 authoring log

Every model call made to write, map or review a T2 task, in order. Calls ran through Kiro CLI 3.5.0 in an empty work dir with an isolated home (no steering, rules, skills, MCP servers; memory disabled). Credits are read from the call's own stream; a call stopped before its final metering event shows "not captured".

Total captured: 86.18 credits over 28 calls.

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
| 2026-11-19T17:59:01Z | t2-dr-notify-fanout | author | deepseek-3.2 | 625 | 5.74 | ok |
| 2026-11-19T17:59:18Z | t2-dr-notify-fanout | map | glm-5 | 14 | 0.51 | ok |
| 2026-11-19T18:01:15Z | t2-dr-notify-fanout | review | minimax-m2.5 | 117 | 1.22 | ok |
| 2026-11-19T18:06:13Z | t2-gaps-jwt-middleware | author | gpt-5.6-luna | 297 | 6.59 | ok |
| 2026-11-19T18:06:37Z | t2-gaps-jwt-middleware | map | glm-5 | 19 | 0.51 | ok |
| 2026-11-19T18:08:08Z | t2-gaps-jwt-middleware | review | qwen3-coder-next | 90 | 0.32 | ok |
| 2026-11-19T18:29:42Z | t2-sec-pr-webhooks | author | deepseek-3.2 | 1292 | 19.18 | ok |
| 2026-11-19T18:30:17Z | t2-sec-pr-webhooks | map | glm-5 | 30 | 0.52 | ok |
| 2026-11-19T18:30:57Z | t2-sec-pr-webhooks | review | minimax-m2.5 | 40 | 0.19 | exit 1 |
| 2026-11-19T18:33:59Z | t2-arch-dr-event-store | author | gpt-5.6-luna | 181 | 2.30 | ok |
| 2026-11-19T18:34:28Z | t2-arch-dr-event-store | map | glm-5 | 24 | 0.51 | ok |
| 2026-11-19T18:35:26Z | t2-arch-dr-event-store | review | glm-5 | 58 | 1.29 | ok |
| 2026-11-19T18:49:02Z | t2-sec-pr-webhooks | review | minimax-m2.5 | 305 | 1.22 | ok |
| 2026-11-19T19:09:39.767Z | t2-sec-pr-webhooks | fix | deepseek-3.2 | 1237 | 25.15 | ok |
| 2026-11-19T19:10:39Z | t2-arch-dr-event-store | review | glm-5 | 55 | 1.73 | ok |
| 2026-11-19T19:13:06.935Z | t2-arch-dr-event-store | fix | gpt-5.6-luna | 148 | 4.84 | ok |
| 2026-11-19T19:16:57Z | t2-dr-notify-fanout | review | minimax-m2.5 | 226 | 0.98 | ok |
| 2026-11-19T19:19:02.549Z | t2-dr-notify-fanout | fix | deepseek-3.2 | 125 | 2.28 | ok |
| 2026-11-19T19:31:25Z | t2-sec-pr-webhooks | review | minimax-m2.5 | 481 | 3.73 | ok |
| 2026-11-19T19:32:22Z | t2-arch-dr-event-store | review | glm-5 | 57 | 1.34 | ok |
