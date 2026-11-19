# T5 authoring log

Public repo: no internal names, host paths or secrets. Credits are what each kiro-cli call reported. Plan estimate for T5: wave 1 (5 tasks) 80 credits, the rest 130.

## Setup check (2026-11-19)

Author, map and review calls run `kiro-cli chat --no-interactive --trust-all-tools --model <id>` (3.5.0) in a scratch HOME copied from T1's (login database only), with an empty working directory and a cleared environment. Checked before the first call: no steering files, no rules files, no skills, no user agents, no MCP servers, in the scratch home or the working directory. The first two author calls ran before `memory.mode disabled`, `memory.reflection false` and `chat.enableKnowledge false` were set; their streams show 0 memory attachments. Both settings were applied before every later call.

## Calls

| task | step | model | credits | note |
| --- | --- | --- | --- | --- |
| t5-qa-cart-weak-tests | author | gpt-5.6-luna | 3.30 | |
| t5-qa-checkout-strategy | author | gpt-5.6-luna | 2.34 | |
| t5-qa-checkout-strategy | edit | (worker) | 0.00 | the author's prompt listed every risk area; removed it, and tightened generic fix keywords |
| t5-qa-ledger-gaps | author (discarded) | deepseek-3.2 | 6.39 | run ended in the middle of a malformed tool call, files half written |
| t5-qa-ledger-gaps | author, second round (discarded) | deepseek-3.2 | 10.27 | same failure after a continuation prompt; task re-authored by another family |
| t5-qa-ledger-gaps | author | gpt-5.6-luna | 3.46 | |
| t5-qa-cart-weak-tests, t5-qa-ledger-gaps | edit | (worker) | 0.00 | prompts named the exact boundaries to test; reduced to module level |
| t5-qa-security-tests | author | gpt-5.6-luna | 4.08 | the stream shows reads of other tasks' scratch files (no isolation available); a stray sibling folder was removed |
| t5-qa-security-tests | edit | (worker) | 0.00 | the test entry was a file that required test-cases/; moved to a real test/ folder; prompt reduced to module level |
| t5-qa-cart-weak-tests | map | glm-5 | 0.16 | |
| t5-qa-cart-weak-tests | review | qwen3-coder-next | 0.28 | |
| t5-qa-checkout-strategy | map | glm-5 | 0.16 | |
| t5-qa-checkout-strategy | review | glm-5 | 9.46 | |
| t5-qa-ledger-gaps | map | glm-5 | 0.16 | |
| t5-qa-ledger-gaps | review | qwen3-coder-next | 0.80 | |
| t5-qa-security-tests | map | glm-5 | 0.16 | |
| t5-qa-security-tests | review | glm-5 | 5.74 | |
| t5-qa-flaky-fix | author (discarded) | deepseek-3.2 | 25.89 | run ended in the middle of a malformed tool call; the draft task had checks with a wrong path prefix and a request that listed the causes; re-authored by another family |
| t5-qa-flaky-fix | author | gpt-5.6-luna | 7.96 | |
| t5-qa-flaky-fix | edit | (worker) | 0.00 | stability test and preload rewritten to the scratch-root layout; child suite output stripped from failure messages (the bench's summary parser read it); checks replaced by a time-zone run, an assertion-count floor and the hidden tests |
| t5-qa-flaky-fix | map | glm-5 | 0.16 | |
| t5-qa-flaky-fix | review | glm-5 | 7.69 | |
| t5-qa-parser-gaps | map | glm-5 | 0.16 | |
| t5-qa-parser-gaps | review | glm-5 | 7.97 | |
| t5-qa-sync-strategy | map | glm-5 | 0.16 | |
| t5-qa-sync-strategy | review | glm-5 | 7.62 | |
| t5-dev-legacy-characterize | map | glm-5 | 0.16 | |
| t5-dev-legacy-characterize | review | glm-5 | 7.84 | |
| t5-fe-widget-logic-tests | review | glm-5 | 5.40 | |
| t5-fe-widget-logic-tests | map | glm-5 | 0.16 | |
| t5-qa-acceptance-criteria | map | glm-5 | 0.16 | |
| t5-qa-cart-twin-config | map | glm-5 | 0.16 | |
| t5-qa-acceptance-criteria | review | glm-5 | 5.30 | |
| t5-qa-cart-twin-config | review | glm-5 | 5.05 | |
| t5-qa-parser-gaps | author | gpt-5.6-luna | 3.20 | fixture held a placeholder test file named like the solution file; renamed, request reduced to module level, checks reduced to counts |
| t5-qa-sync-strategy | author | gpt-5.6-luna | 2.02 | request and keyword checks tightened by hand |
| t5-dev-legacy-characterize | author | gpt-5.6-luna | 4.11 | request and checks reduced; file-name checks removed |
| t5-fe-widget-logic-tests | author | gpt-5.6-luna | 3.83 |  |
| t5-qa-acceptance-criteria | author | gpt-5.6-luna | 2.98 |  |
| t5-qa-cart-twin-config | author | gpt-5.6-luna | 1.45 | hidden folder layout and one check fixed by hand |
| t5-qa-suite-audit | author (discarded) | deepseek-3.2 | 16.14 | several key items shared one test file and the request carried an example with real paths; re-authored |
| t5-qa-suite-audit | author | gpt-5.6-luna | 2.23 | fix keywords need 2 matches; a wrong path prefix in a check fixed |
| t5-qa-scheduler-gaps | author | gpt-5.6-luna | 3.32 |  |
| t5-qa-scheduler-gaps | map | glm-5 | 0.16 | |
| t5-qa-suite-audit | map | glm-5 | 0.16 | |
| t5-qa-scheduler-gaps | review | glm-5 | 5.22 | |
| t5-qa-suite-audit | review | glm-5 | 5.57 | |
