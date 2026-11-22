# T2 authoring log

Every model call made to write, map, review or re-check a T2 task, in order. Calls ran through Kiro CLI 3.5.0 in an empty work dir with an isolated home (no steering, rules, skills or MCP servers; memory disabled). Credits are read from each call's own stream. A call stopped before its final metering event has no credit figure ("not captured").

| | Calls | Credits captured | Estimate | Stop at |
| --- | --- | --- | --- | --- |
| Wave 1 | 37 | 97.53 | 80 | 160 |
| Rest | 82 | 227.90 | 270 | 540 |
| **T2 total** | 119 | **325.44** | 350 | 700 |
| Coverage-gap stage 1 (2026-11-21 to 22, 23 tried, 13 landed, 1 re-map) | 95 | 316.66 | counted at max(15, real): 1,433 | 1,550 counted (stop at 1,450) |

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
| 2026-11-20T01:42:59Z | t2-fe-pr-search-box | map | glm-5 | 36 | 0.53 | ok |
| 2026-11-20T01:43:49Z | t2-fe-pr-search-box | review | qwen3-coder-next | 50 | 0.26 | ok |
| 2026-11-20T01:47:39Z | t2-twin-refund-notes | author | deepseek-3.2 | 230 | 2.85 | ok |
| 2026-11-20T02:01:07.612Z | t2-twin-refund-notes | fix | deepseek-3.2 | 795 | 13.38 | ok |
| 2026-11-20T02:02:51Z | t2-twin-fanout-brief | author | gpt-5.6-luna | 94 | 1.74 | ok |
| 2026-11-20T02:04:30.049Z | t2-twin-fanout-brief | fix | gpt-5.6-luna | 85 | 1.90 | ok |
| 2026-11-20T02:20:38Z | t2-arch-dr-event-store | recheck | glm-5 | 47 | 1.04 | ok |
| 2026-11-20T02:22:00Z | t2-arch-dr-split-checkout | recheck | glm-5 | 82 | 1.23 | ok |
| 2026-11-20T02:24:38Z | t2-arch-dr-two-regions | recheck | minimax-m2.5 | 157 | 1.12 | ok |
| 2026-11-20T02:25:18Z | t2-dr-data-erasure | recheck | qwen3-coder-next | 40 | 0.17 | ok |
| 2026-11-20T02:27:19Z | t2-dr-notify-fanout | recheck | minimax-m2.5 | 120 | 0.85 | ok |
| 2026-11-20T02:29:07Z | t2-dr-rate-limits | recheck | minimax-m2.5 | 107 | 0.59 | ok |
| 2026-11-20T02:29:51Z | t2-dr-search-reindex | recheck | glm-5 | 43 | 1.08 | ok |
| 2026-11-20T02:30:39Z | t2-gaps-jwt-middleware | recheck | qwen3-coder-next | 48 | 0.12 | ok |
| 2026-11-20T02:32:05Z | t2-pr-avatar-upload | recheck | minimax-m2.5 | 85 | 0.63 | ok |
| 2026-11-20T02:33:55Z | t2-pr-cursor-pages | recheck | glm-5 | 109 | 1.90 | ok |
| 2026-11-20T02:35:04Z | t2-pr-orders-migration | recheck | minimax-m2.5 | 68 | 0.44 | ok |
| 2026-11-20T02:35:42Z | t2-pr-price-cache | recheck | qwen3-coder-next | 38 | 0.25 | ok |
| 2026-11-20T02:37:33Z | t2-pr-refund-flow | recheck | glm-5 | 111 | 2.80 | ok |
| 2026-11-20T02:38:01Z | t2-pr-stock-reserve | recheck | qwen3-coder-next | 27 | 0.13 | ok |
| 2026-11-20T02:39:39Z | t2-sec-dr-sso-login | recheck | minimax-m2.5 | 97 | 0.45 | ok |
| 2026-11-20T02:40:30Z | t2-sec-pr-webhook-relay | recheck | qwen3-coder-next | 50 | 0.24 | ok |
| 2026-11-20T02:43:01Z | t2-pr-refund-flow | recheck | glm-5 | 103 | 2.72 | ok |
| 2026-11-21T19:10:05.222Z | t2-pr-invoice-precheck | author | deepseek-3.2 | 1243 | 21.59 | coverage-gap stage 1 |
| 2026-11-21T19:29:58.161Z | t2-pr-invoice-precheck | map | glm-5 | 20 | 0.66 | coverage-gap stage 1 |
| 2026-11-21T19:30:39.619Z | t2-pr-invoice-precheck | review | gpt-5.6-luna | 33 | 0.78 | coverage-gap stage 1 |
| 2026-11-21T19:43:00.062Z | t2-pr-invoice-precheck | fix | deepseek-3.2 | 727 | 12.92 | coverage-gap stage 1 |
| 2026-11-21T20:00:18.665Z | t2-pr-invoice-precheck | review-2 | gpt-5.6-luna | 52 | 1.23 | coverage-gap stage 1 |
| 2026-11-21T20:16:52.890Z | t2-pr-upload-stack | author | deepseek-3.2 | 969 | 16.38 | coverage-gap stage 1 |
| 2026-11-21T20:39:43.452Z | t2-pr-upload-stack | fix | deepseek-3.2 | 652 | 8.60 | coverage-gap stage 1 |
| 2026-11-21T21:11:06.781Z | t2-pr-reservation-model | author | deepseek-3.2 | 866 | 13.95 | coverage-gap stage 1 |
| 2026-11-21T21:34:46.653Z | t2-pr-reservation-model | fix | deepseek-3.2 | 605 | 12.41 | coverage-gap stage 1 |
| 2026-11-21T21:52:59.689Z | t2-pr-reservation-model | map | glm-5 | 30 | 0.69 | coverage-gap stage 1 |
| 2026-11-21T21:53:38.601Z | t2-pr-reservation-model | review | gpt-5.6-luna | 39 | 0.95 | coverage-gap stage 1 |
| 2026-11-21T22:15:45.645Z | t2-dr-billing-migration-plan | author | deepseek-3.2 | 1293 | 11.63 | coverage-gap stage 1 |
| 2026-11-21T22:22:34.277Z | t2-dr-billing-migration-plan | map | glm-5 | 23 | 0.67 | coverage-gap stage 1 |
| 2026-11-21T22:23:12.473Z | t2-dr-billing-migration-plan | review | gpt-5.6-luna | 38 | 0.84 | coverage-gap stage 1 |
| 2026-11-21T22:33:41.007Z | t2-dr-billing-migration-plan | fix | deepseek-3.2 | 624 | 13.10 | coverage-gap stage 1 |
| 2026-11-21T22:45:10.848Z | t2-dr-billing-migration-plan | review-2 | gpt-5.6-luna | 32 | 0.72 | coverage-gap stage 1 |
| 2026-11-21T22:52:46.970Z | t2-dr-receipt-service | author | deepseek-3.2 | 361 | 3.45 | coverage-gap stage 1 |
| 2026-11-21T23:15:43.380Z | t2-dr-receipt-service | map | glm-5 | 33 | 1.43 | coverage-gap stage 1 |
| 2026-11-21T23:16:16.891Z | t2-dr-receipt-service | review | gpt-5.6-luna | 33 | 0.68 | coverage-gap stage 1 |
| 2026-11-21T23:22:46.213Z | t2-dr-receipt-service | fix | deepseek-3.2 | 389 | 6.99 | coverage-gap stage 1 |
| 2026-11-21T23:23:22.182Z | t2-dr-receipt-service | review-2 | gpt-5.6-luna | 33 | 0.67 | coverage-gap stage 1 |
| 2026-11-21T23:30:30.605Z | t2-dr-flags-doc-ready | author | deepseek-3.2 | 428 | 4.77 | coverage-gap stage 1 |
| 2026-11-21T23:30:57.407Z | t2-dr-flags-doc-ready | map | glm-5 | 24 | 0.67 | coverage-gap stage 1 |
| 2026-11-21T23:31:29.570Z | t2-dr-flags-doc-ready | review | gpt-5.6-luna | 32 | 0.73 | coverage-gap stage 1 |
| 2026-11-21T23:37:53.272Z | t2-dr-flags-doc-ready | fix | deepseek-3.2 | 384 | 6.25 | coverage-gap stage 1 |
| 2026-11-21T23:38:27.102Z | t2-dr-flags-doc-ready | review-2 | gpt-5.6-luna | 31 | 0.73 | coverage-gap stage 1 |
| 2026-11-21T23:51:21.212Z | t2-dr-event-sourcing-move | author | deepseek-3.2 | 774 | 11.02 | coverage-gap stage 1 |
| 2026-11-21T23:51:39.487Z | t2-dr-event-sourcing-move | map | glm-5 | 16 | 0.68 | coverage-gap stage 1 |
| 2026-11-21T23:52:12.355Z | t2-dr-event-sourcing-move | review | gpt-5.6-luna | 33 | 0.80 | coverage-gap stage 1 |
| 2026-11-22T00:00:32.199Z | t2-dr-event-sourcing-move | fix | deepseek-3.2 | 500 | 11.84 | coverage-gap stage 1 |
| 2026-11-22T00:01:12.948Z | t2-dr-event-sourcing-move | review-2 | gpt-5.6-luna | 38 | 0.82 | coverage-gap stage 1 |
| 2026-11-22T00:04:27.505Z | t2-dr-aws-claims-check | author | gpt-5.6-luna | 119 | 2.86 | coverage-gap stage 1 |
| 2026-11-22T00:05:02.511Z | t2-dr-aws-claims-check | map | glm-5 | 32 | 0.67 | coverage-gap stage 1 |
| 2026-11-22T00:07:49.489Z | t2-dr-aws-claims-check | review | deepseek-3.2 | 167 | 2.14 | coverage-gap stage 1 |
| 2026-11-22T00:08:30.279Z | t2-dr-aws-claims-check | fix | gpt-5.6-luna | 41 | 1.00 | coverage-gap stage 1 |
| 2026-11-22T00:11:37.413Z | t2-dr-aws-claims-check | review-2 | deepseek-3.2 | 184 | 2.94 | coverage-gap stage 1 |
| 2026-11-22T00:13:27.252Z | t2-sec-dr-partner-webhooks | author | gpt-5.6-luna | 110 | 2.40 | coverage-gap stage 1 |
| 2026-11-22T00:13:58.561Z | t2-sec-dr-partner-webhooks | map | glm-5 | 29 | 0.67 | coverage-gap stage 1 |
| 2026-11-22T00:17:31.245Z | t2-sec-dr-partner-webhooks | review | deepseek-3.2 | 213 | 3.36 | coverage-gap stage 1 |
| 2026-11-22T00:19:09.048Z | t2-dr-orders-dynamo-model | author | gpt-5.6-luna | 98 | 2.19 | coverage-gap stage 1 |
| 2026-11-22T00:19:37.039Z | t2-dr-orders-dynamo-model | map | glm-5 | 25 | 0.69 | coverage-gap stage 1 |
| 2026-11-22T00:22:10.647Z | t2-dr-orders-dynamo-model | review | deepseek-3.2 | 154 | 2.23 | coverage-gap stage 1 |
| 2026-11-22T00:23:43.486Z | t2-dr-orders-dynamo-model | fix | gpt-5.6-luna | 93 | 2.62 | coverage-gap stage 1 |
| 2026-11-22T00:26:06.808Z | t2-dr-orders-dynamo-model | review-2 | deepseek-3.2 | 141 | 2.15 | coverage-gap stage 1 |
| 2026-11-22T00:27:43.851Z | t2-dr-search-options | author | gpt-5.6-luna | 97 | 2.09 | coverage-gap stage 1 |
| 2026-11-22T00:28:09.626Z | t2-dr-search-options | map | glm-5 | 23 | 0.68 | coverage-gap stage 1 |
| 2026-11-22T00:30:34.635Z | t2-dr-search-options | review | deepseek-3.2 | 145 | 2.24 | coverage-gap stage 1 |
| 2026-11-22T00:48:21.458Z | t2-sec-dr-partner-webhooks | fix | gpt-5.6-luna | 42 | 1.05 | coverage-gap stage 1 |
| 2026-11-22T00:51:03.329Z | t2-sec-dr-partner-webhooks | review-3 | deepseek-3.2 | 159 | 2.33 | coverage-gap stage 1 |
| 2026-11-22T00:51:52.724Z | t2-dr-search-options | fix | gpt-5.6-luna | 49 | 1.25 | coverage-gap stage 1 |
| 2026-11-22T00:54:10.738Z | t2-dr-search-options | review-3 | deepseek-3.2 | 135 | 1.97 | coverage-gap stage 1 |
| 2026-11-22T01:18:24.722Z | t2-dr-orders-dynamo-model | fix | gpt-5.6-luna | 26 | 0.70 | coverage-gap stage 1 |
| 2026-11-22T01:22:29.222Z | t2-pr-order-contract | author | gpt-5.6-luna | 217 | 6.21 | coverage-gap stage 1 |
| 2026-11-22T01:22:52.299Z | t2-pr-order-contract | map | glm-5 | 20 | 0.69 | coverage-gap stage 1 |
| 2026-11-22T01:26:23.199Z | t2-pr-order-contract | review | deepseek-3.2 | 211 | 3.99 | coverage-gap stage 1 |
| 2026-11-22T01:27:31.598Z | t2-pr-order-contract | fix | gpt-5.6-luna | 68 | 1.72 | coverage-gap stage 1 |
| 2026-11-22T01:32:08.186Z | t2-pr-order-contract | review-2 | deepseek-3.2 | 274 | 4.64 | coverage-gap stage 1 |
| 2026-11-22T01:33:48.931Z | t2-pr-ledger-transfer | author | gpt-5.6-luna | 100 | 2.26 | coverage-gap stage 1 |
| 2026-11-22T01:34:14.326Z | t2-pr-ledger-transfer | map | glm-5 | 23 | 0.67 | coverage-gap stage 1 |
| 2026-11-22T01:37:06.393Z | t2-pr-ledger-transfer | review | deepseek-3.2 | 172 | 2.98 | coverage-gap stage 1 |
| 2026-11-22T01:40:25.816Z | t2-sec-pr-session-refresh | author | gpt-5.6-luna | 199 | 5.73 | coverage-gap stage 1 |
| 2026-11-22T01:40:48.916Z | t2-sec-pr-session-refresh | map | glm-5 | 20 | 0.67 | coverage-gap stage 1 |
| 2026-11-22T01:43:08.479Z | t2-sec-pr-session-refresh | review | deepseek-3.2 | 139 | 2.39 | coverage-gap stage 1 |
| 2026-11-22T01:45:07.732Z | t2-pr-checkout-widget | author | gpt-5.6-luna | 119 | 2.98 | coverage-gap stage 1 |
| 2026-11-22T01:45:36.668Z | t2-pr-checkout-widget | map | glm-5 | 25 | 0.68 | coverage-gap stage 1 |
| 2026-11-22T01:48:46.672Z | t2-pr-checkout-widget | review | deepseek-3.2 | 190 | 3.19 | coverage-gap stage 1 |
| 2026-11-22T05:51:14.458Z | t2-gaps-rev3-history | author | gpt-5.6-luna | 167 | 3.37 | coverage-gap stage 1 |
| 2026-11-22T05:54:13.086Z | t2-gaps-rev3-history | map | glm-5 | 25 | 0.68 | coverage-gap stage 1 |
| 2026-11-22T05:56:54.299Z | t2-gaps-rev3-history | review | deepseek-3.2 | 161 | 3.18 | coverage-gap stage 1 |
| 2026-11-22T06:00:09.684Z | t2-pr-precheck-uncommitted | author | gpt-5.6-luna | 195 | 4.52 | coverage-gap stage 1 |
| 2026-11-22T06:04:23.414Z | t2-pr-precheck-uncommitted | map | glm-5 | 39 | 0.68 | coverage-gap stage 1 |
| 2026-11-22T06:07:07.442Z | t2-pr-precheck-uncommitted | review | deepseek-3.2 | 164 | 2.94 | coverage-gap stage 1 |
| 2026-11-22T06:08:37.824Z | t2-dr-plan-start-monday | author | gpt-5.6-luna | 90 | 1.98 | coverage-gap stage 1 |
| 2026-11-22T06:09:37.384Z | t2-dr-plan-start-monday | map | glm-5 | 27 | 0.68 | coverage-gap stage 1 |
| 2026-11-22T06:13:28.771Z | t2-dr-plan-start-monday | review | deepseek-3.2 | 231 | 3.89 | coverage-gap stage 1 |
| 2026-11-22T06:15:12.862Z | t2-dr-doc-ready-for-review | author | gpt-5.6-luna | 104 | 2.22 | coverage-gap stage 1 |
| 2026-11-22T06:16:48.372Z | t2-dr-doc-ready-for-review | map | glm-5 | 32 | 0.68 | coverage-gap stage 1 |
| 2026-11-22T06:19:12.680Z | t2-dr-doc-ready-for-review | review | deepseek-3.2 | 144 | 1.90 | coverage-gap stage 1 |
| 2026-11-22T06:21:12.527Z | t2-dr-five-angle-spec | author | gpt-5.6-luna | 120 | 2.42 | coverage-gap stage 1 |
| 2026-11-22T06:28:01.587Z | t2-dr-five-angle-spec | map | glm-5 | 20 | 0.67 | coverage-gap stage 1 |
| 2026-11-22T06:31:19.553Z | t2-dr-five-angle-spec | review | deepseek-3.2 | 198 | 3.22 | coverage-gap stage 1 |
| 2026-11-22T06:33:38.552Z | t2-pr-precheck-uncommitted | map | glm-5 | 29 | 0.71 | coverage-gap stage 1 |
| 2026-11-22T06:37:46.301Z | t2-pr-catalog-api-v2 | author | gpt-5.6-luna | 220 | 6.14 | coverage-gap stage 1 |
| 2026-11-22T06:38:15.559Z | t2-pr-catalog-api-v2 | map | glm-5 | 26 | 0.71 | coverage-gap stage 1 |
| 2026-11-22T06:41:53.263Z | t2-pr-catalog-api-v2 | review | deepseek-3.2 | 218 | 4.32 | coverage-gap stage 1 |
| 2026-11-22T06:43:17.893Z | t2-pr-catalog-api-v2 | fix | gpt-5.6-luna | 85 | 2.14 | coverage-gap stage 1 |
| 2026-11-22T06:46:37.128Z | t2-pr-catalog-api-v2 | review-2 | deepseek-3.2 | 196 | 4.31 | coverage-gap stage 1 |
| 2026-11-22T06:48:38.641Z | t2-pr-reports-stack | author | gpt-5.6-luna | 121 | 3.07 | coverage-gap stage 1 |
| 2026-11-22T06:54:07.304Z | t2-pr-reports-stack | map | glm-5 | 25 | 0.69 | coverage-gap stage 1 |
| 2026-11-22T06:58:10.005Z | t2-pr-reports-stack | review | deepseek-3.2 | 243 | 3.22 | coverage-gap stage 1 |
| 2026-11-22T06:59:09.557Z | t2-pr-reports-stack | fix | gpt-5.6-luna | 59 | 1.25 | coverage-gap stage 1 |
| 2026-11-22T07:02:05.721Z | t2-pr-reports-stack | review-2 | deepseek-3.2 | 173 | 2.85 | coverage-gap stage 1 |
| 2026-11-22T07:05:20.216Z | t2-pr-booking-smithy | author | gpt-5.6-luna | 194 | 3.77 | coverage-gap stage 1 |
| 2026-11-22T07:09:46.864Z | t2-pr-booking-smithy | map | glm-5 | 23 | 0.69 | coverage-gap stage 1 |
| 2026-11-22T07:13:05.126Z | t2-pr-booking-smithy | review | deepseek-3.2 | 198 | 4.12 | coverage-gap stage 1 |
