# T2 authoring log

Every model call made to write, map, review or re-check a T2 task, in order. Calls ran through Kiro CLI 3.5.0 in an empty work dir with an isolated home (no steering, rules, skills or MCP servers; memory disabled). Credits are read from each call's own stream. A call stopped before its final metering event has no credit figure ("not captured").

| | Calls | Credits captured | Estimate | Stop at |
| --- | --- | --- | --- | --- |
| Wave 1 | 31 | 89.76 | 80 | 160 |
| Rest | 65 | 199.28 | 270 | 540 |
| **T2 total** | 96 | **289.04** | 350 | 700 |

6 calls were stopped before their metering event and are not in these totals; at 2 to 15 credits each they add an estimated 12 to 90.

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
| 2026-11-19T19:39:33.531Z | t2-sec-pr-webhook-relay | author2 | gpt-5.6-luna | 115 | 2.63 | ok |
| 2026-11-19T19:39:55Z | t2-sec-pr-webhook-relay | map | glm-5 | 19 | 0.51 | ok |
| 2026-11-19T19:41:35Z | t2-sec-pr-webhook-relay | review | qwen3-coder-next | 99 | 0.43 | ok |
| 2026-11-19T20:07:44Z | t2-pr-retry-client | author | deepseek-3.2 | 1245 | 9.80 | ok |
| 2026-11-19T20:08:07Z | t2-pr-retry-client | map | glm-5 | 19 | 0.51 | ok |
| 2026-11-19T20:19:01Z | t2-pr-retry-client | review | minimax-m2.5 | 654 | 2.92 | ok |
| 2026-11-19T20:30:59.362Z | t2-pr-retry-client | fix | deepseek-3.2 | 718 | 17.03 | ok |
| 2026-11-19T20:41:46Z | t2-pr-retry-client | review | minimax-m2.5 | 644 | 2.12 | ok |
| 2026-11-19T20:43:39Z | t2-dr-search-reindex | author | gpt-5.6-luna | 112 | 1.85 | ok |
| 2026-11-19T20:44:15Z | t2-dr-search-reindex | map | glm-5 | 33 | 0.50 | ok |
| 2026-11-19T20:45:08Z | t2-dr-search-reindex | review | glm-5 | 52 | 1.31 | ok |
| 2026-11-19T20:48:56Z | t2-pr-price-cache | author | gpt-5.6-luna | 227 | 4.41 | ok |
| 2026-11-19T20:49:21Z | t2-pr-price-cache | map | glm-5 | 21 | 0.52 | ok |
| 2026-11-19T20:50:25Z | t2-pr-price-cache | review | qwen3-coder-next | 64 | 0.30 | ok |
| 2026-11-19T20:54:13Z | t2-dr-rate-limits | author | deepseek-3.2 | 228 | 0.00 | exit 143 |
| 2026-11-19T20:55:02.052Z | t2-dr-search-reindex | expert | gpt-5.6-luna | 15 | 0.44 | ok |
| 2026-11-19T20:59:52.743Z | t2-dr-rate-limits | author2 | deepseek-3.2 | 284 | 3.21 | ok |
| 2026-11-19T21:00:38.818Z | t2-dr-rate-limits | expert | deepseek-3.2 | 46 | 0.93 | ok |
| 2026-11-19T21:01:06Z | t2-dr-rate-limits | map | glm-5 | 23 | 0.52 | ok |
| 2026-11-19T21:07:14Z | t2-dr-rate-limits | review | minimax-m2.5 | 367 | 1.26 | ok |
| 2026-11-19T21:21:48Z | t2-pr-orders-migration | author | deepseek-3.2 | 850 | 10.49 | ok |
| 2026-11-19T21:22:07Z | t2-pr-orders-migration | map | glm-5 | 16 | 0.51 | ok |
| 2026-11-19T21:27:27Z | t2-pr-orders-migration | review | minimax-m2.5 | 319 | 2.04 | ok |
| 2026-11-19T21:35:45.825Z | t2-pr-orders-migration | fix | deepseek-3.2 | 499 | 9.22 | ok |
| 2026-11-19T21:40:00Z | t2-pr-orders-migration | review | minimax-m2.5 | 252 | 0.71 | ok |
| 2026-11-19T21:41:48Z | t2-dr-data-erasure | author | gpt-5.6-luna | 107 | 1.83 | ok |
| 2026-11-19T21:42:02.582Z | t2-dr-data-erasure | expert | gpt-5.6-luna | 14 | 0.42 | ok |
| 2026-11-19T21:42:29Z | t2-dr-data-erasure | map | glm-5 | 24 | 0.51 | ok |
| 2026-11-19T21:43:11Z | t2-dr-data-erasure | review | qwen3-coder-next | 42 | 0.17 | ok |
| 2026-11-19T21:45:22Z | t2-pr-cursor-pages | author | gpt-5.6-luna | 131 | 2.66 | ok |
| 2026-11-19T21:45:40Z | t2-pr-cursor-pages | map | glm-5 | 16 | 0.52 | ok |
| 2026-11-19T21:46:18Z | t2-pr-cursor-pages | review | glm-5 | 38 | 1.08 | ok |
| 2026-11-19T21:56:28Z | t2-arch-dr-two-regions | author | deepseek-3.2 | 610 | 4.55 | ok |
| 2026-11-19T21:57:33.673Z | t2-arch-dr-two-regions | expert | deepseek-3.2 | 65 | 1.30 | ok |
| 2026-11-19T21:58:00Z | t2-arch-dr-two-regions | map | glm-5 | 24 | 0.53 | ok |
| 2026-11-19T22:06:10Z | t2-arch-dr-two-regions | review | minimax-m2.5 | 489 | 1.81 | ok |
| 2026-11-19T22:20:34Z | t2-pr-avatar-upload | author | deepseek-3.2 | 862 | 12.21 | ok |
| 2026-11-19T22:20:57Z | t2-pr-avatar-upload | map | glm-5 | 20 | 0.51 | ok |
| 2026-11-19T22:27:35Z | t2-pr-avatar-upload | review | minimax-m2.5 | 398 | 1.15 | ok |
| 2026-11-19T22:36:00Z | t2-pr-avatar-upload | fix (killed with the old worktree) | deepseek-3.2 |  | not captured | killed |
| 2026-11-19T22:53:46.009Z | t2-pr-avatar-upload | fix | deepseek-3.2 | 681 | 11.88 | ok |
| 2026-11-19T23:06:38Z | t2-pr-avatar-upload | review | minimax-m2.5 | 768 | 2.34 | ok |
| 2026-11-19T23:12:47.595Z | t2-arch-dr-two-regions | fix | deepseek-3.2 | 365 | 4.51 | ok |
| 2026-11-19T23:18:39Z | t2-arch-dr-two-regions | review | minimax-m2.5 | 343 | 1.41 | ok |
| 2026-11-19T23:20:32Z | t2-arch-dr-split-checkout | author | gpt-5.6-luna | 113 | 2.09 | ok |
| 2026-11-19T23:20:50.714Z | t2-arch-dr-split-checkout | expert | gpt-5.6-luna | 18 | 0.33 | ok |
| 2026-11-19T23:21:23Z | t2-arch-dr-split-checkout | map | glm-5 | 26 | 0.51 | ok |
| 2026-11-19T23:22:08Z | t2-arch-dr-split-checkout | review | glm-5 | 45 | 1.56 | ok |
| 2026-11-19T23:26:34Z | t2-pr-stock-reserve | author | gpt-5.6-luna | 181 | 3.54 | ok |
| 2026-11-19T23:27:23Z | t2-pr-stock-reserve | map | glm-5 | 36 | 0.54 | ok |
| 2026-11-19T23:28:35Z | t2-pr-stock-reserve | review | qwen3-coder-next | 71 | 0.30 | ok |
| 2026-11-19T23:39:43Z | t2-sec-dr-sso-login | author | deepseek-3.2 | 666 | 5.98 | ok |
| 2026-11-19T23:40:45.738Z | t2-sec-dr-sso-login | expert | deepseek-3.2 | 62 | 0.95 | ok |
| 2026-11-19T23:41:37Z | t2-sec-dr-sso-login | map | glm-5 | 47 | 0.73 | ok |
| 2026-11-19T23:51:44Z | t2-sec-dr-sso-login | review | minimax-m2.5 | 607 | 1.03 | ok |
| 2026-11-20T00:16:56Z | t2-gaps-csv-export | author | deepseek-3.2 | 1511 | 17.70 | ok |
| 2026-11-20T00:17:15Z | t2-gaps-csv-export | map | glm-5 | 15 | 0.52 | ok |
| 2026-11-20T00:36:04Z | t2-gaps-csv-export | review | minimax-m2.5 | 1129 | 3.27 | ok |
| 2026-11-20T00:43:42.635Z | t2-gaps-csv-export | fix | deepseek-3.2 | 458 | 7.82 | ok |
| 2026-11-20T00:50:37Z | t2-gaps-csv-export | review | minimax-m2.5 | 409 | 2.13 | ok |
| 2026-11-20T00:53:11Z | t2-fe-pr-search-box | author | gpt-5.6-luna | 154 | 2.50 | ok |
| 2026-11-20T00:54:22.295Z | t2-fe-pr-search-box | fix | gpt-5.6-luna | 47 | 0.83 | ok |
| 2026-11-20T01:13:38Z | t2-pr-flag-rollout | author | deepseek-3.2 | 1124 | 14.09 | ok |
| 2026-11-20T01:14:59Z | t2-pr-flag-rollout | map | glm-5 | 45 | 0.52 | ok |
| 2026-11-20T01:17:54Z | t2-pr-flag-rollout | review | minimax-m2.5 | 174 | 2.00 | ok |
| 2026-11-20T01:24:28.602Z | t2-pr-flag-rollout | fix | deepseek-3.2 | 394 | 9.04 | ok |
| 2026-11-20T01:27:45Z | t2-pr-flag-rollout | review | minimax-m2.5 | 171 | 1.26 | ok |
| 2026-11-20T01:36:00Z | t2-pr-retry-backoff | author (killed by the worker timeout) | qwen3-coder-next |  | not captured | killed |
