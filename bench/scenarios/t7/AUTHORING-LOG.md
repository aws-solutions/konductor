# T7 authoring log

Every model call of batch T7 (TPM), in order. Credits are read from the call's own stream (`stage.js`). Calls ran through Kiro CLI 3.5.0 in a scratch home with only a copy of the login: no steering, rules, MCP config or skills (checked before the first call).

Estimate (plan section 9, T7 row, recorded before the first call): wave 1 (5 tasks) 80 credits, stop at 160; the rest (8 tasks) 130 credits, stop at 260.

| Task | Step | Model | Seconds | Credits |
| --- | --- | --- | --- | --- |
| t7-status-slip | author | gpt-5.6-luna | 187 | 3.77 |
| t7-status-slip | map | glm-5 | 7 | 0.16 |
| t7-status-slip | review | glm-5 | 225 | 7.10 |
| t7-status-slip | fix | gpt-5.6-luna | 236 | 3.55 |
| t7-march-date | author | deepseek-3.2 | 1113 | 12.94 |
| t7-march-date | map | glm-5 | 13 | 0.16 |
| t7-status-slip | review | glm-5 | 222 | 9.45 |
| t7-march-date | review | minimax-m2.5 | 450 | 5.61 |
| t7-dep-conflicts | author | gpt-5.6-luna | 180 | 3.60 |
| t7-dep-conflicts | map | glm-5 | 8 | 0.16 |
| t7-dep-conflicts | review | glm-5 | 183 | 9.27 |
| t7-ship-train | author | gpt-5.6-luna | 179 | 2.97 |
| t7-ship-train | map | glm-5 | 11 | 0.16 |
| t7-ship-train | review | glm-5 | 135 | 5.89 |
| t7-march-date | fix | deepseek-3.2 | 897 | 12.73 |
