# T8 authoring log

Public repo: no internal names, host paths or secrets. Credits are what each kiro-cli call reported. Plan estimate for T8 (plan section 9): wave 1 (5 tasks) 80 credits, stop at 160; the rest 160, stop at 320.

## Setup check (2026-11-19)

Author, map and review calls run `kiro-cli chat --no-interactive --trust-all-tools --model <id>` (3.5.0) in a scratch HOME copied from T1's (login database only; T1's session transcripts, npm logs and memory database were removed from the copy), with an empty working directory outside every git worktree and a cleared environment. Checked before the first call: no steering files, no rules files, no skills, no user agents (only the shipped example), no MCP config and no memories in the scratch home; `memory.mode disabled`, `memory.reflection false`, `chat.enableKnowledge false`. After every call, `stage.js audit` lists the paths named in tool calls outside the authoring dir and flags any read of a `skills/`, `agent-sops/`, `agents/` or `context/` path or of another batch's scratch dir.

A deepseek author is stopped after 85 tool calls (about 25 credits at T5's rate; the stream reports credits only at the end, DEBT D-67), and its task is re-authored with gpt-5.6-luna.

## Calls

| task | step | model | credits | note |
| --- | --- | --- | --- | --- |
| t8-inc-checkout-latency | author | gpt-5.6-luna | 3.66 |  |
| t8-inc-checkout-latency | map | glm-5 | 0.16 |  |
| t8-inc-checkout-latency | review | qwen3-coder-next | 0.93 |  |
| t8-pm-cert-expiry-region | author | gpt-5.6-luna | 3.01 |  |
| t8-pm-cert-expiry-region | map | glm-5 | 0.16 |  |
| t8-pm-cert-expiry-region | review | qwen3-coder-next | 1.20 |  |
| t8-bug-retry-storm | author | gpt-5.6-luna | 4.41 |  |
| t8-bug-retry-storm | map | glm-5 | 0.16 |  |
| t8-inc-queue-backlog | author (discarded) | deepseek-3.2 | 11.12 | the request named the decoy as a red herring and listed where to look; key matchers used fields the grader does not read (`event`, `text`, `owner`), so most items matched any element; the author's analysis scripts sat in the fixture; re-authored by gpt-5.6-luna |
| t8-bug-retry-storm | review | qwen3-coder-next | 0.79 |  |
| t8-inc-queue-backlog | map | glm-5 | 0.16 |  |
| t8-inc-checkout-latency | edit | (worker) | 0.00 | timeline matchers held literal times beside the time tolerance; the decoy pattern also rejected "deploy"; a config evidence group accepted only one of the change's lines; two exact-phrase and exact-line `contains` checks and a `fixture/` path prefix removed |
| t8-pm-cert-expiry-region | edit | (worker) | 0.00 | generator wrote a manifest with the seed into the fixture and named the later fix deploy "certfix"; both removed in the generator and the fixture regenerated (identical otherwise); decoy and timeline patterns widened to accept other phrasings; `fixture/` path prefix removed |
| t8-bug-retry-storm | edit | (worker) | 0.00 | request named the shared client as the fix location and the timing as the cause, and fixed a test file name; rewritten to symptom, evidence and contract only; an implementation-string `not_contains` check replaced by a count of test cases; regress test made one test (pass on fix and fail on original) |
| t8-inc-queue-backlog | review (stopped) | minimax-m2.5 | 0.00 | stopped once the draft was discarded; the cut stream reports no credits |
| t8-inc-memory-leak | author | gpt-5.6-luna | 3.47 |  |
| t8-inc-memory-leak | map | glm-5 | 0.16 |  |
| t8-inc-memory-leak | review | qwen3-coder-next | 1.00 |  |
| t8-inc-memory-leak | edit | (worker) | 0.00 | request hinted at the decoy ("distinguish correlation from cause") and left the impact numbers undefined; both fixed; narrow action and timeline patterns widened; evidence needs 2 of 3 groups; a secrets `not_contains` check that passed on the stub removed |
| t8-runbook-db-failover | author | gpt-5.6-luna | 4.24 |  |
| t8-runbook-db-failover | map | glm-5 | 0.16 |  |
| t8-runbook-db-failover | review | qwen3-coder-next | 0.66 |  |
| t8-dec-deploy-strategy | author | gpt-5.6-luna | 4.11 |  |
| t8-dec-deploy-strategy | map | glm-5 | 0.16 |  |
| t8-dec-deploy-strategy | review | qwen3-coder-next | 0.28 |  |
| t8-twin-latency-tier-report | author | gpt-5.6-luna | 1.96 |  |
| t8-twin-latency-tier-report | map | glm-5 | 0.16 |  |
| t8-runbook-db-failover | edit | (worker) | 0.00 | key graded citations of the old incident at fixed step positions (`steps.0`, `steps.1`) and a storage diagnosis, which a runbook need not hold; removed with the citation ask; order items read the `command` field (a text match on "promot" hit "before promotion"); the delayed-replica item now fails only a promote command on it; abort limit at or below the RPO; a file-name `contains` and a numbered-list count removed |
| t8-dec-deploy-strategy | edit | (worker) | 0.00 | request listed every kind of source and asked for an incident cause with log lines, which a decision record need not hold; both removed with their two key items; constraint and option patterns reduced to number, topic and source file (exact phrases such as "health signal" removed); format-only checks replaced |
| t8-twin-latency-tier-report | review | qwen3-coder-next | 0.58 |  |
| t8-dec-deploy-strategy, t8-runbook-db-failover | edit | (worker) | 0.00 | expert key items that repeated what the hidden key checks (listed constraints, order of fence and promote, abort limit, revisit threshold) rewritten to ask for what code cannot check |
| t8-twin-latency-tier-report | edit | (worker) | 0.00 | request named paths with a `fixture/` prefix; a check used a `paths` list the schema does not have |
| t8-neg-config-question | author | gpt-5.6-luna | 3.26 |  |
| t8-neg-config-question | map | glm-5 | 0.16 |  |
| t8-neg-config-question | review | qwen3-coder-next | 0.31 |  |
| t8-rollout-ledger-migration | author (discarded) | deepseek-3.2 | 17.04 | the request listed every constraint and the file holding it; key items matched the agent's free-form step ids and accepted any gate; the generator folder sat inside the fixture; re-authored by gpt-5.6-luna |
| t8-rollout-ledger-migration | map | glm-5 | 0.16 |  |
| t8-rollout-ledger-migration | review (stopped) | minimax-m2.5 | 0.00 | stopped once the draft was discarded; the cut stream reports no credits |
