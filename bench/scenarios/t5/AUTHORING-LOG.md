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
