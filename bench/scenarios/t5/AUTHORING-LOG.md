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
