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
| t8-inc-queue-backlog | author | gpt-5.6-luna | 3.51 |  |
| t8-inc-queue-backlog | map | glm-5 | 0.16 |  |
| t8-rollout-ledger-migration | author | gpt-5.6-luna | 3.05 |  |
| t8-rollout-ledger-migration | map | glm-5 | 0.16 |  |
| t8-inc-queue-backlog | review | qwen3-coder-next | 0.79 |  |
| t8-rollout-ledger-migration | review | qwen3-coder-next | 0.58 |  |
| t8-rollout-ledger-migration | edit | (worker) | 0.00 | the reviewer printed its verdicts instead of writing review.json (read from its reply; stage.js now does that itself); request listed every source file and named the metrics catalogue file; both reduced; every-step gate item limited to traffic steps; an exact canary start time replaced by "every step inside the release window"; decoy and rota patterns widened; a keyword `contains` check and a `fixture/` path prefix removed |
| t8-inc-queue-backlog | edit | (worker) | 0.00 | delayed-notification count defined in the request; root cause patterns accept "retried", "stuck" and "backlog"; decoy pattern fails only a summary that blames the disk; evidence needs 2 of 3 groups |
| t8-pm-cache-stampede | author (discarded) | deepseek-3.2 | 5.00 | wrote the folder twice (top level and fixture/) with its own key script beside it; the request listed every source; timeline items required literal words ("first incident", "root cause identified") within one or two minutes; an undefined affected-users estimate; re-authored by gpt-5.6-luna |
| t8-pm-cache-stampede | map | glm-5 | 0.17 |  |
| t8-pm-cache-stampede | review (stopped) | minimax-m2.5 | 0.00 | stopped once the draft was discarded; the cut stream reports no credits |
| t8-oncall-alert-review | author | gpt-5.6-luna | 4.19 |  |
| t8-oncall-alert-review | map | glm-5 | 0.16 |  |
| t8-oncall-alert-review | review | qwen3-coder-next | 0.43 |  |
| t8-nfr-slo-burn | author | gpt-5.6-luna | 3.11 |  |
| t8-nfr-slo-burn | map | glm-5 | 0.16 |  |
| t8-nfr-slo-burn | review | qwen3-coder-next | 0.60 |  |
| t8-oncall-alert-review | edit | (worker) | 0.00 | each flawed-alert item required the reference's exact replacement values (thresholds, durations, an ack count) in 6 or 7 patterns; reduced to the alert name, the kind of problem and, where it is clear, the disposition; a log-citation item and two citation-format checks removed; request no longer lists every source |
| t8-nfr-slo-burn | edit | (worker) | 0.00 | request told the agent to exclude synthetic and health-check traffic and to use the catalogue and dependency notes (the seeded traps); removed, availability defined; the availability tolerance (0.05 points) accepted the all-traffic value 99.995, cut to 0.009; a log-citation check removed |
| t8-pm-cache-stampede | author | gpt-5.6-luna | 3.27 |  |
| t8-pm-cache-stampede | map | glm-5 | 0.16 |  |
| t8-pm-cache-stampede | review | qwen3-coder-next | 1.01 |  |
| t8-pm-cache-stampede | edit | (worker) | 0.00 | the request did not name the impact fields the key reads; named and defined; timeline items required words such as "first" and "third"; decoy pattern now fails only a summary that blames the reporting job; two keyword `contains` checks removed; evidence needs 2 of 3 groups |
| t8-tpm-rollout-regions | author (discarded) | deepseek-3.2 | 18.43 | the fixture held the author's own answer and key files; the request listed every constraint and the file holding it; re-authored by gpt-5.6-luna |
| t8-tpm-rollout-regions | map | glm-5 | 0.16 |  |
| t8-tpm-rollout-regions | review (stopped) | minimax-m2.5 | 0.00 | stopped once the draft was discarded; the cut stream reports no credits |
| t8-neg-alert-threshold | author | gpt-5.6-luna | 3.85 |  |
| t8-neg-alert-threshold | map | glm-5 | 0.16 |  |
| t8-neg-alert-threshold | review | qwen3-coder-next | 0.15 |  |
| t8-tpm-rollout-regions | author | gpt-5.6-luna | 4.26 |  |
| t8-tpm-rollout-regions | map | glm-5 | 0.16 |  |
| t8-tpm-rollout-regions | review | qwen3-coder-next | 0.46 |  |
| t8-tpm-rollout-regions | edit | (worker) | 0.00 | the request offered optional `risk.cause` and `risk.decoy` fields (naming the decoy) that the key graded; removed with their items and an optional canary field; a positional `steps.13` item, a "contract" item that matched the partner contract, and an exact certification start time replaced by "no Solmere step before the certification time"; order patterns widened; gate rule limited to traffic steps; grader gained `timeField` for that item |
| t8-neg-alert-threshold | note | (worker) | 0.00 | the author wrote one scratch file to /tmp (outside its dir, no unit or batch read); removed |
| t8-pm-cert-expiry-region | author | qwen3-coder-next | 0.00 |  |
| t8-pm-cert-expiry-region | map | glm-5 | 0.16 |  |
| t8-pm-cert-expiry-region | review | minimax-m2.5 | 4.26 |  |
| t8-inc-memory-leak | author | minimax-m2.5 | 16.14 |  |
| t8-inc-memory-leak | map | glm-5 | 0.16 |  |
| t8-inc-memory-leak | review | qwen3-coder-next | 1.15 |  |
| t8-pm-cert-expiry-region | alt answer | glm-5 | 9.03 |  |
| t8-inc-memory-leak | alt answer | glm-5 | 7.43 |  |
| t8-pm-cert-expiry-region | lazy answer | glm-5 | 1.78 |  |
| t8-inc-memory-leak | lazy answer | glm-5 | 3.73 |  |
| t8-inc-memory-leak (v2) | edit | (worker) | 0.00 | request named the decoy and listed every source, and left the impact fields undefined; rewritten with the three fields defined; the tests check counted 30 tests for 18; action matchers read the whole item (owner text matched); two keyword `contains` checks removed |
| t8-inc-memory-leak | alt answer | glm-5 | 8.75 |  |
| t8-inc-memory-leak | lazy answer | glm-5 | 4.70 |  |
| t8-inc-memory-leak | lazy answer | glm-5 | 4.32 |  |
| t8-pm-cert-expiry-region (v2, try 1) | failed | qwen3-coder-next | 0.00 | stopped at 122 tool calls before it checked its work (the cut stream reports no credits); its reference failed its own key (72%), the fixture gave the answer away (a certificate inventory row marked expired, a to-do file listing the action items) and the request gave the outage window; a second try follows |
| t8-inc-memory-leak (v2, try 1) | failed | minimax-m2.5 | 0.00 | after one fix round (request, impact fields, test count) the reference scored 100 and the alternative 96, but the lazy answer, written from a skim (long files cut to 60 lines), scored 76: a six-line config diff names the cause; a second try follows |
| t8-runbook-db-failover | author | qwen3-coder-next | 8.49 |  |
| t8-runbook-db-failover | map | glm-5 | 0.17 |  |
| t8-runbook-db-failover | review | minimax-m2.5 | 9.50 |  |
| t8-runbook-db-failover (v2, try 1) | failed | qwen3-coder-next | 0.00 | the request listed the facts to find (hosts, RPO, metric name, CLI commands) and the eight steps the runbook must have; key items had no ids and nested matchers, the reference scored 0, and the author rewrote the bench self-check; a second try follows |
| t8-runbook-db-failover | alt answer | glm-5 | 0.00 |  |
| t8-nfr-slo-burn | author | minimax-m2.5 | 12.44 |  |
| t8-nfr-slo-burn | map | glm-5 | 0.16 |  |
| t8-runbook-db-failover | lazy answer | glm-5 | 0.74 |  |
| t8-nfr-slo-burn | review | qwen3-coder-next | 0.49 |  |
| t8-nfr-slo-burn | alt answer | glm-5 | 5.24 |  |
| t8-nfr-slo-burn | lazy answer | glm-5 | 1.28 |  |
| t8-bug-retry-storm | author | qwen3-coder-next | 0.00 |  |
| t8-nfr-slo-burn (v2, try 1) | failed | minimax-m2.5 | 0.00 | the fixture held the solution document (the stub scored 100); the request listed every file, the dependency cap and the traffic filter; the measured availability (95.38%) sat below the target the key required; a second try follows |
| t8-bug-retry-storm (v2, try 1) | failed | qwen3-coder-next | 0.00 | stopped at 123 tool calls with no task file written (the cut stream reports no credits); a second try follows |
| t8-inc-memory-leak | author | qwen3-coder-next | 9.08 |  |
| t8-inc-memory-leak | map | glm-5 | 0.16 |  |
| t8-pm-cert-expiry-region | author | minimax-m2.5 | 10.28 |  |
| t8-pm-cert-expiry-region | map | glm-5 | 0.17 |  |
| t8-pm-cert-expiry-region | review | qwen3-coder-next | 0.57 |  |
| t8-pm-cert-expiry-region | alt answer | glm-5 | 0.00 |  |
| t8-pm-cert-expiry-region | lazy answer | glm-5 | 0.00 |  |
| t8-inc-memory-leak | review | minimax-m2.5 | 1.88 |  |
| t8-pm-cert-expiry-region (v2, try 2) | edit | (worker) | 0.00 | fix round: the request said "not the deploy" and listed every source; the impact fields were undefined; the expired certificate's not-after date sat a month before the outage (moved to the outage start, by hand: this author wrote no generator); key patterns listed every word as required ("503" and "error" and "fail"); the reviewer's JSON was repaired by hand |
| t8-inc-memory-leak | alt answer | glm-5 | 14.66 |  |
| t8-pm-cert-expiry-region | alt answer | glm-5 | 11.13 |  |
| t8-inc-memory-leak | lazy answer | glm-5 | 3.90 |  |
| t8-pm-cert-expiry-region | lazy answer | glm-5 | 3.15 |  |
| t8-pm-cert-expiry-region (v2, try 2) | failed | minimax-m2.5 | 0.00 | after the fix round the reference scored 100, the stub 7 and the alternative 90, but the lazy answer, written from a skim, scored 92: the incident chat export states the cause and the timeline in its first lines, and the failed-login tolerance (10%) accepted a round guess; failed twice, so version 1 stays |
| t8-inc-memory-leak (v2, try 2) | failed | qwen3-coder-next | 0.00 | the request listed the "key observations" (the stable container, the campaign) and left impact fields undefined; the fixture contradicts itself (a hotfix that rolls back the cache at 2026-03-17T09:00, yet kills continue until 20:06 and the key puts recovery at 23:55); the alternative scored 64; failed twice, so version 1 stays |
| t8-runbook-db-failover | author | minimax-m2.5 | 16.08 |  |
| t8-runbook-db-failover | map | glm-5 | 0.16 |  |
| t8-runbook-db-failover | review | qwen3-coder-next | 0.42 |  |
| t8-runbook-db-failover | alt answer | glm-5 | 1.03 |  |
| t8-runbook-db-failover | lazy answer | glm-5 | 0.68 |  |
| t8-bug-retry-storm | author | minimax-m2.5 | 16.95 |  |
| t8-bug-retry-storm | map | glm-5 | 0.16 |  |
| t8-bug-retry-storm | review | qwen3-coder-next | 0.36 |  |
| t8-runbook-db-failover (v2, try 2) | failed | minimax-m2.5 | 0.00 | reference 100, stub 0, alternative 87, but the lazy answer scored 87; under the owner rule (one fix attempt by the author family, no hand fixes) and the spend stop it is dropped; version 1 stays |
| t8-bug-retry-storm (v2, try 2) | failed | minimax-m2.5 | 0.00 | reference 92 and stub 36.5 before the lazy and alternative answers; dropped; version 1 stays |
| t8-nfr-slo-burn (v2, try 2), t8-twin-latency-tier-report (v2), t8-dec-deploy-strategy (v2) | stopped | qwen3-coder-next, minimax-m2.5 | 0.00 | stopped at the combined T7 and T8 rewrite spend stop; the cut streams report no credits; version 1 stays |
| (rewrite total) | note | | 0.00 | 190.90 credits: sum of the reported rewrite calls above, from the first rewrite row on; four cut streams (two qwen3-coder-next authors stopped at about 120 tool calls, and the two authors stopped at the spend stop) report no credits, so the real total is higher, about 200 to 215 |
