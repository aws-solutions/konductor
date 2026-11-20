# T4 authoring log

Public repo: no internal names, host paths or secrets. Plan estimate for T4: 210 credits; wave 1 (5 tasks) 80, stop at
160; the rest (7 tasks and 1 twin) 130, stop at 260.

## Setup

Author, map and review calls run `kiro-cli chat --no-interactive --trust-all-tools --model <id>` (3.5.0) in an empty
folder per task, with a scratch HOME that holds only a copy of the login database and empty
`~/.kiro/{agents,steering,skills,memories}`, a cleared environment, and `memory.mode disabled`, `memory.reflection false`,
`chat.enableKnowledge false`. Each call's stream is scanned for memory attachments (`mem` must be 0) and for paths
outside its folder. The mapping call sees only the finished task (prompt, checks, file list) and a file of unit names
and one-line descriptions extracted by script; no skill, SOP or agent body was read or passed on.

## Incidents

1. **Account memories reached two calls (found and fixed before any task was kept).** The scratch home was copied
   from T1's before T1 added the memory settings. Two of the first five author calls (t4-policy-fix-accessdenied and
   t4-threat-model-webhooks) carried 6 memory attachments each (titles and summaries of saved preferences). All five
   calls were also interrupted by a signal during a host memory pause. All five outputs were discarded and never
   committed to the shared branch. Fix: the settings above, and the synced memory database removed from the scratch
   home. A probe call (0.51 credits; the first smoke call cost 0.15) then saw 0 memories, and every later call shows `mem=0`.
2. **Credits of the five interrupted calls are not known.** An interrupted call ends without a usage event, so the
   stream holds no credit figure. They ran 13 to 25 minutes each (about 10 to 14 model turns). Judging by the
   finished calls of the same models, they likely cost 30 to 60 credits in all. They are not in the table below.
3. **Model throttling.** One author call (t4-iam-ci-deploy-role) ended on a throttling error after 0.94 credits; the
   task was authored again.
4. **Two deepseek author calls stopped by the batch rule.** t4-iam-privesc-groups (34 minutes) and t4-secrets-in-repo
   (31 minutes) passed the 30-minute limit and were stopped; an interrupted call reports no credits. Both tasks were
   authored again by gpt-5.6-luna and reviewed by glm-5. An earlier deepseek call for t4-iam-privesc-groups ended after
   97 seconds without writing a task (0.91 credits) and was run again.
5. **Reviewer change.** minimax-m2.5 cost 21 credits for one review (t4-dev-sql-report-filters). Later reviews of
   deepseek-authored tasks use gpt-5.6-luna, which the plan also allows for deepseek authors. One minimax review was
   stopped 12 seconds after start (0 credits) for that reason.

## Blindness audit

Every tool call in every stream (kept and discarded) was scanned for paths outside the call's own folder. No call read
or listed anything under konductor's `skills/`, `agent-sops/`, `agents/` or `context/`, or another batch's folder. The only
outside paths were the call's own folder written with a broken prefix, and one author call that tried a working
directory that does not exist (it failed and read nothing). The mapping calls saw only `units.json` (names and one-line
descriptions extracted by script) and the finished task summary.

## Hand edits after review

Every change after the author's draft is in `edits/<id>.json` with its reason. In short: prompts that named the traps
or the hidden evaluator were rewritten to state only the symptom, the files and the interfaces; checks that grepped
source text or required names the prompt never gave were replaced by behavioural checks; author limits of 180 s were
raised to 900 s or more; hidden suites where most tests passed on the untouched fixture were cut down to the tests
that measure the fix (t4-dev-sql-report-filters) or split so one forgotten path loses its own test
(t4-iam-ci-deploy-role).

## Credits per wave (reported calls only)

| wave | credits |
| --- | --- |
| 1 | 146.42 |
| 2 | 136.92 |
| all | 283.34 |

## Calls

Times are UTC on 2026-11-19. Credits are what each call reported in its stream.

| time | task | step | model | wave | seconds | credits | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 17:27 | t4-iam-ci-deploy-role | author | gpt-5.6-luna | 1 | 325 | 0.94 | exit 1 |
| 17:30 | t4-threat-model-webhooks | author | gpt-5.6-luna | 1 | 196 | 3.29 |  |
| 17:31 | t4-threat-model-webhooks | map | glm-5 | 1 | 28 | 0.73 |  |
| 17:33 | t4-threat-model-webhooks | review | glm-5 | 1 | 115 | 5.90 |  |
| 17:36 | t4-policy-fix-accessdenied | author | gpt-5.6-luna | 1 | 202 | 3.53 |  |
| 17:36 | t4-policy-fix-accessdenied | map | glm-5 | 1 | 25 | 0.73 |  |
| 17:39 | t4-policy-fix-accessdenied | review | glm-5 | 1 | 160 | 6.37 |  |
| 17:43 | t4-iam-ci-deploy-role | author | gpt-5.6-luna | 1 | 166 | 3.22 |  |
| 17:44 | t4-iam-ci-deploy-role | map | glm-5 | 1 | 19 | 0.73 |  |
| 17:45 | t4-iam-ci-deploy-role | review | glm-5 | 1 | 86 | 3.51 |  |
| 17:54 | t4-dev-sql-report-filters | author | deepseek-3.2 | 1 | 1938 | 28.02 |  |
| 17:54 | t4-dev-sql-report-filters | map | glm-5 | 1 | 26 | 0.76 |  |
| 18:09 | t4-dev-sql-report-filters | review | minimax-m2.5 | 1 | 859 | 21.15 |  |
| 18:17 | t4-iam-ci-deploy-role-twin | author | deepseek-3.2 | 2 | 1271 | 16.09 |  |
| 18:17 | t4-iam-ci-deploy-role-twin | map | glm-5 | 2 | 18 | 0.73 |  |
| 18:18 | t4-iam-ci-deploy-role-twin | review | minimax-m2.5 | 2 | 12 | 0.00 | exit 143, stopped or throttled |
| 18:37 | t4-iac-review-terraform | author | deepseek-3.2 | 1 | 1696 | 22.17 |  |
| 18:39 | t4-iac-review-terraform | map | glm-5 | 1 | 14 | 0.72 |  |
| 18:40 | t4-iac-review-terraform | review | gpt-5.6-luna | 1 | 56 | 1.24 |  |
| 18:45 | t4-dev-sql-report-filters | fix | deepseek-3.2 | 1 | 1648 | 26.09 |  |
| 18:47 | t4-iam-ci-deploy-role-twin | review | gpt-5.6-luna | 2 | 74 | 1.15 |  |
| 18:53 | t4-iam-lambda-role-split | author | gpt-5.6-luna | 2 | 152 | 2.41 |  |
| 18:54 | t4-iam-lambda-role-split | map | glm-5 | 2 | 61 | 0.75 |  |
| 18:57 | t4-iam-lambda-role-split | review | glm-5 | 2 | 192 | 8.55 |  |
| 19:02 | t4-iac-review-terraform | fix | deepseek-3.2 | 1 | 1041 | 17.32 |  |
| 19:05 | t4-iam-vendor-trust | author | gpt-5.6-luna | 2 | 467 | 8.73 |  |
| 19:05 | t4-iam-vendor-trust | map | glm-5 | 2 | 29 | 0.75 |  |
| 19:07 | t4-iam-vendor-trust | review | glm-5 | 2 | 115 | 5.73 |  |
| 19:11 | t4-arch-tenant-abac | author | gpt-5.6-luna | 2 | 241 | 5.23 |  |
| 19:11 | t4-arch-tenant-abac | map | glm-5 | 2 | 18 | 0.74 |  |
| 19:14 | t4-arch-tenant-abac | review | glm-5 | 2 | 152 | 5.77 |  |
| 19:21 | t4-iam-privesc-groups | author | deepseek-3.2 | 2 | 97 | 0.91 |  |
| 19:38 | t4-iam-ci-deploy-role-twin | fix | deepseek-3.2 | 2 | 2058 | 31.76 |  |
| 19:55 | t4-iam-bucket-policy-oac | author | deepseek-3.2 | 2 | 2035 | 22.83 |  |
| 19:55 | t4-iam-bucket-policy-oac | map | glm-5 | 2 | 20 | 0.74 |  |
| 19:57 | t4-iam-bucket-policy-oac | review | gpt-5.6-luna | 2 | 90 | 1.74 |  |
| 20:20 | t4-iam-privesc-groups | author | deepseek-3.2 | 2 | 2043 | 0.00 | exit 143, stopped or throttled |
| 20:23 | t4-iam-privesc-groups | author | gpt-5.6-luna | 2 | 142 | 2.29 |  |
| 20:23 | t4-iam-privesc-groups | map | glm-5 | 2 | 16 | 0.73 |  |
| 20:24 | t4-iam-privesc-groups | review | glm-5 | 2 | 89 | 4.13 |  |
| 20:29 | t4-secrets-in-repo | author | deepseek-3.2 | 2 | 1869 | 0.00 | exit 143, stopped or throttled |
| 20:35 | t4-secrets-in-repo | author | gpt-5.6-luna | 2 | 351 | 4.90 |  |
| 20:35 | t4-secrets-in-repo | map | glm-5 | 2 | 16 | 0.51 |  |
| 20:36 | t4-secrets-in-repo | review | glm-5 | 2 | 99 | 3.82 |  |
| 20:44 | t4-dev-path-traversal-files | author | gpt-5.6-luna | 2 | 135 | 2.33 |  |
| 20:45 | t4-dev-path-traversal-files | map | glm-5 | 2 | 30 | 0.74 |  |
| 20:46 | t4-dev-path-traversal-files | review | glm-5 | 2 | 81 | 2.88 |  |

## FX fix round (2026-11-20)

Paid calls of the FX job (owner-approved, hard cap 90 credits for all batches, abort limit 10 credits per call, spend checked before each call). A plan line is written before each call and a result line after it.

- plan: t4-dev-sql-report-filters fix by deepseek-3.2, abort limit 10 credits, spend so far 0.0 of 90
- result: t4-dev-sql-report-filters fix deepseek-3.2 credits=10.000 secs=551
- plan: t4-dev-sql-report-filters recheck by gpt-5.6-luna, abort limit 10 credits, spend so far 10.0 of 90
- result: t4-dev-sql-report-filters recheck gpt-5.6-luna credits=0.797 secs=40
- plan: t4-iac-review-terraform fix by deepseek-3.2, abort limit 10 credits, spend so far 10.8 of 90
- result: t4-iac-review-terraform fix deepseek-3.2 credits=10.000 secs=542
- plan: t4-iac-review-terraform recheck by gpt-5.6-luna, abort limit 10 credits, spend so far 20.8 of 90
- result: t4-iac-review-terraform recheck gpt-5.6-luna credits=0.421 secs=20
- plan: t4-iam-bucket-policy-oac fix by deepseek-3.2, abort limit 10 credits, spend so far 21.2 of 90
- result: t4-iam-bucket-policy-oac fix deepseek-3.2 credits=7.210 secs=491
- plan: t4-iam-bucket-policy-oac recheck by gpt-5.6-luna, abort limit 10 credits, spend so far 28.4 of 90
- result: t4-iam-bucket-policy-oac recheck gpt-5.6-luna credits=0.592 secs=40

A fix call that was stopped at its 540 s limit carries no final credit count; it is booked at the 10 credit abort limit (the first two fix calls above). The recheck was run by gpt-5.6-luna, never the writer's family (deepseek), on a folder where the hidden overlay is laid out as the runner lays it.

Outcomes:

- t4-dev-sql-report-filters: deepseek-3.2 fixed the fixture, but put a warning comment and a security note into it that named the vulnerability and the fix. Those were reverted by hand (a Claude hand edit, in HAND-EDITS.md): the fixture docs now say "substring search", and the prompt states the requirement that a name filter is matched as typed, so `%` and `_` match only themselves. Recheck by gpt-5.6-luna: pass on all four items. Version 2; reference 100, empty 13.3, lazy 13.3, alternative 100.
- t4-iac-review-terraform: deepseek-3.2 removed the hints (the decoy label, the doc lines that list the public database, bucket and full-access role), made the CloudTrail settings match the key (single region, validation off) and took the plan step out of the CI file so it matches the key. Recheck by gpt-5.6-luna: pass on all four items. Version 2; reference 100, empty 5.7, lazy 17.1, alternative 100.
- t4-iam-bucket-policy-oac: deepseek-3.2 replaced the four expert-key items that named facts absent from the fixture (Block Public Access, request signing, KMS) with items the fixture supports. Recheck by gpt-5.6-luna: pass on all four items. Version 2; reference 100, empty 16.1, lazy 16.1, alternative 100.
- t4-iam-ci-deploy-role-twin: false alarm, cleared by hand with no paid call. The recheck folder had put the hidden overlay at `hidden/hidden/deploy.test.js`, so the reviewer read `path.join(__dirname, '..')` as `hidden/`. The runner lays `hidden/t4-iam-ci-deploy-role-twin/` over the repository root, so the test sits at `<root>/hidden/deploy.test.js`, finds `scripts/` and `public/`, and runs 14 tests; `node bench/scenarios/t4/dry-run.js t4-iam-ci-deploy-role-twin` gave reference 100 and empty 19.7. The two failed recheck items were set to pass with that note, the blockers were removed, pilot.decision is keep.
