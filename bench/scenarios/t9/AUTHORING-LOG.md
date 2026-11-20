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
| t9-impl-combobox | review (cut by the pause; re-run) | glm-5 | 5.00 | the cut stream reports no credits; an estimate is counted |
| t9-impl-combobox | review | glm-5 | 6.76 |  |
| t9-impl-combobox | fix | gpt-5.6-luna | 1.16 |  |
| t9-impl-combobox | review | glm-5 | 16.16 |  |
| t9-impl-combobox | review | glm-5 | 15.81 |  |
| t9-impl-url-state | author (discarded) | deepseek-3.2 | 0.00 | credits above; the draft passed 25 credits and its reference scored 91.5 and alt 65.4; re-authored by qwen3-coder-next |
| t9-ref-store-modules | author (discarded) | deepseek-3.2 | 0.00 | credits above; the reference scored 17.9 (broken draft); re-authored by minimax-m2.5 |
| t9-impl-url-state | author | qwen3-coder-next | 15.00 | stopped at its tool-call cap (151 calls); the cut stream reports no credits, so the abort limit is counted |
| t9-ref-store-modules | author | minimax-m2.5 | 15.00 | stopped at its tool-call cap (61 calls); the cut stream reports no credits, so the abort limit is counted |
| t9-review-checkout-ui | author | gpt-5.6-luna | 3.83 |  |
| t9-test-form-validator | author | qwen3-coder-next | 15.00 | stopped at its tool-call cap (151 calls); the cut stream reports no credits, so the abort limit is counted |
| t9-twin-country-data | author | minimax-m2.5 | 15.00 | stopped at its tool-call cap (62 calls); the cut stream reports no credits, so the abort limit is counted |
| t9-ref-store-modules | author (no draft) | minimax-m2.5 | 0.00 | credits above; the run stopped at its cap before writing task-draft.json; one more try with qwen3-coder-next |
| t9-test-form-validator | fix | qwen3-coder-next | 15.00 | stopped at its tool-call cap (153 calls); the cut stream reports no credits, so the abort limit is counted |
| t9-test-form-validator | first draft dropped | qwen3-coder-next | 0.00 | credits above; after the fix round the reference scored 28.6: the ES-module repository the batch prompt asked for cannot load the shared CommonJS mutant runner (T9 prompt bug, now a CommonJS stack); one re-author |
| t9-twin-country-data | fix | minimax-m2.5 | 15.00 | stopped at its tool-call cap (61 calls); the cut stream reports no credits, so the abort limit is counted |
| t9-twin-country-data | dropped | minimax-m2.5 | 0.00 | after its fix round: reference 100, alt 100, stub 32, lazy 80.5; the batch keeps no twin (re-authoring would leave too little room under the 300 stop) |
| t9-impl-url-state | fix | qwen3-coder-next | 15.00 | stopped at its tool-call cap (151 calls); the cut stream reports no credits, so the abort limit is counted |
| t9-impl-url-state | dropped | qwen3-coder-next | 0.00 | after its fix round: reference 91.8, stub 58.3, lazy 41.8, alt 91.8 |
| t9-review-checkout-ui | map | glm-5 | 0.16 |  |
| t9-review-checkout-ui | review | qwen3-coder-next | 0.28 |  |
| t9-impl-combobox | recheck | qwen3-coder-next | 0.23 |  |
| t9-test-form-validator | author | qwen3-coder-next | 15.00 | stopped at its tool-call cap (152 calls); the cut stream reports no credits, so the abort limit is counted |
| t9-test-form-validator | fix | qwen3-coder-next | 15.00 | cut by the worker's 10-minute shell limit after 90 tool calls; the abort limit is counted |
| t9-test-form-validator | dropped | qwen3-coder-next | 0.00 | after the re-author and its fix round the reference killed 0 of 10 mutants |

## CV-B calls

Coverage-review wave (2026-11-20), batch CV-B: estimate 225 credits, stop 450. The spend check in the run script counts every row below plus 15 for the next call and refuses a call that could pass 450. Same isolation as the setup check above (scratch HOME with the login database only, memory and knowledge off, empty working directory outside every git worktree). t9-e2e-approved-checkout and t9-e2e-no-approval-control were written by the worker session itself (no author call; see their README section).

| task | step | model | credits | note |
| --- | --- | --- | --- | --- |
| t9-accessibility-performance-nfr | author (stopped by a counting bug in the worker run script after 13 tool calls) | claude-sonnet-5.5 | 15.00 | the cut stream reports no credits, so the abort limit is counted; the author continues from its files |
