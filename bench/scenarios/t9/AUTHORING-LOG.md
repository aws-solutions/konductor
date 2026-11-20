# T9 authoring log

Public repo: no internal names, host paths or secrets. Credits are what each kiro-cli call reported. Plan estimate for T9: wave 1 (5 tasks) 80 credits, the batch 150, stop at 300. Every call has an abort limit of 15 credits (a cap on tool calls per model), written to the scratch call log before the call starts; the spend check (logged spend plus the limit of every call in flight plus this call's limit must stay at or under 300) runs before every call.

## Setup check (2026-11-19)

Author, map and review calls run `kiro-cli chat --no-interactive --trust-all-tools --model <id>` (3.5.0) in a scratch HOME (own copy, login database only), in an empty working directory outside every git worktree, with a cleared environment. Checked before the first call: the HOME has no steering files, rules files, skills, user agents (only the shipped example), MCP servers, memories or old sessions; `memory.mode disabled`, `memory.reflection false` and `chat.enableKnowledge false` are set. Playwright and Chromium for the browser tasks are installed without root under /var/tmp (plan section 11, item 1: passed).

## Calls

| task | step | model | credits | note |
| --- | --- | --- | --- | --- |
| t9-impl-cart-summary | author | gpt-5.6-luna | 4.09 |  |
| t9-bug-tabs-focus | author | gpt-5.6-luna | 7.41 |  |
| t9-impl-cart-summary | fix | gpt-5.6-luna | 0.80 |  |
| t9-bug-tabs-focus | fix | gpt-5.6-luna | 0.71 |  |
| t9-impl-combobox | author | gpt-5.6-luna | 5.23 |  |
| t9-impl-cart-summary | map | glm-5 | 0.16 |  |
| t9-bug-tabs-focus | map | glm-5 | 0.16 |  |
| t9-impl-cart-summary | review | qwen3-coder-next | 0.56 |  |
| t9-bug-tabs-focus | review | glm-5 | 5.19 |  |
| t9-impl-combobox | fix | gpt-5.6-luna | 1.40 |  |
| t9-ref-store-modules | author | deepseek-3.2 | 15.31 |  |
| t9-impl-combobox | map | glm-5 | 0.16 |  |
| t9-impl-url-state | author | deepseek-3.2 | 26.94 |  |
| t9-impl-combobox | review | glm-5 | 0.00 |  |
