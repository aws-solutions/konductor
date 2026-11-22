<!-- SPDX-License-Identifier: Apache-2.0 -->
# Keep or prune, stages 2 to 4: agent files, SOPs and always-loaded context

2026-11-22, version 1. [← capability playbook](cap-playbook.md) · [reference](reference.md)

## The problem

Konductor ships more than skills. It ships 11 agent files, 19 SOPs and 5 context files. Each one costs something:
an agent file is a prompt the model reads on every delegation, a SOP is a long procedure a user runs, and a context
file is read in every session of every agent that lists it. `k-core-rules` alone is about 3,000 tokens, and all 11
agents list it.

Stage 1 asks of each skill: does it earn its place? Stages 2 to 4 ask the same of the rest. Today nothing answers it.
`cap keep-prune` measures skills only, and refuses an agent, a SOP or a context file by name.

## How stage 1 answers it

Stage 1 runs each skill on a frozen baseline: 16 tasks with rubrics, written and reviewed by people. A "with" arm has
the skill loaded, a "without" arm does not, and three judges score both answers. The judges come from three different
model families, none of them the agent's own. A quick depth runs one answer per task and arm. A deep depth runs three,
with a second "with" arm (the A/A repeat) to measure the noise. Two controls run beside it: one that must show an
effect and a dose ladder that must show rising harm. If a control fails, no verdict is read. Because the "with" arm
is made to load the skill, the result is the effect after load. A separate selection test asks whether the agent
loads the skill at all. A person who did not write the skill signs off.

## How stages 2 to 4 answer it

They use the same pipeline, with the unit's own text in place of the skill's.

| Stage | Unit | With arm | Without arm (drop arm) | Selection test |
| --- | --- | --- | --- | --- |
| 2 | an agent file | the agent's prompt | a stub agent of the same name that hands the work back (`cap variant --drop agent:NAME`) | does the orchestrator delegate to it when it should, and not when it should not? |
| 3 | a SOP | the SOP's text | no SOP (`cap variant --drop sop:NAME`) | none: a user names the SOP, so the effect after load is the whole question |
| 4 | a context file | the file | no file (`cap variant --drop context:NAME`) | none: it is always loaded, so its cost is paid in every session |

Three units cannot be checked this way. `konductor`, `konductor-mux-orchestrator` and `konductor-cmux-orchestrator`
are entry agents: a user starts them, so a stub in their place would start nothing. Compare them as arms of their own
(the orchestrator study in the playbook). One unit is reached by nobody: no agent lists `k-coordinator-digest`, so no
session reads it. That is an audit finding, and needs no measurement.

## What is built (free)

- `cap units [--kind agent|sop|context] [--coverage FILE]` lists every unit, with its hash, size, who reaches it,
  its drop arm, its selection test, the bench tasks that target it, and what it needs next.
- `cap unit-stage --kind K --unit NAME --run stub-ID` runs one unit through the real stage 1 pipeline on the stub
  provider. It needs a frozen unit baseline, refuses a run id that is not `stub-...`, and refuses any provider but the
  stub. With no baseline, a stale one, an entry agent or too few judge families, the record says NO DATA and why.
- `cap unit-stage --estimate [--kind K] [--depth quick|deep|both] [--max-units N]` prints the dry-run cost.
- `bench/runner/test/cap-units.test.js` and `cap-unitstage.test.js` cover all of these.

## What is missing

1. Unit baselines. No unit has one. Each needs 16 tasks with rubrics, in two batches of 8, written by one person and
   reviewed by another, frozen on the unit's current hash. The unit map in the workspace reports lists seed tasks.
2. A live provider. Stages 2 to 4 share stage 1's gap: the stub is the only provider. A live one needs the owner's
   spend cap.
3. The stage 2 selection test (delegation). Not built. It needs requests that should and should not go to each agent,
   and a reader of which agent got each brief in the stream.
4. A schema for the stage record. The record is a draft (`keep-prune-unit-stage/0`); its JSON schema waits until the
   owner approves this design (DEBT D-171). The remaining work of stages 2 to 4 is DEBT D-172.

## Cost (dry-run estimates, no run made)

Per unit, both depths: 1,264 model calls (176 answers, 32 checklists, 1,056 judge calls). Judge calls dominate:
three judges score every answer twice. The controls add 1,080 calls per stage.

| Stage | Units | Calls | Credits, typical | Credits, worst case | USD, Bedrock |
| --- | --- | --- | --- | --- | --- |
| 2 agent files | 8 | 11,192 | about 6,300 | 167,880 | about $125 |
| 3 SOPs | 19 | 25,096 | about 14,200 | 376,440 | about $281 |
| 4 context | 4 | 6,136 | about 3,500 | 92,040 | about $68 |
| Pilot: 1 unit, quick only, any stage | 1 | 584 | about 334 | 8,760 | about $6 |

"Worst case" counts every call at 15 credits, the owner's spend rule. The typical numbers and the USD prices are
assumptions (Appendix B). Start with the pilot.

## What the owner decides

1. Approve or change this design: the three stages, the drop arms, and which units are out of scope.
2. Who writes and who reviews the unit baselines, starting with one pilot unit.
3. A spend cap and a provider for the first pilot (one unit, quick depth).

## Appendix A: the rules kept from stage 1

- The record names three judges from three distinct, known families, none the agent's; with fewer, nothing is judged
  and the check is NO DATA.
- No verdict is read unless the convention control and the dose ladder pass in the same run.
- NO DATA under 12 of 16 tasks counted, with a stale judgment, or (deep) inside the A/A spread.
- The quick and deep verdicts sit side by side and are never averaged. A person signs off.

## Appendix B: how the estimate is counted

`bench/cap/unitstage.js` `estimateStage`, with 16 tasks, 3 replicates and 3 judges:

- Quick: 2 answers per task (with, without), 1 checklist per task, and 2 readings × 3 judges per answer.
- Deep: 3 arms (with, without, A/A) × 3 replicates per task, 1 checklist per task, and 2 readings × 3 judges per answer.
- Controls, once per depth: the convention control (8 tasks) as a unit, and the dose ladder (32 pairs: 1 checklist and
  2 answers × 3 judges each).
- Typical credits per call: 0.9 for an answer or a checklist (a draft call costs 0.7 to 0.9 in the playbook's credit
  guide), 0.5 for a judge call (judging is about 0.5 per judged run there).
- USD per call on Bedrock list prices: $0.035 for an answer (about 4k tokens in and 1.5k out on Claude Sonnet),
  $0.02 for a checklist, $0.007 for a judge call (about 5k in and 0.4k out at $1 and $4 per million tokens).
