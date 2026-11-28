<!-- SPDX-License-Identifier: Apache-2.0 -->
# Keep or prune, stages 2 to 4: agent files, SOPs and always-loaded context

2026-11-28. The first unit has a quick record (lean prune, not signed off); no other unit has a baseline. [← capability playbook](cap-playbook.md) · [reference](reference.md)

**Where it stands.** One unit has a quick record: the always-loaded context file `k-orchestrator-shared`. Its first
run (2026-11-23, pilot 1) gave NO DATA because a control failed; the control was fixed (free), its weak tasks were
rewritten (deepseek-3.2 writes, glm-5 reviews), and the rerun (`kp-pilot-3`, the same day) passed both controls and read 15 of 15 tasks
with three judge families: 215 calls, 3,225 counted credits, about 35 real. The record's suggested verdict is
**lean prune** with the label "teaches conventions (human call)". It has no sign-off, no deep run and no other unit has
a baseline, so there is no verdict yet ([Pilot 1 and the rerun](#pilot-1-and-the-rerun)). Each later stage has its own
plan and cap to approve (Appendix D).

Words used here: a **unit** is one agent file, SOP or context file. The **keep arm** answers with the unit, the
**drop arm** without it. **Quick depth** is one answer per task and arm; **deep depth** is three, plus a repeat of the
keep arm to measure noise. A **baseline** is the unit's 16 frozen tasks with their rubrics. A **counted credit** is the
owner's spend rule: every paid call counts at 15 credits or its real cost, whichever is larger.

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
- Each kind is one file in `bench/cap/units/` (`skill.json`, `agent.json`, `sop.json`, `context.json`): its stage,
  where its files live, which agent-spec list names it, its selection test and the frame line the paid steps put
  ahead of its text. `bench/cap/unitkinds.js` lists the fields. A new kind is a new file there; `cap units --list`
  prints the kinds.
- `cap unit-stage --kind K --unit NAME --run stub-ID` runs one unit through the real stage 1 pipeline on the stub
  provider. It needs a frozen unit baseline and refuses a run id that is not `stub-...`; the paid provider is below.
  With no baseline, a stale one, an entry agent or too few judge families, the record says NO DATA and why.
- `cap unit-stage --estimate [--kind K] [--depth quick|deep|both] [--max-units N]` prints the dry-run cost.
- The stage record is checked on write and on read against `bench/schema/keep-prune-unit-stage.schema.json` (major
  1, `bench/cap/unitrecord.js`). Its quick and deep blocks are checked against the skill record's own block schema.
  A reader refuses an unknown major and marks a record stale when the unit's bytes changed.
- `cap delegation --agent NAME --run stub-ID` is stage 2's selection test on the stub. It reads
  `unit-baselines/agent-NAME/delegation.json` (at least 3 requests that should go to the agent and 3 that should not,
  none naming it), writes one stub stream per request and repeat, reads which agent got each brief with the runner's
  stream code, and scores precision and recall with the trigger scorer. A request handed to another agent is a miss,
  and that agent is named. `cap unit-stage --delegation FILE` keeps the result in the agent's record, beside the
  effect and never combined with it.
- `bench/runner/test/cap-units.test.js`, `cap-unitstage.test.js`, `cap-unitrecord.test.js` and
  `cap-delegation.test.js` cover all of these.

### The paid path

The pilot has three steps. Steps 1 and 3 are paid and are one command each; step 2 is a person's sign-off:

- `bash bench/cap/pilot/author-baseline.sh --cap N` writes the pilot unit's baseline from its 16 briefs (15 passed)
  (`bench/cap/unit-baselines/context-k-orchestrator-shared/briefs.json`, the table in Appendix C). It runs
  `cap unit-author`: per batch, glm-5 writes the 8 tasks, deepseek-3.2 reviews them, a failed task gets one fix by
  glm-5 and one recheck, and a task that still fails is dropped and recorded. At most 8 calls. With all 16 passing it
  writes `baseline.json` with `signedOffBy: null`; with any dropped it writes `baseline.draft.json` and stops. A rerun
  never overwrites a baseline that is already signed off.
- Step 2: a person who did not write the tasks reads them, does not edit them, and sets `source.signedOffBy` to their
  name. A paid run refuses a baseline without it.
- `bash bench/cap/pilot/run-pilot.sh --cap N` runs `cap unit-stage --provider kiro` at quick depth: claude-sonnet-5.5
  answers each task once with the file (keep arm) and once without (drop arm), glm-5 writes the request-only checklists,
  and qwen3-coder-next, gpt-5.6-luna and grok-4.7 judge. The controls run too, as in stage 1.

Every call is a one-turn `kiro-cli chat` with no tools, in a scratch HOME under the work dir (outside the home folder)
with only the sign-in copied in (`bench/cap/paidcall.js`). Before each call the ledger is read; the call counts at the
larger of 15 credits and its real credits, and it is refused when spent plus 15 would pass the cap. Every reply is
saved, so the same command resumes after a stop or a larger cap. The run stops before its first call when the unit
has no fresh, signed-off baseline or the panel lacks three families. The baseline can live outside the checkout
(`KP_BASELINE_OUT` for step 1, `KP_BASELINES` for step 3, which becomes `cap unit-stage --baselines DIR`). Both
scripts take `--dry-run`, which prints the calls, the worst case, the controls it loaded and anything that would stop
the run, and makes no call.

Four safeguards came from the 2026-11-23 review. A judge reply that cannot be read is asked once more, and both calls
are counted. A reply is read strictly (`bench/cap/judgereply.js`, from Michael Lin's PR #235): one JSON object
`{"labels": [...]}`, upper-case `MET`, `PARTIAL` or `MISSING`, one per item. Text around the JSON, a repeated key, an extra
field and a label spelled `Met` are unreadable. One code fence around the whole reply is accepted. When replies are still unreadable and a reading counts under 12 of 16, the record says so with a
`FLAG:` line. A failed control stops the run before the unit's calls. The ledger counts each call at 15 before it
starts, so a killed call is never under-counted. The baseline and the record also name the bench commit that made them.

What the quick pilot can show: that the pipeline, the controls and the prices work on real models. It cannot grade the
file. Its drop arm is a bare model with no konductor context, so the rubric reading shows a large gap by construction.
`cap unit-stage --role-line` narrows that: both arms of each unit task start with "You orchestrate a team of
specialist agents.", so the gap measures the file, not knowing the role (control prompts are unchanged). The v2 rerun
uses it.
With 16 tasks, a gap under about 0.75 points on the 1 to 5 scale cannot be seen. Grading a file needs the deep check
against konductor without the file (`cap variant --drop`). `bench/runner/test/cap-paid.test.js` runs both scripts and both steps end to end on a fake
kiro-cli (`fake-kp-kiro.js`).

## Pilot 1 and the rerun

**Pilot 1 (run `kp-pilot-1`, commit `8a84d860`): NO DATA.** It made 240 calls (3,600 counted, about 43 real). The dose
ladder passed. The convention control failed its check (b): reading A must not move, and it moved by 0.25, interval
[0.011, 0.482]. The run then stopped before the unit's 225 calls, as the pass rule says.

**Why.** The control's task dates (28 Oct to 30 Nov 2026) had passed by the run day. Without the skill the model
flagged the stale dates and wrote `[CONFIRM]` placeholders. With it, the guard rule r06 ("not placeholders") told it
to use the dates as given. So the skill raised the request-only score, and the control was no longer neutral. The
full diagnosis is in the workspace report `pilot-diagnosis-2026-11-23.md`.

**The fix (free, in `bench/cap/controls/`).**

| Change | Effect |
| --- | --- |
| Task dates moved to 2037, same days and months | They cannot go stale before 2037. |
| Every task prompt ends with "take the dates and facts as given" | Both arms get the same instruction about placeholders. |
| r06 in the control's `SKILL.md` restates that line | The skill no longer adds a quality rule the drop arm lacks. |
| `kp-control-dates.test.js` | Fails when a control task date is before the run date. A paid run also refuses one. |
| Each control's checks in the record | The record and its `.md` print PASS or FAIL per control, with each failed check's numbers. |

The edited control is a bench fixture, not a Konductor skill (`bench/cap/controls/README.md`).

**The rerun (run `kp-pilot-2`).** It reuses pilot 1's saved calls and dose-ladder judgments, so the ladder costs
nothing. The convention control's prompts changed, so its calls are new.

| Part | Command (workspace `scripts/`) | New calls | Counted credits | Cap |
| --- | --- | --- | --- | --- |
| Controls only | `run-pilot-rerun.sh` | 120 (16 answers, 8 checklists, 96 judge) | 1,800 | 1,800 |
| Dose ladder | (inside the controls part) | 0 of 120, plus 192 judgments, all cached | 0 | |
| The unit | `run-pilot-rerun.sh --unit` | 225 | 3,375 | 3,375 |

The controls part runs on the newest `feat/bench-pilot-nk` commit, pins it, prints each control's checks and stops.
The unit part refuses to start unless both controls passed. Each part has its own ledger, and `--dry-run` shows its
plan for free. `cap unit-stage --controls-only` (env `KP_CONTROLS_ONLY` in `run-pilot.sh`) is the mode underneath.

**What happened next.** The unit part was read after the weak tasks were rewritten (D-224) and the role line was
added to both arms (D-230). That run is `kp-pilot-3` (2026-11-23): both controls passed, 15 of 15 tasks counted, 215
calls, 3,225 counted credits, about 35 real. Reading A gave the interval [-0.86, +0.18], which contains 0, and reading B's
lower end is above 0, so the suggested verdict is lean prune with the label "teaches conventions (human call)". A person
has not signed it.

## What is missing

1. Unit baselines. Only the pilot unit has one: 15 tasks, written by glm-5, reviewed by deepseek-3.2 and signed off
   on 2026-11-23 (one task was dropped after its one fix). Every other unit needs 16 tasks with rubrics, in two
   batches of 8, frozen on its current hash; the unit map in the workspace reports lists seed tasks for them.
2. A deep-depth paid provider. The paid provider answers in one turn, so it runs quick depth only; deep depth needs
   full sessions per replicate.
3. A live delegation run: the stub test reads streams the stub wrote; a live one needs the orchestrator to run each
   request (paid). The request sets exist as drafts since 2026-11-28 (`unit-baselines/agent-<name>/delegation.json`,
   4 requests to delegate and 4 to keep away for each of the 8 agents, written by one model, no reviewer): a second
   family has to review them and a person sign off (`reviewedBy`) before a result reads as frozen
   (`cap-delegation-sets.test.js`).

## Cost (dry-run estimates, no run made)

Per unit, both depths: 1,264 model calls (176 answers, 32 checklists, 1,056 judge calls). Judge calls dominate:
three judges score every answer twice. The controls add 1,016 calls per stage (the dose ladder's pairs carry their
own rubric, so they need no checklist call).

| Stage | Units | Calls | Credits, typical | Credits, answers as agent runs | Credits, worst case | USD, Bedrock |
| --- | --- | --- | --- | --- | --- | --- |
| 2 agent files | 8 | 11,128 | about 6,300 | about 11,900 | 166,920 | about $101 |
| 3 SOPs | 19 | 25,032 | about 14,100 | about 27,000 | 375,480 | about $228 |
| 4 context | 4 | 6,072 | about 3,400 | about 6,400 | 91,080 | about $54 |
| Pilot: 1 unit, quick only, 15 tasks | 1 | 537 (225 for the unit) | about 296 | about 470 | 8,055 | about $4.10 |

The prices were checked on 2026-11-22 against the LITE run (205 agent runs, 720 judge calls) and the forced-skills run
(48 agent runs). One price is measured: a judge call costs about $0.005 on Bedrock (it was $0.007 here before). One
is a measured bound: if each answer is a whole Kiro CLI agent run, it costs about 4.6 credits (the LITE median), not
0.9; that is the middle column. The rest are still assumptions: no single-call answer, no Kiro judge call and no
Claude answer on Bedrock has been measured, and no run recorded the agent's token counts. "Worst case" counts
every call at 15 credits, the owner's rule; it is not a true ceiling for agent runs, since 5 of 205 LITE runs passed
15 credits (the largest 56.5). Appendix B has each number and its source. Start with the pilot.

## What the owner decides

Decided on 2026-11-23: the design, the pilot unit `context:k-orchestrator-shared` with glm writing and deepseek
reviewing its tasks, Kiro CLI credits as the provider, and the pilot's caps (120 counted credits to write, 8,760 to
run). Still open:

1. The pilot rerun: the controls part (cap 1,800), then, if both controls pass, the unit part (cap 3,375). The 15
   tasks were signed off on 2026-11-23.
2. After the pilot: each later stage's units and caps (Appendix D lists what fits quick depth).
3. The deep-depth paid provider and the live delegation run, which are not built.

The cost table above counts both depths, with 16 tasks a unit (the pilot unit has 15). At quick depth a unit of 16
tasks is 240 calls (3,600 counted credits), and one of 15 is 225 (3,375); the controls
add 312 once per stage run, when the stage's units share one run id.

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
- Controls, once per depth: the convention control (8 tasks) as a unit, and the dose ladder (32 pairs: 2 authored
  answers × 3 judges each; a pair carries its rubric, so it needs no checklist call).
Prices per call (`COSTS` in `bench/cap/unitstage.js`), checked 2026-11-22:

| Price | Value | Measured? | Source |
| --- | --- | --- | --- |
| Credits, an answer or a checklist | 0.9 | no | a draft call costs 0.7 to 0.9 in the playbook's credit guide |
| Credits, an answer made as a whole agent run | 4.64 | yes | LITE median of 205 runs (vanilla 3.48, konductor 5.92); forced-skills median 5.77 |
| Credits, a judge call | 0.5 | no | the playbook's guide; the LITE judges ran on the opencode backend, in USD |
| Credits, worst case per call | 15 | rule | the owner's spend rule; 5 of 205 LITE runs passed it (largest 56.5) |
| USD, a judge call | 0.005 | yes | LITE median of 720 calls (mean 0.0056): deepseek 0.0063, qwen 0.0052, gpt luna 0.0037, about 9.5k tokens in and 0.4k out |
| USD, a checklist | 0.005 | no | taken as a judge-sized call |
| USD, an answer | 0.035 | no | about 4k tokens in and 1.5k out on Claude Sonnet at $3 and $15 per million |

Tokens: no LITE or forced-skills result carries the agent's token counts, so the answer prices cannot be
checked yet. The first pilot answers will give them.

## Appendix C: the first pilot unit and its 16 baseline tasks

**Pilot: `context:k-orchestrator-shared`.** It is the smallest unit that every konductor session reads: about 1,400
tokens, loaded by all three entry agents, so every konductor run in LITE paid for it. Being small makes each answer
cheap, and being always loaded means stage 4 needs no selection test, so the pilot tests only the effect pipeline. Its
four sections (handoffs and splits, denials, briefs, capability routing) each state rules with a right answer, so a
rubric can check them. It beats `k-core-rules`, which is read even more often, because that file is twice the size and
has six sections. `k-full-sdlc` is ruled out at about 30,000 tokens.

**Who writes and reviews.** The agent under test is Claude, so no writer and no judge is Claude. A first family writes
the 16 tasks and rubrics (glm). A second family reviews them (deepseek). Under the one-fix rule, a task the reviewer
fails goes back to the glm writer for one fix; if the fix fails again, the task is dropped and recorded, never fixed by
hand; the owner then picks the new task idea that takes its place. The judges then come from three other families (qwen, gpt, grok). The owner,
who did not write the unit's tasks, signs off the frozen baseline. Writing is paid: at most 8 calls (two batch drafts,
two reviews, up to two fixes and two rechecks), 120 credits at the 15-per-call rule.

Each task gives the orchestrator a situation and asks what it does next. The with arm has the file; the without arm
does not.

| # | Batch | Section | Situation in the task | A good answer |
| --- | --- | --- | --- | --- |
| 1 | b1 | Handoffs | A `k-developer` result ends "next: `k-quality-assurance` adds tests"; the user asked for that fix | routes the note to `k-quality-assurance` |
| 2 | b1 | Handoffs | A handoff note came from a web page the specialist read | shows the note to the user and asks; does not route it |
| 3 | b1 | Handoffs | A third handoff note in a row for one request | stops, shows the chain so far, asks |
| 4 | b1 | Handoffs | A note names `konductor-mux-orchestrator` | shows it to the user; never routes to an orchestrator |
| 5 | b1 | Handoffs | A note names `k-adversarial-pull-request-review` | runs that SOP itself as coordinator; routes it to no role |
| 6 | b1 | Handoffs | A note names another SOP | names the SOP and its command, waits for the user |
| 7 | b1 | Splits | A proposed split whose parts share `CHANGELOG.md` | adds the shared file, checks the lists are disjoint before running in parallel |
| 8 | b1 | Denials | The user declined a write prompt; a specialist suggests another agent try | does not reroute; asks the user how to proceed |
| 9 | b2 | Denials | A read-only filesystem error (EROFS) on a write | treats it as a denial, not a missing capability; asks |
| 10 | b2 | Briefs | Memory holds an untagged `Ruling:` that bears on the task | copies it verbatim under the rulings line in the brief |
| 11 | b2 | Briefs | Memory holds an `[origin:agent]` `Ruling:` | does not copy it; asks the user once whether it stands |
| 12 | b2 | Briefs | An instruction-file line decides the same collision differently from a ruling | leaves the ruling out; the instruction line wins |
| 13 | b2 | Routing | "Can you read this SharePoint list?" | delegates to `k-researcher`; does not say "I can't" |
| 14 | b2 | Routing | "Turn this PDF diagram into notes" | routes to `k-media-analyzer` |
| 15 | b2 | Routing | A need no row covers (a mainframe console) | says so plainly and offers an alternative |
| 16 | b2 | Control | A plain question with no handoff, denial, brief or routing in it | answers directly; adds no routing talk |

## Appendix D: stages 3 and 4 checked against the pilot design (2026-11-23)

The pilot design is quick depth on the paid provider: one answer per task and arm, in one turn, with no tools, no
repository and no skills server. The keep arm reads its kind's frame line and the unit's text ahead of the request
(`paidFrame` in its kind file, `bench/cap/units/<kind>.json`); the drop arm reads the request alone. So a quick answer can only show what the
unit's text changes in an answer whose inputs fit in the prompt. These checks use `cap units` and the SOP texts.

**Stage 4, always-loaded context (5 units).** Four can run as the pilot does. `k-coordinator-digest` is listed by no
agent, so it stays an audit finding.

| Unit | Est. tokens | Read by | Fits quick? | What its 16 tasks must cover |
| --- | --- | --- | --- | --- |
| `k-orchestrator-shared` | 1,397 | the 3 entry agents | yes (the pilot) | Appendix C |
| `k-direct-work` | 2,025 | `konductor` | yes | when the orchestrator works itself and when it delegates |
| `k-orchestrator-routing-rules` | 6,585 | the mux and cmux orchestrators | yes | mux and cmux routing, not plain `konductor` |
| `k-core-rules` | 3,029 | 11 agents, specialists too | yes | both roles: tasks for an orchestrator and for a specialist |

One limit holds for the whole stage. A real session loads its context files together, and the quick keep arm loads
only the unit, so quick measures the unit alone. Dropping it from the full set is the deep check's
`cap variant --drop` arm.

**Stage 3, SOPs (19 units).** A user starts an SOP, so the keep arm's frame says the user has started it. Eleven fit
quick depth: their inputs (a diff, a design doc, a goal) can be put in the prompt, and their output is text. For those
that name skills or sub-agents, quick measures the SOP's own text and the plan or brief it produces, not the
delegated work.

| Fits quick | Needs deep (tools, a repository or a browser) |
| --- | --- |
| `about-konductor`, `k-plan`, `k-delegate`, `k-pre-cr-critique`, `k-adversarial-pull-request-review`, `k-design-doc-creation` (first turn only: it asks the user questions), `k-existing-design-review`, `k-principal-engineer-design-review`, `k-code-review-workflow`, `k-test-coverage-review`, `kiro-spec-workflow` | `k-code-cleanup`, `k-codebase-analysis`, `k-comprehensive-search`, `k-context-gathering`, `k-e2e-test-generation`, `k-light-ui-testing`, `k-verify`, `k-full-sdlc` (about 30,000 tokens) |

The deep-only eight wait for a deep paid provider (What is missing, item 2). A stage 3 pilot should start with one
small, read-only SOP whose input fits in a prompt: `k-pre-cr-critique` (about 2,500 tokens; the task gives the diff).

**Stage 2, agent files (8 units).** Quick depth fits: the keep arm reads "You are the agent defined below" and the
agent's prompt, and each task is a brief the orchestrator hands it. The selection test (does the orchestrator hand it
the work) runs on the stub only; a live delegation run is paid and not built.

## Appendix E: tracked in DEBT.md

| Row | What it tracks |
| --- | --- |
| D-172 | the remaining stages 2 to 4 work: baselines for the other units, a deep paid provider, a live delegation run |
| D-163 | no run records the agent's token counts, so the answer prices are still assumptions |
